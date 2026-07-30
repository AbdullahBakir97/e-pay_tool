"""Thin HTTP client for eBay REST APIs with retries and error mapping."""

from __future__ import annotations

import time
from typing import Any, Literal

import httpx

from epay_tool.config import Settings
from epay_tool.ebay.auth import EbayAuth

RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 4


class EbayApiError(RuntimeError):
    def __init__(self, status: int, message: str, errors: list[dict] | None = None):
        super().__init__(f"eBay API error {status}: {message}")
        self.status = status
        self.errors = errors or []


class EbayClient:
    def __init__(self, settings: Settings, auth: EbayAuth):
        self.settings = settings
        self.auth = auth
        self._http = httpx.Client(base_url=settings.api_base, timeout=30)

    def request(
        self,
        method: str,
        path: str,
        *,
        token: Literal["user", "app"] = "user",
        params: dict | None = None,
        json: Any | None = None,
        headers: dict | None = None,
    ) -> dict:
        s = self.settings
        hdrs = {
            "X-EBAY-C-MARKETPLACE-ID": s.ebay_marketplace,
            "Content-Language": s.content_language,
            "Accept-Language": s.content_language,
        }
        if headers:
            hdrs.update(headers)

        backoff = 1.0
        for attempt in range(MAX_RETRIES + 1):
            bearer = self.auth.user_token() if token == "user" else self.auth.app_token()
            hdrs["Authorization"] = f"Bearer {bearer}"
            resp = self._http.request(method, path, params=params, json=json, headers=hdrs)

            if resp.status_code in RETRY_STATUS and attempt < MAX_RETRIES:
                time.sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code >= 400:
                errors = []
                message = resp.text[:300]
                try:
                    body = resp.json()
                    errors = body.get("errors", [])
                    if errors:
                        message = "; ".join(e.get("message", "") for e in errors)
                except Exception:
                    pass
                raise EbayApiError(resp.status_code, message, errors)
            if resp.status_code == 204 or not resp.content:
                return {}
            return resp.json()

        raise EbayApiError(0, "unreachable")  # pragma: no cover

    def get(self, path: str, **kw) -> dict:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw) -> dict:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw) -> dict:
        return self.request("PUT", path, **kw)
