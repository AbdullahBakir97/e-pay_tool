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

`ai/schemas.ts` forces every AI answer into a Zod-validated shape where
each field carries its own confidence. `confidentFields()` is the single
gate: below the threshold, a value never reaches the listing.

This is deliberate. A vision model asked "what is this?" will always
produce an answer; a front photo of a phone genuinely does not contain
the model number. Without the gate the app would silently publish a
confident-sounding wrong listing — the worst possible failure for a
seller, because it surfaces as a return or a policy strike long after the
fact. With the gate, the uncertainty becomes a question in the review
panel and the user resolves it in seconds.

The same reasoning drives `pipeline.applyAiIdentification`: a
low-confidence model guess is dropped from both the title and the `mpn`
field, while the confidence score itself is retained so the UI can show
how sure the AI was.

One related rule lives in the copywriting step: when a product came from
the **catalog**, the AI writes only the description, never the title. The
catalog title is the exact wording eBay holds for that EPID, and
rewriting it would contradict the catalog entry the listing is linked to.
For AI-identified products the title is the AI's own work, so it may
rewrite it freely.

## Hard rules in code, soft advice from the AI

`core/quality.ts` decides `READY` vs `NEEDS_INFO` deterministically:
title present and within 80 characters, price set, category set,
condition set, at least one photo, and every category-required aspect
filled. These are eBay's rules; they must be reproducible and testable,
so they are plain code.

The AI's `reviewListing` contributes only *suggestions* — better photos,
missing keywords. It can never block or unblock a listing. Keeping the
boundary this sharp is what makes the app's behaviour predictable.

## Degrade, do not refuse to start

An early build quit on launch when `EPAY_AI_PROVIDER=gemini` was set
without an API key — the user saw a window that never appeared. Since the
whole barcode path works with no AI at all, refusing to start was
strictly worse than starting without it. `createProvider` therefore never
throws: it falls back to `NullProvider` and reports the reason, which the
UI shows as a banner. The same principle applies inside the pipeline: a
taxonomy lookup that fails skips the required-aspect check rather than
failing the product.

## The queue is the product

For a 100-item day, the queue *is* the application. State lives in SQLite
rather than in memory, so a crash, a restart, or a day split across two
sessions loses nothing. Each product carries its own state and its own
`lastError`, which is why one product hitting an eBay error cannot stop
the batch — `Pipeline.enrich` catches per product and records the failure
instead of propagating it.

Enrichment runs through `core/queue.ts` with a concurrency limit.
Bounded, not unbounded: eBay rate-limits per application, and 100
simultaneous requests would trip the limit for no wall-clock gain.

## Process boundaries

All privileged work — database, network, filesystem, credentials — lives
in the main process. The renderer runs with `contextIsolation` on and
`nodeIntegration` off, and reaches the main process only through the
typed channels in `shared/ipc.ts`, exposed by a preload script via
`contextBridge`.

Long-running work is never awaited across IPC. `scanBarcode` returns as
soon as the row exists; enrichment is dispatched onto the queue and the
main process emits `productsChanged` when anything moves. The renderer
re-reads the list on that event, so the grid is live without polling and
without a request that hangs for the length of a batch.

## Storage choices

SQLite comes from Node's built-in `node:sqlite`, not a native npm module.
That removes an entire class of problem: no per-ABI rebuild between the
test runner and Electron, nothing to unpack from the asar archive, and no
extra binary to code-sign for macOS notarization.

Two consequences worth knowing:

- `sqlite` is not in Node's `builtinModules` list, so bundlers try to
  resolve it as a package on disk and fail. `db/schema.ts` loads it via
  `process.getBuiltinModule('node:sqlite')`, which is invisible to the
  bundler, with a type-only reference keeping full type safety.
- The API is still marked experimental upstream. Every call is confined
  to `db/`, so swapping in `better-sqlite3` would touch only those two
  files.

WAL journaling lets the UI read while enrichment writes; the busy timeout
turns a brief lock into a short wait instead of a failed product.

## Provider abstraction

`ai/provider.ts` defines the interface; `gemini.ts` and `ollama.ts`
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

## Testing strategy

Unit tests run against fake eBay and AI backends, so they need no network
and no credentials. They cover the logic that decides what gets
published: pricing, quality rules, confidence gating, the state machine,
and bulk behaviour under concurrency.

`scripts/smoke.cjs` covers what unit tests structurally cannot: it boots
the *built* Electron app and asserts the preload bridge is exposed and
the UI rendered. This was added after a real bug — the preload was
emitted as `index.mjs` while the main process referenced `index.js`,
producing an app that started and then did nothing. No unit test can see
that; the smoke test sees it immediately.

## Where to extend

- **Sold prices**: `ebay/browse.ts` returns `PriceStats`. Marketplace
  Insights (separate eBay approval) can populate the same structure from
  actual sold data; nothing downstream changes.
- **Bulk publishing**: the Inventory API has `bulk_create_offer` and
  `bulk_publish_offer` (25 items per call). `pipeline.publish` is
  per-product for clear per-item error reporting; batching is the next
  optimization if publishing throughput becomes the bottleneck.
- **Camera scanning**: the scan field accepts any text, so a USB scanner
  works today with no code. Webcam decoding would be a renderer component
  writing into the same field.
- **Multi-marketplace**: `ebayMarketplace` and `contentLanguage` are
  already threaded through the client. Listing on another eBay site is a
  settings change plus prompts in that language.
