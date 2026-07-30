"""Product enrichment and publishing pipeline.

Enrichment per product:

  1. Barcode -> eBay Catalog API (exact match: title, brand, aspects, EPID)
  2. No match + photos -> AI identification (with questions on uncertainty)
  3. Category + required aspects via Taxonomy API
  4. Market price research via Browse API -> price suggestion
  5. Missing title/description -> AI copywriting
  6. Deterministic quality check -> READY or NEEDS_INFO

Each step is defensive: a failing step records the problem and moves the
product to NEEDS_INFO/FAILED instead of crashing a 100-item batch.
"""

from __future__ import annotations

import logging
from pathlib import Path

from epay_tool.ai.provider import AIProvider
from epay_tool.config import Settings
from epay_tool.core import pricing, quality
from epay_tool.db.models import DataSource, Photo, Product, ProductState
from epay_tool.db.session import get_session
from epay_tool.ebay import browse, catalog, inventory, media, taxonomy
from epay_tool.ebay.client import EbayClient

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, settings: Settings, client: EbayClient, ai: AIProvider):
        self.settings = settings
        self.client = client
        self.ai = ai

    # ---------------- enrichment ----------------

    def enrich(self, product_id: int) -> None:
        with get_session() as session:
            product = session.get(Product, product_id)
            if product is None:
                return
            product.state = ProductState.ENRICHING
            product.last_error = None
            session.commit()

            try:
                self._enrich_inner(product)
                issues = self._final_check(product)
                product.state = (
                    ProductState.NEEDS_INFO
                    if quality.has_blockers(issues) or product.ai_questions
                    else ProductState.READY
                )
            except Exception as exc:  # keep the batch alive
                log.exception("Enrichment failed for product %s", product_id)
                product.state = ProductState.FAILED
                product.last_error = str(exc)
            session.commit()

    def _enrich_inner(self, product: Product) -> None:
        if not product.condition:
            product.condition = self.settings.default_condition

        # 1. Catalog lookup by barcode
        if product.gtin and not product.title:
            match = catalog.find_by_gtin(self.client, product.gtin)
            if match:
                self._apply_catalog(product, match)

        # 2. AI fallback from photos
        if not product.title and product.photos:
            self._ai_identify(product)

        # 3. Category + required aspects
        if not product.category_id and product.title:
            suggestion = taxonomy.suggest_category(self.client, product.title)
            if suggestion:
                product.category_id = suggestion[0]

        # 4. Price research
        if product.price is None:
            stats = browse.price_research(
                self.client, gtin=product.gtin, query=product.title
            )
            if stats:
                product.price_stats = stats.to_dict()
                product.price = pricing.suggest_price(
                    stats, self.settings.undercut_percent
                )

        # 5. Copywriting
        if product.title and not product.description:
            facts = {
                "title": product.title,
                "brand": product.brand,
                "mpn": product.mpn,
                "condition": product.condition,
                "aspects": product.aspects,
                "notes": product.user_notes,
            }
            copy = self.ai.write_copy({k: v for k, v in facts.items() if v})
            product.title = copy.title[:80]
            product.description = copy.description_html

    def _apply_catalog(self, product: Product, match: catalog.CatalogMatch) -> None:
        product.source = DataSource.CATALOG
        product.epid = match.epid
        product.title = match.title
        product.brand = match.brand or product.brand
        product.mpn = match.mpn or product.mpn
        product.aspects = {**match.aspects, **(product.aspects or {})}
        if match.category_ids and not product.category_id:
            product.category_id = match.category_ids[0]

        # Catalog images are already eBay-hosted, so they need no upload and
        # make a barcode-only scan directly listable for new goods.
        if not product.photos:
            product.photos = [
                Photo(path="", ebay_url=url, position=i)
                for i, url in enumerate(match.image_urls[:12])
            ]

    def _ai_identify(self, product: Product) -> None:
        known = {
            k: v
            for k, v in {"gtin": product.gtin, "brand": product.brand}.items()
            if v
        }
        result = self.ai.identify_product(
            [Path(p.path) for p in product.photos],
            known=known,
            notes=product.user_notes,
        )
        product.source = DataSource.AI
        fields = result.confident_fields()
        if "product_name" in fields:
            name = fields["product_name"]
            brand = fields.get("brand", "")
            model = fields.get("model", "")
            parts = [p for p in (brand, name if name != brand else "", model) if p]
            product.title = " ".join(dict.fromkeys(" ".join(parts).split()))[:80]
        product.brand = fields.get("brand") or product.brand
        # Only confident values may reach the listing; an uncertain model guess
        # becomes a question to the user instead of a fabricated part number.
        product.mpn = product.mpn or fields.get("model")
        confident_aspects = {
            name: [guess.value]
            for name, guess in result.aspects.items()
            if guess.confidence >= 0.8
        }
        product.aspects = {**confident_aspects, **(product.aspects or {})}
        product.ai_questions = result.questions or None
        product.ai_suggestions = result.photo_suggestions or None
        product.ai_confidence = {
            name: guess.confidence
            for name, guess in {
                "product_name": result.product_name,
                "brand": result.brand,
                "model": result.model,
                **result.aspects,
            }.items()
            if guess
        }

    def _final_check(self, product: Product) -> list[quality.Issue]:
        required = []
        if product.category_id:
            try:
                required = taxonomy.aspects_for_category(
                    self.client, product.category_id
                )
            except Exception:
                log.warning("Could not load required aspects", exc_info=True)
        return quality.check_draft(product, required)

    # ---------------- publishing ----------------

    def publish(
        self,
        product_id: int,
        *,
        fulfillment_policy_id: str,
        payment_policy_id: str,
        return_policy_id: str,
    ) -> None:
        """Upload photos, create the offer and publish it - the 'one click'."""
        with get_session() as session:
            product = session.get(Product, product_id)
            if product is None:
                return
            product.state = ProductState.POSTING
            session.commit()
            try:
                image_urls = []
                for photo in product.photos:
                    if not photo.ebay_url:
                        photo.ebay_url = media.upload_image(self.client, Path(photo.path))
                    image_urls.append(photo.ebay_url)

                inventory.upsert_inventory_item(self.client, product, image_urls)
                product.offer_id = inventory.create_or_update_offer(
                    self.client,
                    product,
                    fulfillment_policy_id=fulfillment_policy_id,
                    payment_policy_id=payment_policy_id,
                    return_policy_id=return_policy_id,
                )
                product.listing_id = inventory.publish_offer(self.client, product.offer_id)
                product.state = ProductState.POSTED
            except Exception as exc:
                log.exception("Publishing failed for product %s", product_id)
                product.state = ProductState.FAILED
                product.last_error = str(exc)
            session.commit()
