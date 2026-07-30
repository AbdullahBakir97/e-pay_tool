"""eBay Taxonomy API - category suggestions and required item aspects.

The list of *required* aspects for a category is what lets the app decide
deterministically whether a draft is complete or must go to NEEDS_INFO.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from epay_tool.ebay.client import EbayClient


@dataclass
class AspectRequirement:
    name: str
    required: bool
    allowed_values: list[str]


@lru_cache(maxsize=1)
def _tree_id(client: EbayClient) -> str:
    data = client.get(
        "/commerce/taxonomy/v1/get_default_category_tree_id",
        params={"marketplace_id": client.settings.ebay_marketplace},
        token="app",
    )
    return data["categoryTreeId"]


def suggest_category(client: EbayClient, query: str) -> tuple[str, str] | None:
    """Best (category_id, category_name) suggestion for a product title."""
    tree = _tree_id(client)
    data = client.get(
        f"/commerce/taxonomy/v1/category_tree/{tree}/get_category_suggestions",
        params={"q": query},
        token="app",
    )
    suggestions = data.get("categorySuggestions") or []
    if not suggestions:
        return None
    cat = suggestions[0]["category"]
    return cat["categoryId"], cat["categoryName"]


def aspects_for_category(client: EbayClient, category_id: str) -> list[AspectRequirement]:
    tree = _tree_id(client)
    data = client.get(
        f"/commerce/taxonomy/v1/category_tree/{tree}/get_item_aspects_for_category",
        params={"category_id": category_id},
        token="app",
    )
    result: list[AspectRequirement] = []
    for aspect in data.get("aspects") or []:
        constraint = aspect.get("aspectConstraint", {})
        result.append(
            AspectRequirement(
                name=aspect["localizedAspectName"],
                required=constraint.get("aspectRequired", False),
                allowed_values=[
                    v["localizedValue"] for v in aspect.get("aspectValues", [])[:50]
                ],
            )
        )
    return result
