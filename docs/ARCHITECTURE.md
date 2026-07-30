# Architecture notes

Background for whoever maintains this next — the reasoning behind the
structure, not a restatement of the code.

## Why eBay's APIs carry the identification, not the AI

The original manual workflow was: read the barcode, search the web, read
a shop page, copy the data into the eBay form. The obvious automation is
"let an AI do that search". That would be the wrong build.

eBay already publishes the exact data the listing form wants, keyed by
the same barcode:

- **Catalog API** returns the catalog product for a GTIN — title, brand,
  MPN, item specifics, stock images, and the EPID that links a listing to
  the catalog entry.
- **Taxonomy API** returns the category and, crucially, which item
  aspects are *required* for it.
- **Browse API** returns comparable live listings for pricing.

For a catalog hit this is one round trip, exact, free, and already in
eBay's own vocabulary — no mapping layer, no hallucination risk, no
scraping fragility. AI is reserved for what the catalog genuinely cannot
answer.

Consequence for cost: AI touches only the minority of items that miss the
catalog, which is what keeps the running cost at a few euros a month.

## Confidence-gated AI

`ai/schemas.py` forces every AI answer into a structured shape where each
field carries its own confidence. `ProductIdentification.confident_fields()`
is the single gate: below the threshold, a value never reaches the
listing.

This is deliberate. A vision model asked "what is this?" will always
produce an answer; a front photo of a phone genuinely does not contain
the model number. Without the gate the app would silently publish a
confident-sounding wrong listing — the worst possible failure for a
seller, because it surfaces as a return or a policy strike, long after
the fact. With the gate, the uncertainty becomes a question in the review
panel and the user resolves it in seconds.

The same reasoning drives `pipeline._ai_identify`: a low-confidence model
guess is dropped from both the title and the `mpn` field, while the
confidence score itself is retained so the UI can show how sure the AI
was.

## Hard rules in code, soft advice from the AI

`core/quality.py` decides `READY` vs `NEEDS_INFO` deterministically:
title present and within 80 characters, price set, category set,
condition set, at least one photo, and every category-required aspect
filled. These are eBay's rules; they must be reproducible and testable,
so they are plain code.

The AI's `review_listing` contributes only *suggestions* — better photos,
missing keywords. It can never block or unblock a listing. Keeping the
boundary this sharp is what makes the app's behaviour predictable.

## The queue is the product

For a 100-item day, the queue *is* the application. State lives in SQLite
rather than in memory, so a crash, a restart, or a day split across two
sessions loses nothing. Each product carries its own state and its own
`last_error`, which is why one product hitting an eBay error cannot stop
the batch — `Pipeline.enrich` catches per product and records the failure
instead of propagating it.

Enrichment runs on a bounded `QThreadPool` (`core/worker.py`). Bounded,
not unbounded: eBay rate-limits per application, and 100 simultaneous
requests would trip the limit for no wall-clock gain.

## Provider abstraction

`ai/provider.py` defines the interface; `gemini.py` and `ollama.py`
implement it; `NullProvider` keeps the app fully functional with AI
switched off. Nothing outside `ai/` imports a vendor SDK.

This exists because the AI landscape moves faster than the app will. A
better or cheaper model should be a new file plus a config value, and a
provider outage should be a config change, not downtime.

## Publishing is deliberately two-phase

`sell/inventory` separates the inventory item, the offer, and publishing.
The app stops after creating the offer and only publishes on an explicit
click. That maps exactly onto the requirement — review, edit, then post —
and means a mistake caught during review costs nothing, because nothing
is live yet.

## Where to extend

- **Sold prices**: `ebay/browse.py` returns `PriceStats`. Marketplace
  Insights (separate eBay approval) can populate the same structure from
  actual sold data; nothing downstream changes.
- **Bulk publishing**: the Inventory API has `bulk_create_offer` and
  `bulk_publish_offer` (25 items per call). `pipeline.publish` is
  per-product for clear per-item error reporting; batching is the next
  optimization if publishing throughput ever becomes the bottleneck.
- **Camera scanning**: the scan field accepts any text, so a USB scanner
  works today with no code. Webcam decoding would be a new widget writing
  into the same field.
- **Multi-marketplace**: `Settings.ebay_marketplace` and
  `content_language` are already threaded through the client. Listing on
  another eBay site is a settings change plus prompts in that language.
