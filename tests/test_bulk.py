"""Bulk behaviour: a large batch must finish without losing or blocking items."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from tests.conftest import FakeAI, FakeEbayClient

from epay_tool.core.pipeline import Pipeline
from epay_tool.db.models import Product, ProductState
from epay_tool.db.session import get_session
from epay_tool.ebay import taxonomy

BATCH_SIZE = 60
TERMINAL_STATES = {ProductState.READY, ProductState.NEEDS_INFO, ProductState.FAILED}

RESPONSES = {
    "product_summary/search": {
        "productSummaries": [
            {
                "epid": "1",
                "title": "Testprodukt",
                "brand": "Marke",
                "image": {"imageUrl": "https://img/1.jpg"},
                "categoryIds": ["9355"],
            }
        ]
    },
    "item_summary/search": {
        "itemSummaries": [
            {"price": {"value": "100.00", "currency": "EUR"}},
            {"price": {"value": "110.00", "currency": "EUR"}},
            {"price": {"value": "90.00", "currency": "EUR"}},
        ]
    },
    "get_default_category_tree_id": {"categoryTreeId": "77"},
    "get_item_aspects_for_category": {"aspects": []},
}


def test_large_batch_enriches_completely(db, settings):
    taxonomy._tree_id.cache_clear()
    pipeline = Pipeline(settings, FakeEbayClient(settings, RESPONSES), FakeAI())

    with get_session() as session:
        products = [Product(gtin=f"{i:013d}") for i in range(BATCH_SIZE)]
        session.add_all(products)
        session.commit()
        product_ids = [p.id for p in products]

    # Same bounded parallelism the UI uses.
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(pipeline.enrich, product_ids))

    with get_session() as session:
        states = [session.get(Product, pid).state for pid in product_ids]

    assert len(states) == BATCH_SIZE
    assert all(s in TERMINAL_STATES for s in states)
    assert states.count(ProductState.READY) == BATCH_SIZE


def test_one_bad_product_does_not_stop_the_batch(db, settings):
    """A single item failing must not take the other 59 down with it."""
    taxonomy._tree_id.cache_clear()

    class FlakyClient(FakeEbayClient):
        def request(self, method, path, **kwargs):
            # The poison item's barcode triggers an eBay-side failure.
            if kwargs.get("params", {}).get("gtin") == "6666666666666":
                raise RuntimeError("eBay rejected this request")
            return super().request(method, path, **kwargs)

    pipeline = Pipeline(settings, FlakyClient(settings, RESPONSES), FakeAI())

    with get_session() as session:
        products = [Product(gtin=f"{i:013d}") for i in range(10)]
        products.append(Product(gtin="6666666666666"))
        session.add_all(products)
        session.commit()
        product_ids = [p.id for p in products]

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(pipeline.enrich, product_ids))

    with get_session() as session:
        results = {
            session.get(Product, pid).gtin: session.get(Product, pid).state
            for pid in product_ids
        }

    assert results["6666666666666"] == ProductState.FAILED
    good = [state for gtin, state in results.items() if gtin != "6666666666666"]
    assert len(good) == 10
    assert all(state == ProductState.READY for state in good)


def test_failed_product_can_be_retried(db, settings):
    taxonomy._tree_id.cache_clear()

    class RecoveringClient(FakeEbayClient):
        fail = True

        def request(self, method, path, **kwargs):
            if RecoveringClient.fail:
                raise RuntimeError("temporary outage")
            return super().request(method, path, **kwargs)

    client = RecoveringClient(settings, RESPONSES)
    pipeline = Pipeline(settings, client, FakeAI())

    with get_session() as session:
        product = Product(gtin="0194252707975")
        session.add(product)
        session.commit()
        product_id = product.id

    pipeline.enrich(product_id)
    with get_session() as session:
        assert session.get(Product, product_id).state == ProductState.FAILED

    RecoveringClient.fail = False
    pipeline.enrich(product_id)
    with get_session() as session:
        product = session.get(Product, product_id)
        assert product.state == ProductState.READY
        assert product.last_error is None, "a successful retry must clear the old error"
