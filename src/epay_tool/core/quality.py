"""Deterministic completeness checks for a listing draft.

These rules (not the AI) decide whether a product is READY or NEEDS_INFO.
The AI adds *soft* suggestions on top; hard requirements are code.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from epay_tool.db.models import Product
from epay_tool.ebay.taxonomy import AspectRequirement

MAX_TITLE_LEN = 80
RECOMMENDED_MIN_PHOTOS = 3


class Severity(StrEnum):
    BLOCKER = "BLOCKER"  # cannot be posted
    WARNING = "WARNING"  # can be posted, but should be improved


@dataclass
class Issue:
    severity: Severity
    message: str


def check_draft(
    product: Product,
    required_aspects: list[AspectRequirement] | None = None,
) -> list[Issue]:
    issues: list[Issue] = []

    if not product.title:
        issues.append(Issue(Severity.BLOCKER, "Titel fehlt."))
    elif len(product.title) > MAX_TITLE_LEN:
        issues.append(
            Issue(Severity.BLOCKER, f"Titel ist länger als {MAX_TITLE_LEN} Zeichen.")
        )

    if product.price is None or product.price <= 0:
        issues.append(Issue(Severity.BLOCKER, "Preis fehlt."))
    if not product.category_id:
        issues.append(Issue(Severity.BLOCKER, "Kategorie fehlt."))
    if not product.condition:
        issues.append(Issue(Severity.BLOCKER, "Artikelzustand fehlt."))
    if not product.description:
        issues.append(Issue(Severity.WARNING, "Beschreibung fehlt."))

    photo_count = len(product.photos)
    own_photos = [p for p in product.photos if p.path]
    if photo_count == 0:
        issues.append(Issue(Severity.BLOCKER, "Mindestens ein Foto wird benötigt."))
    elif photo_count < RECOMMENDED_MIN_PHOTOS:
        issues.append(
            Issue(
                Severity.WARNING,
                f"Nur {photo_count} Foto(s) - empfohlen sind alle Seiten des Artikels.",
            )
        )
    # Stock images may not represent a used item's actual condition.
    if product.condition and product.condition != "NEW" and not own_photos:
        issues.append(
            Issue(
                Severity.WARNING,
                "Gebrauchtartikel ohne eigene Fotos - bitte echte Fotos des Artikels ergänzen.",
            )
        )

    aspects = product.aspects or {}
    for req in required_aspects or []:
        if req.required and not aspects.get(req.name):
            issues.append(
                Issue(Severity.BLOCKER, f"Pflichtangabe fehlt: {req.name}")
            )

    return issues


def has_blockers(issues: list[Issue]) -> bool:
    return any(i.severity == Severity.BLOCKER for i in issues)
