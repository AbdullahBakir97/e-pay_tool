"""Optional local AI provider via Ollama (offline / zero cost).

Quality of fine-grained product identification is below Gemini - this is
a fallback mode, not the default. Requires a running Ollama server with a
vision-capable model (e.g. ``ollama pull qwen2.5vl``).
"""

from __future__ import annotations

import base64
import json

import httpx

from epay_tool.ai import prompts
from epay_tool.ai.provider import AIProvider
from epay_tool.ai.schemas import ListingCopy, ListingReview, ProductIdentification
from epay_tool.config import Settings


class OllamaProvider(AIProvider):
    def __init__(self, settings: Settings):
        self.url = settings.ollama_url.rstrip("/")
        self.model = settings.ollama_model

    def identify_product(self, photos, known=None, notes=None) -> ProductIdentification:
        images = [base64.b64encode(p.read_bytes()).decode() for p in photos[:4]]
        prompt = prompts.IDENTIFY_SYSTEM + "\n\n" + prompts.IDENTIFY_USER_TEMPLATE.format(
            known=json.dumps(known or {}, ensure_ascii=False), notes=notes or "-"
        )
        return self._generate(prompt, ProductIdentification, images=images)

    def write_copy(self, facts) -> ListingCopy:
        prompt = prompts.COPY_SYSTEM + "\n\nProduktdaten:\n" + json.dumps(facts, ensure_ascii=False)
        return self._generate(prompt, ListingCopy)

    def review_listing(self, draft) -> ListingReview:
        prompt = prompts.REVIEW_SYSTEM + "\n\nEntwurf:\n" + json.dumps(draft, ensure_ascii=False)
        return self._generate(prompt, ListingReview)

    def _generate(self, prompt: str, schema: type, images: list[str] | None = None):
        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "format": schema.model_json_schema(),  # Ollama structured output
            "stream": False,
        }
        if images:
            payload["images"] = images
        resp = httpx.post(f"{self.url}/api/generate", json=payload, timeout=300)
        resp.raise_for_status()
        return schema.model_validate_json(resp.json()["response"])
