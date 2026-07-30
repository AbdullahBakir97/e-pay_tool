from __future__ import annotations

import pytest

from epay_tool.ai.provider import AIProvider
from epay_tool.ai.schemas import ListingCopy, ListingReview, ProductIdentification
from epay_tool.config import Settings
from epay_tool.db.session import init_db


@pytest.fixture
def settings() -> Settings:
    return Settings(
        ebay_env="sandbox",
        ebay_client_id="test-id",
        ebay_client_secret="test-secret",
        ai_provider="none",
    )


@pytest.fixture
def db(tmp_path):
    """Fresh file-backed SQLite database per test."""
    init_db(f"sqlite:///{tmp_path / 'test.db'}")
    yield


class FakeAI(AIProvider):
    """Records calls and returns whatever the test configured."""

    def __init__(
        self,
        identification: ProductIdentification | None = None,
        copy: ListingCopy | None = None,
    ):
        self.identification = identification or ProductIdentification()
        self.copy = copy or ListingCopy(title="Testartikel", description_html="<p>Test</p>")
        self.identify_calls: list[dict] = []
        self.copy_calls: list[dict] = []

    def identify_product(self, photos, known=None, notes=None) -> ProductIdentification:
        self.identify_calls.append({"photos": list(photos), "known": known, "notes": notes})
        return self.identification

    def write_copy(self, facts) -> ListingCopy:
        self.copy_calls.append(facts)
        return self.copy

    def review_listing(self, draft) -> ListingReview:
        return ListingReview()


class FakeEbayClient:
    """Serves canned JSON per (method, path) so no network is touched."""

    def __init__(self, settings: Settings, responses: dict | None = None):
        self.settings = settings
        self.responses = responses or {}
        self.calls: list[tuple[str, str, dict | None]] = []

    def request(self, method, path, *, token="user", params=None, json=None, headers=None):
        self.calls.append((method, path, params))
        for key, value in self.responses.items():
            if key in path:
                return value() if callable(value) else value
        return {}

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, **kw):
        return self.request("POST", path, **kw)

    def put(self, path, **kw):
        return self.request("PUT", path, **kw)


@pytest.fixture
def fake_ai() -> FakeAI:
    return FakeAI()


@pytest.fixture
def fake_client(settings) -> FakeEbayClient:
    return FakeEbayClient(settings)
