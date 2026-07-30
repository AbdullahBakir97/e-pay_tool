"""eBay Browse API - market price research for a product."""

from __future__ import annotations

from epay_tool.core.pricing import PriceStats
from epay_tool.ebay.client import EbayClient


def price_research(
    client: EbayClient, gtin: str | None = None, query: str | None = None
) -> PriceStats | None:
    """Collect current asking prices for comparable live listings.

    Prefers an exact GTIN match; falls back to a keyword search. Note these
    are *asking* prices - actual sold prices need the Marketplace Insights
    API (separate eBay approval), which can be plugged in here later.
    """
    params: dict = {"limit": 50}
    if gtin:
        params["gtin"] = gtin
    elif query:
        params["q"] = query
    else:
        return None

    data = client.get("/buy/browse/v1/item_summary/search", params=params, token="app")
    prices: list[float] = []
    currency = client.settings.currency
    for item in data.get("itemSummaries") or []:
        price = item.get("price") or {}
        if price.get("convertedFromValue"):
            continue  # skip foreign-currency listings to keep stats clean
        try:
            value = float(price["value"])
        except (KeyError, TypeError, ValueError):
            continue
        if price.get("currency") == currency:
            prices.append(value)

    if not prices:
        return None
    return PriceStats.from_prices(prices, currency)
