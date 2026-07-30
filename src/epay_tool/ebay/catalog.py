"""eBay Catalog API - identify a product from its barcode (GTIN/EAN/UPC).

This is the primary enrichment path: for most retail products a single
call returns the exact catalog entry with title, brand, aspects and
stock images - no AI involved.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from epay_tool.ebay.client import EbayClient


@dataclass
class CatalogMatch:
    epid: str
    title: str
    brand: str | None = None
    mpn: str | None = None
    image_urls: list[str] = field(default_factory=list)
    aspects: dict[str, list[str]] = field(default_factory=dict)
    category_ids: list[str] = field(default_factory=list)


def _first_mpn(value: str | list[str] | None) -> str | None:
    """The catalog returns the manufacturer part number as a string or a list."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def find_by_gtin(client: EbayClient, gtin: str) -> CatalogMatch | None:
    """Search the eBay catalog by barcode. Returns the best match or None."""
    data = client.get(
        "/commerce/catalog/v1/product_summary/search",
        params={"gtin": gtin, "limit": 5},
        token="app",
    )
    summaries = data.get("productSummaries") or []
    if not summaries:
        return None
    best = summaries[0]
    product_id = best.get("epid") or best.get("productId", "")
    match = CatalogMatch(
        epid=product_id,
        title=(best.get("title") or "")[:80],
        brand=best.get("brand"),
        mpn=_first_mpn(best.get("mpn")),
        image_urls=[
            img["imageUrl"]
            for img in ([best.get("image")] if best.get("image") else [])
            + (best.get("additionalImages") or [])
            if img and img.get("imageUrl")
        ],
        category_ids=best.get("categoryIds") or [],
    )
    for aspect in best.get("aspects") or []:
        name, values = aspect.get("localizedName"), aspect.get("localizedValues")
        if name and values:
            match.aspects[name] = values
    return match
