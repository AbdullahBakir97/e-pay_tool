"""eBay OAuth2.

Two token kinds are used:

* **User token** (authorization-code flow) — required by the Sell APIs
  (Inventory, Account). Obtained once via a browser consent screen; the
  refresh token (~18 months) is stored in the OS keychain and access
  tokens are refreshed silently afterwards.
* **Application token** (client-credentials flow) — enough for read-only
  Buy/Commerce APIs (Browse, Catalog, Taxonomy).

Desktop-app note: eBay redirects to the "accept URL" configured for the
app's RuName. Point that URL at ``http://localhost:<port>/callback`` so
the tiny loopback server below can capture the authorization code.
"""

from __future__ import annotations

import base64
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from epay_tool.config import Settings, load_secret, store_secret

USER_SCOPES = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
]
APP_SCOPES = ["https://api.ebay.com/oauth/api_scope"]


class AuthError(RuntimeError):
    pass


class _CallbackHandler(BaseHTTPRequestHandler):
    """Captures ?code=... from the OAuth redirect."""

    code: str | None = None

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        _CallbackHandler.code = (query.get("code") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        msg = (
            "<h2>Anmeldung erfolgreich.</h2><p>Sie können dieses Fenster schließen.</p>"
            if _CallbackHandler.code
            else "<h2>Anmeldung fehlgeschlagen.</h2>"
        )
        self.wfile.write(msg.encode("utf-8"))

    def log_message(self, *args):  # silence default request logging
        pass


class EbayAuth:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._user_token: str | None = None
        self._user_token_expiry: float = 0.0
        self._app_token: str | None = None
        self._app_token_expiry: float = 0.0
        self._refresh_key = f"ebay_refresh_token_{settings.ebay_env}"

    # ---------------- public API ----------------

    @property
    def has_user_consent(self) -> bool:
        return load_secret(self._refresh_key) is not None

    def user_token(self) -> str:
        """Valid user access token, refreshing if needed."""
        if self._user_token and time.time() < self._user_token_expiry - 60:
            return self._user_token
        refresh_token = load_secret(self._refresh_key)
        if not refresh_token:
            raise AuthError("No eBay consent yet - run interactive_login() first.")
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": " ".join(USER_SCOPES),
        }
        payload = self._token_request(data)
        self._user_token = payload["access_token"]
        self._user_token_expiry = time.time() + int(payload.get("expires_in", 7200))
        return self._user_token

    def app_token(self) -> str:
        """Valid application token (client credentials)."""
        if self._app_token and time.time() < self._app_token_expiry - 60:
            return self._app_token
        data = {"grant_type": "client_credentials", "scope": " ".join(APP_SCOPES)}
        payload = self._token_request(data)
        self._app_token = payload["access_token"]
        self._app_token_expiry = time.time() + int(payload.get("expires_in", 7200))
        return self._app_token

    def interactive_login(self, timeout_s: int = 300) -> None:
        """Open the browser consent screen and wait for the redirect."""
        s = self.settings
        params = {
            "client_id": s.ebay_client_id,
            "response_type": "code",
            "redirect_uri": s.ebay_ru_name,
            "scope": " ".join(USER_SCOPES),
        }
        url = f"{s.auth_base}/oauth2/authorize?{urlencode(params)}"

        _CallbackHandler.code = None
        server = HTTPServer(("127.0.0.1", s.oauth_callback_port), _CallbackHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            webbrowser.open(url)
            deadline = time.time() + timeout_s
            while _CallbackHandler.code is None and time.time() < deadline:
                time.sleep(0.2)
        finally:
            server.shutdown()

        if not _CallbackHandler.code:
            raise AuthError("Timed out waiting for the eBay login redirect.")
        self._exchange_code(_CallbackHandler.code)

    # ---------------- internals ----------------

    def _exchange_code(self, code: str) -> None:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.settings.ebay_ru_name,
        }
        payload = self._token_request(data)
        self._user_token = payload["access_token"]
        self._user_token_expiry = time.time() + int(payload.get("expires_in", 7200))
        if "refresh_token" in payload:
            store_secret(self._refresh_key, payload["refresh_token"])

    def _token_request(self, data: dict) -> dict:
        s = self.settings
        basic = base64.b64encode(
            f"{s.ebay_client_id}:{s.ebay_client_secret}".encode()
        ).decode()
        resp = httpx.post(
            f"{s.api_base}/identity/v1/oauth2/token",
            data=data,
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=30,
        )
        if resp.status_code != 200:
            raise AuthError(f"Token request failed ({resp.status_code}): {resp.text[:300]}")
        return resp.json()
