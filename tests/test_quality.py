from __future__ import annotations

from epay_tool.core.quality import Severity, check_draft, has_blockers
from epay_tool.db.models import Photo, Product
from epay_tool.ebay.taxonomy import AspectRequirement


def complete_product() -> Product:
    product = Product(
        title="Apple iPhone 13 128GB Schwarz",
        price=399.0,
        category_id="9355",
        condition="USED_GOOD",
        description="<p>Guter Zustand</p>",
        aspects={"Marke": ["Apple"]},
    )
    product.photos = [Photo(path=f"/tmp/{i}.jpg", position=i) for i in range(3)]
    return product


def test_complete_draft_has_no_blockers():
    assert not has_blockers(check_draft(complete_product()))


def test_missing_price_and_category_block():
    product = complete_product()
    product.price = None
    product.category_id = None
    messages = [i.message for i in check_draft(product) if i.severity == Severity.BLOCKER]
    assert any("Preis" in m for m in messages)
    assert any("Kategorie" in m for m in messages)


def test_title_over_80_chars_blocks():
    product = complete_product()
    product.title = "x" * 81
    assert has_blockers(check_draft(product))


def test_missing_photos_blocks_but_few_photos_only_warns():
    product = complete_product()
    product.photos = []
    assert has_blockers(check_draft(product))

    product.photos = [Photo(path="/tmp/1.jpg", position=0)]
    issues = check_draft(product)
    assert not has_blockers(issues)
    assert any(i.severity == Severity.WARNING for i in issues)


def test_required_category_aspect_blocks_when_missing():
    product = complete_product()
    required = [
        AspectRequirement(name="Speicherkapazität", required=True, allowed_values=["128 GB"]),
        AspectRequirement(name="Farbe", required=False, allowed_values=["Schwarz"]),
    ]
    issues = check_draft(product, required)
    assert has_blockers(issues)
    assert any("Speicherkapazität" in i.message for i in issues)

    product.aspects = {**product.aspects, "Speicherkapazität": ["128 GB"]}
    assert not has_blockers(check_draft(product, required))
