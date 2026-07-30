"""End-to-end pipeline behaviour with fake eBay + AI backends."""

from __future__ import annotations

import pytest
from tests.conftest import FakeAI, FakeEbayClient

from epay_tool.ai.schemas import FieldGuess, ListingCopy, ProductIdentification
from epay_tool.core.pipeline import Pipeline
from epay_tool.db.models import DataSource, Photo, Product, ProductState
from epay_tool.db.session import get_session
from epay_tool.ebay import taxonomy

CATALOG_HIT = {
    "productSummaries": [
        {
            "epid": "24053414",
            "title": "Apple iPhone 13 128GB Midnight",
            "brand": "Apple",
            "image": {"imageUrl": "https://img/1.jpg"},
            "categoryIds": ["9355"],
            "aspects": [{"localizedName": "Farbe", "localizedValues": ["Midnight"]}],
        }
    ]
}
CATALOG_MISS = {"productSummaries": []}
BROWSE_HIT = {
    "itemSummaries": [
        {"price": {"value": "400.00", "currency": "EUR"}},
        {"price": {"value": "420.00", "currency": "EUR"}},
        {"price": {"value": "380.00", "currency": "EUR"}},
    ]
}
TREE = {"categoryTreeId": "77"}
SUGGESTIONS = {
    "categorySuggestions": [{"category": {"categoryId": "9355", "categoryName": "Handys"}}]
}
NO_REQUIRED_ASPECTS = {"aspects": []}


@pytest.fixture(autouse=True)
def _clear_taxonomy_cache():
    taxonomy._tree_id.cache_clear()
    yield
    taxonomy._tree_id.cache_clear()


def build_pipeline(settings, responses, ai=None) -> tuple[Pipeline, FakeEbayClient, FakeAI]:
    client = FakeEbayClient(settings, responses)
    ai = ai or FakeAI()
    return Pipeline(settings, client, ai), client, ai


def add_product(**kwargs) -> int:
    with get_session() as session:
        photos = kwargs.pop("photos", [])
        product = Product(**kwargs)
        product.photos = photos
        session.add(product)
        session.commit()
        return product.id


def get_product(product_id: int) -> Product:
    with get_session() as session:
        product = session.get(Product, product_id)
        _ = product.photos  # load before the session closes
        return product


def test_barcode_hit_produces_ready_listing(db, settings):
    pipeline, client, ai = build_pipeline(
        settings,
        {
            "product_summary/search": CATALOG_HIT,
            "item_summary/search": BROWSE_HIT,
            "get_default_category_tree_id": TREE,
            "get_item_aspects_for_category": NO_REQUIRED_ASPECTS,
        },
    )
    product_id = add_product(gtin="0194252707975")
    pipeline.enrich(product_id)

    product = get_product(product_id)
    assert product.state == ProductState.READY
    assert product.source == DataSource.CATALOG
    assert product.brand == "Apple"
    assert product.category_id == "9355"
    assert product.condition == "NEW"  # default applied
    assert product.price == pytest.approx(388.0)  # median 400 minus 3%
    assert [p.ebay_url for p in product.photos] == ["https://img/1.jpg"]
    # The catalog answered everything, so the AI was never asked to identify.
    assert ai.identify_calls == []


def test_catalog_miss_falls_back_to_ai(db, settings):
    identification = ProductIdentification(
        product_name=FieldGuess(value="iPhone 13", confidence=0.95),
        brand=FieldGuess(value="Apple", confidence=0.97),
        model=FieldGuess(value="A2633", confidence=0.9),
        aspects={"Farbe": FieldGuess(value="Schwarz", confidence=0.92)},
    )
    ai = FakeAI(
        identification=identification,
        copy=ListingCopy(title="Apple iPhone 13 128GB Schwarz", description_html="<p>x</p>"),
    )
    pipeline, client, ai = build_pipeline(
        settings,
        {
            "product_summary/search": CATALOG_MISS,
            "item_summary/search": BROWSE_HIT,
            "get_default_category_tree_id": TREE,
            "get_category_suggestions": SUGGESTIONS,
            "get_item_aspects_for_category": NO_REQUIRED_ASPECTS,
        },
        ai=ai,
    )
    product_id = add_product(
        gtin="0000000000000", photos=[Photo(path="/tmp/front.jpg", position=0)]
    )
    pipeline.enrich(product_id)

    product = get_product(product_id)
    assert product.source == DataSource.AI
    assert product.brand == "Apple"
    assert product.aspects["Farbe"] == ["Schwarz"]
    assert product.category_id == "9355"
    assert product.state == ProductState.READY
    assert len(ai.identify_calls) == 1


