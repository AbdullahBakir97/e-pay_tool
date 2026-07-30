"""Image upload to eBay Picture Services (Media API)."""

from __future__ import annotations

from pathlib import Path

import httpx

from epay_tool.ebay.client import EbayApiError, EbayClient

# The Media API lives on a separate host than the other REST APIs.
_MEDIA_HOSTS = {
    True: "https://apim.ebay.com",           # production
    False: "https://apim.sandbox.ebay.com",  # sandbox
}


def upload_image(client: EbayClient, path: Path) -> str:
    """Upload a local image; returns the eBay-hosted image URL."""
    host = _MEDIA_HOSTS[client.settings.is_production]
    token = client.auth.user_token()
    with path.open("rb") as fh:
        resp = httpx.post(
            f"{host}/commerce/media/v1/image",
            files={"image": (path.name, fh, "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
    if resp.status_code not in (200, 201):
        raise EbayApiError(resp.status_code, f"Image upload failed: {resp.text[:300]}")
    # The created image URL is returned in the Location header / body.
    if "Location" in resp.headers:
        image_id = resp.headers["Location"].rstrip("/").rsplit("/", 1)[-1]
        info = client.get(f"/commerce/media/v1/image/{image_id}")
        return info.get("imageUrl", "")
    return resp.json().get("imageUrl", "")
