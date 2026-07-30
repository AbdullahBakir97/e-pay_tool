"""eBay Inventory API - create drafts and publish listings.

Flow per product: inventory item (PUT by SKU) -> offer (price, category,
policies) -> publish. Offers stay unpublished until the user clicks
"Post", which is exactly the one-click review step of the app.
"""

from __future__ import annotations

from epay_tool.db.models import Product
from epay_tool.ebay.client import EbayClient

MERCHANT_LOCATION_KEY = "DEFAULT_LOCATION"


def ensure_location(client: EbayClient, postal_code: str, city: str, country: str = "DE") -> None:
    """Create the default merchant location if it does not exist yet."""
    try:
        client.get(f"/sell/inventory/v1/location/{MERCHANT_LOCATION_KEY}")
        return
    except Exception:
        pass
    client.post(
        f"/sell/inventory/v1/location/{MERCHANT_LOCATION_KEY}",
        json={
            "location": {
                "address": {"postalCode": postal_code, "city": city, "country": country}
            },
            "locationTypes": ["WAREHOUSE"],
            "merchantLocationStatus": "ENABLED",
            "name": "Standardstandort",
        },
    )


def build_inventory_item(product: Product, image_urls: list[str]) -> dict:
    item: dict = {
        "condition": product.condition or "NEW",
        "availability": {"shipToLocationAvailability": {"quantity": product.quantity}},
        "product": {
            "title": product.title,
            "description": product.description or product.title,
            "imageUrls": image_urls,
        },
    }
    if product.brand:
        item["product"]["brand"] = product.brand
    if product.mpn:
        item["product"]["mpn"] = product.mpn
    if product.gtin:
        item["product"]["ean"] = [product.gtin]
    if product.epid:
        item["product"]["epid"] = product.epid
    if product.aspects:
        item["product"]["aspects"] = product.aspects
    return item


def upsert_inventory_item(client: EbayClient, product: Product, image_urls: list[str]) -> None:
    client.put(
        f"/sell/inventory/v1/inventory_item/{product.sku}",
        json=build_inventory_item(product, image_urls),
        headers={"Content-Language": client.settings.content_language},
    )


def create_or_update_offer(
    client: EbayClient,
    product: Product,
    *,
    fulfillment_policy_id: str,
    payment_policy_id: str,
    return_policy_id: str,
) -> str:
    """Create (or update) the offer for a SKU. Returns the offer id."""
    offer = {
        "sku": product.sku,
        "marketplaceId": client.settings.ebay_marketplace,
        "format": "FIXED_PRICE",
        "availableQuantity": product.quantity,
        "categoryId": product.category_id,
        "merchantLocationKey": MERCHANT_LOCATION_KEY,
        "pricingSummary": {
            "price": {"value": f"{product.price:.2f}", "currency": product.currency}
        },
        "listingPolicies": {
            "fulfillmentPolicyId": fulfillment_policy_id,
            "paymentPolicyId": payment_policy_id,
            "returnPolicyId": return_policy_id,
        },
    }
    if product.offer_id:
        client.put(f"/sell/inventory/v1/offer/{product.offer_id}", json=offer)
        return product.offer_id
    data = client.post("/sell/inventory/v1/offer", json=offer)
    return data["offerId"]


def publish_offer(client: EbayClient, offer_id: str) -> str:
    """Publish the offer. Returns the live eBay listing id."""
    data = client.post(f"/sell/inventory/v1/offer/{offer_id}/publish")
    return data["listingId"]


def list_policies(client: EbayClient) -> dict:
    """Fetch the seller's business policies so the UI can offer a picker."""
    marketplace = client.settings.ebay_marketplace
    return {
        "fulfillment": client.get(
            "/sell/account/v1/fulfillment_policy", params={"marketplace_id": marketplace}
        ).get("fulfillmentPolicies", []),
        "payment": client.get(
            "/sell/account/v1/payment_policy", params={"marketplace_id": marketplace}
        ).get("paymentPolicies", []),
        "return": client.get(
            "/sell/account/v1/return_policy", params={"marketplace_id": marketplace}
        ).get("returnPolicies", []),
    }
