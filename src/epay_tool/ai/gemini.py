"""Google Gemini implementation of the AI provider.

Uses structured output (response_schema) so every response is validated
JSON - no fragile text parsing. The free AI Studio tier is enough for
development; production use costs a few euros per month at 100+
products/day.
"""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from google import genai
from google.genai import types

from epay_tool.ai import prompts
from epay_tool.ai.provider import AIProvider
from epay_tool.ai.schemas import ListingCopy, ListingReview, ProductIdentification
from epay_tool.config import Settings

MAX_IMAGE_BYTES = 6 * 1024 * 1024


class GeminiProvider(AIProvider):
    def __init__(self, settings: Settings):
        if not settings.gemini_api_key:
            raise RuntimeError("EPAY_GEMINI_API_KEY is not configured.")
        self.model = settings.gemini_model
        self.client = genai.Client(api_key=settings.gemini_api_key)

    # ---------------- interface ----------------

    def identify_product(self, photos, known=None, notes=None) -> ProductIdentification:
        parts: list = [self._image_part(p) for p in photos[:8]]
        parts.append(
            prompts.IDENTIFY_USER_TEMPLATE.format(
                known=json.dumps(known or {}, ensure_ascii=False),
                notes=notes or "-",
            )
        )
        return self._generate(parts, prompts.IDENTIFY_SYSTEM, ProductIdentification)

    def write_copy(self, facts) -> ListingCopy:
        content = "Produktdaten:\n" + json.dumps(facts, ensure_ascii=False, indent=2)
        return self._generate([content], prompts.COPY_SYSTEM, ListingCopy)

    def review_listing(self, draft) -> ListingReview:
        content = "Angebotsentwurf:\n" + json.dumps(draft, ensure_ascii=False, indent=2)
        return self._generate([content], prompts.REVIEW_SYSTEM, ListingReview)

    # ---------------- internals ----------------

    def _generate(self, contents: list, system: str, schema: type):
        response = self.client.models.generate_content(
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0.2,
            ),
        )
        return schema.model_validate_json(response.text)

    @staticmethod
    def _image_part(path: Path) -> types.Part:
        data = path.read_bytes()
        if len(data) > MAX_IMAGE_BYTES:
            data = _downscale(path)
        mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        return types.Part.from_bytes(data=data, mime_type=mime)


def _downscale(path: Path, max_side: int = 1600) -> bytes:
    """Shrink very large photos before upload - plenty for identification."""
    import io

    from PIL import Image

    img = Image.open(path)
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=85)
    return buf.getvalue()
