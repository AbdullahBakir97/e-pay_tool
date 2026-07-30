from __future__ import annotations

import pytest
from pydantic import ValidationError

from epay_tool.ai.schemas import FieldGuess, ListingCopy, ProductIdentification


def test_confident_fields_filters_by_threshold():
    ident = ProductIdentification(
        product_name=FieldGuess(value="iPhone 13", confidence=0.95),
        brand=FieldGuess(value="Apple", confidence=0.99),
        model=FieldGuess(value="A2633", confidence=0.2),  # front photo cannot show this
    )
    fields = ident.confident_fields()
    assert fields == {"product_name": "iPhone 13", "brand": "Apple"}
    assert "model" not in fields


def test_low_confidence_identification_carries_questions():
    ident = ProductIdentification(
        brand=FieldGuess(value="Apple", confidence=0.98),
        model=FieldGuess(value="unbekannt", confidence=0.1),
        questions=["Bitte Rückseite fotografieren, um das Modell zu bestimmen."],
        photo_suggestions=["Foto der Rückseite", "Foto des Displays im Einschaltzustand"],
    )
    assert ident.questions
    assert len(ident.photo_suggestions) == 2


def test_confidence_must_be_within_range():
    with pytest.raises(ValidationError):
        FieldGuess(value="x", confidence=1.5)


def test_listing_copy_enforces_title_limit():
    with pytest.raises(ValidationError):
        ListingCopy(title="x" * 81, description_html="<p>x</p>")
