from __future__ import annotations

from tests.conftest import FakeEbayClient

from epay_tool.ebay.catalog import find_by_gtin

SUMMARY_RESPONSE = {
    "productSummaries": [
        {
            "epid": "24053414",
            "title": "Apple iPhone 13 128GB Midnight",
            "brand": "Apple",
            "mpn": ["MLPF3ZD/A"],
            "image": {"imageUrl": "https://img/1.jpg"},
            "additionalImages": [{"imageUrl": "https://img/2.jpg"}],
            "categoryIds": ["9355"],
            "aspects": [
                {"localizedName": "Farbe", "localizedValues": ["Midnight"]},
                {"localizedName": "Speicherkapazität", "localizedValues": ["128 GB"]},
            ],
        }
    ]
}


def test_find_by_gtin_parses_match(settings):
    client = FakeEbayClient(settings, {"product_summary/search": SUMMARY_RESPONSE})
    match = find_by_gtin(client, "0194252707975")

    assert match is not None
    assert match.epid == "24053414"
    assert match.brand == "Apple"
    assert match.mpn == "MLPF3ZD/A"
    assert match.category_ids == ["9355"]
    assert match.aspects["Speicherkapazität"] == ["128 GB"]
    assert match.image_urls == ["https://img/1.jpg", "https://img/2.jpg"]


def test_find_by_gtin_returns_none_without_match(settings):
    client = FakeEbayClient(settings, {"product_summary/search": {"productSummaries": []}})
    assert find_by_gtin(client, "0000000000000") is None


def test_title_is_truncated_to_ebay_limit(settings):
    long_title = "A" * 120
    client = FakeEbayClient(
        settings, {"product_summary/search": {"productSummaries": [{"title": long_title}]}}
    )
    match = find_by_gtin(client, "123")
    assert match is not None and len(match.title) == 80
