"""Provider-agnostic AI interface.

The app never talks to a specific model directly - it talks to this
interface. Swapping Gemini for a local Ollama model (or any future
provider) is a config change, not a refactor.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from epay_tool.ai.schemas import ListingCopy, ListingReview, ProductIdentification
from epay_tool.config import Settings


class AIProvider(ABC):
    @abstractmethod
    def identify_product(
        self,
        photos: list[Path],
        known: dict[str, str] | None = None,
        notes: str | None = None,
    ) -> ProductIdentification:
        """Identify a product from photos; ask questions where uncertain."""

    @abstractmethod
    def write_copy(self, facts: dict) -> ListingCopy:
        """Generate title (<=80 chars) and HTML description from known facts."""

    @abstractmethod
    def review_listing(self, draft: dict) -> ListingReview:
        """Soft quality review of a complete draft before posting."""


class NullProvider(AIProvider):
    """Used when AI is disabled - the app still works for barcode matches."""

    def identify_product(self, photos, known=None, notes=None) -> ProductIdentification:
        return ProductIdentification(
            questions=["KI ist deaktiviert - bitte Produktdaten manuell eintragen."]
        )

    def write_copy(self, facts) -> ListingCopy:
        title = str(facts.get("title") or facts.get("product_name") or "")[:80]
        return ListingCopy(title=title, description_html=f"<p>{title}</p>")

    def review_listing(self, draft) -> ListingReview:
        return ListingReview()


def get_provider(settings: Settings) -> AIProvider:
    name = settings.ai_provider.lower()
    if name == "gemini":
        from epay_tool.ai.gemini import GeminiProvider

        return GeminiProvider(settings)
    if name == "ollama":
        from epay_tool.ai.ollama import OllamaProvider

        return OllamaProvider(settings)
    return NullProvider()
