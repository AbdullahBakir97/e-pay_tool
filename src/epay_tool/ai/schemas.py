"""Structured AI output contracts.

Every AI call returns validated JSON matching these models. Per-field
confidence plus explicit open questions is what turns the AI from a
guesser into an assistant that *asks* when it cannot know (e.g. an
iPhone photographed only from the front).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class FieldGuess(BaseModel):
    value: str
    confidence: float = Field(ge=0.0, le=1.0, description="0 = pure guess, 1 = certain")


class ProductIdentification(BaseModel):
    product_name: FieldGuess | None = None
    brand: FieldGuess | None = None
    model: FieldGuess | None = None
    category_hint: str | None = Field(
        default=None, description="Short product category, e.g. 'Smartphone', 'Herren-Sneaker'"
    )
    aspects: dict[str, FieldGuess] = Field(
        default_factory=dict,
        description="Item specifics such as Farbe, Größe, Speicherkapazität",
    )
    condition_hint: str | None = Field(
        default=None, description="Visible condition, e.g. 'gebraucht, Kratzer am Gehäuse'"
    )
    questions: list[str] = Field(
        default_factory=list,
        description="Questions to the user for anything that cannot be determined from the photos",
    )
    photo_suggestions: list[str] = Field(
        default_factory=list,
        description="Concrete suggestions for additional/better photos",
    )

    def confident_fields(self, threshold: float = 0.8) -> dict[str, str]:
        """Fields safe to auto-fill; low-confidence ones become questions."""
        out: dict[str, str] = {}
        for name in ("product_name", "brand", "model"):
            guess: FieldGuess | None = getattr(self, name)
            if guess and guess.confidence >= threshold:
                out[name] = guess.value
        return out


class ListingCopy(BaseModel):
    title: str = Field(max_length=80, description="eBay title, max 80 characters, keyword-rich")
    description_html: str = Field(description="Clean HTML description in German")


class ListingReview(BaseModel):
    issues: list[str] = Field(
        default_factory=list, description="Problems that should block posting"
    )
    suggestions: list[str] = Field(default_factory=list, description="Optional improvements")