def test_uncertain_ai_asks_questions_and_needs_info(db, settings):
    """The iPhone-from-the-front case: identify what is visible, ask the rest."""
    identification = ProductIdentification(
        brand=FieldGuess(value="Apple", confidence=0.98),
        model=FieldGuess(value="iPhone 12 oder 13", confidence=0.3),
        questions=["Bitte die Rückseite fotografieren, um das Modell zu bestimmen."],
        photo_suggestions=["Foto der Rückseite", "Foto der Seriennummer"],
    )
    pipeline, _client, _ai = build_pipeline(
        settings,
        {
            "product_summary/search": CATALOG_MISS,
            "item_summary/search": BROWSE_HIT,
            "get_default_category_tree_id": TREE,
            "get_category_suggestions": SUGGESTIONS,
            "get_item_aspects_for_category": NO_REQUIRED_ASPECTS,
        },
        ai=FakeAI(identification=identification),
    )
    product_id = add_product(photos=[Photo(path="/tmp/front.jpg", position=0)])
    pipeline.enrich(product_id)

    product = get_product(product_id)
    assert product.state == ProductState.NEEDS_INFO
    assert product.ai_questions == [
        "Bitte die Rückseite fotografieren, um das Modell zu bestimmen."
    ]
    assert len(product.ai_suggestions) == 2
    # A 0.3-confidence model guess must not silently end up in the listing.
    assert product.mpn is None
    assert product.title is None or "iPhone 12 oder 13" not in product.title
    # ...but the confidence is kept so the UI can show how sure the AI was.
    assert product.ai_confidence["model"] == 0.3


def test_missing_required_aspect_forces_needs_info(db, settings):
    pipeline, _client, _ai = build_pipeline(
        settings,
        {
            "product_summary/search": CATALOG_HIT,
            "item_summary/search": BROWSE_HIT,
            "get_default_category_tree_id": TREE,
            "get_item_aspects_for_category": {
                "aspects": [
                    {
                        "localizedAspectName": "Speicherkapazität",
                        "aspectConstraint": {"aspectRequired": True},
                        "aspectValues": [{"localizedValue": "128 GB"}],
                    }
                ]
            },
        },
    )
    product_id = add_product(gtin="0194252707975")
    pipeline.enrich(product_id)

    assert get_product(product_id).state == ProductState.NEEDS_INFO


def test_api_failure_marks_failed_without_crashing(db, settings):
    class ExplodingClient(FakeEbayClient):
        def request(self, *args, **kwargs):
            raise RuntimeError("eBay down")

    pipeline = Pipeline(settings, ExplodingClient(settings), FakeAI())
    product_id = add_product(gtin="123")
    pipeline.enrich(product_id)  # must not raise - a batch of 100 keeps going

    product = get_product(product_id)
    assert product.state == ProductState.FAILED
    assert "eBay down" in product.last_error


def test_no_market_data_leaves_price_unset(db, settings):
    pipeline, _client, _ai = build_pipeline(
        settings,
        {
            "product_summary/search": CATALOG_HIT,
            "item_summary/search": {"itemSummaries": []},
            "get_default_category_tree_id": TREE,
            "get_item_aspects_for_category": NO_REQUIRED_ASPECTS,
        },
    )
    product_id = add_product(gtin="0194252707975")
    pipeline.enrich(product_id)

    product = get_product(product_id)
    assert product.price is None
    assert product.state == ProductState.NEEDS_INFO  # missing price is a blocker
