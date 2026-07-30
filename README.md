# ePay Tool

Desktop application that turns a barcode scan into a ready-to-publish
eBay.de listing, so a seller can prepare and post 100+ products a day
instead of researching each one by hand.

The user scans a barcode, the app looks the product up, researches the
market price, fills in the listing form, and shows it for review. One
click publishes it. When the product cannot be identified automatically,
an AI assistant identifies what it can from photos and **asks for the
missing details** instead of guessing.

## How it works

```
barcode scan ─┬─► eBay Catalog API ──► exact product data (title, brand, aspects, images)
              │        (miss)
              └─► AI vision fallback ──► identification + confidence + open questions
                                │
                                ▼
                       eBay Taxonomy API ──► category + required item specifics
                                │
                                ▼
                       eBay Browse API ────► market prices ──► suggested price
                                │
                                ▼
                       completeness check ──► READY  or  NEEDS_INFO
                                │
                                ▼ (one click)
                       eBay Inventory API ──► published listing
```

The important design decision: **eBay's own APIs do the identification
wherever possible.** For a product with a barcode in eBay's catalog, no
AI is involved at all — the result is instant, free and exact. AI is the
fallback for unlisted, used or unboxed goods, plus a quality assistant on
top.

### The AI asks instead of guessing

Every AI answer carries a per-field confidence score. Fields below the
confidence threshold never reach the listing; they become questions in
the review panel:

> Bitte die Rückseite fotografieren, um das Modell zu bestimmen.
> (Modellnummer steht auf der Rückseite oder unter Einstellungen →
> Allgemein → Info.)

This is what handles the hard cases — a front photo of a phone cannot
reveal which model it is, and a shoe photo without the tongue label
cannot reveal the size. The app says so rather than inventing an answer.

## Product queue

Every scanned item lives in a local SQLite queue with an explicit state,
so a large batch survives restarts and can be worked through at any pace:

| State | Meaning |
| --- | --- |
| `SCANNED` | captured, not yet processed |
| `ENRICHING` | lookup, pricing and AI running in the background |
| `NEEDS_INFO` | open questions or missing required fields |
| `READY` | complete draft — one click from publishing |
| `POSTED` | live on eBay |
| `FAILED` | last operation failed, can be retried |

Enrichment runs on a bounded thread pool, so scanning never blocks and a
single failing product never stops the batch.

## Setup

Requires Python 3.11+.

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"     # Windows: .venv\Scripts\pip
cp .env.example .env                  # then fill in the values
.venv/bin/epay-tool
```

### eBay credentials

1. Create an application at <https://developer.ebay.com> and copy the
   App ID (client id), Cert ID (client secret) and RuName.
2. Set the application's **accept URL** to
   `http://localhost:8123/callback` so the desktop login flow can capture
   the authorization code.
3. Start with `EPAY_EBAY_ENV=sandbox`; switch to `production` once the
   flow is verified.

The first launch opens a browser for the one-time eBay consent. The
resulting refresh token is stored in the OS keychain (Windows Credential
Manager / macOS Keychain), never in a file.

Before publishing, open **Einstellungen** once and select the shipping,
payment and return policies to use — eBay requires all three on every
offer.

### AI provider

| Provider | Setting | Notes |
| --- | --- | --- |
| Google Gemini | `EPAY_AI_PROVIDER=gemini` | Recommended. Free tier is enough for development; production is a few euros a month at 100+ products/day. |
| Ollama (local) | `EPAY_AI_PROVIDER=ollama` | Free and offline, needs a strong PC, weaker at fine-grained identification. |
| None | `EPAY_AI_PROVIDER=none` | Barcode-only mode; catalog matches still work. |

The provider sits behind a single interface (`ai/provider.py`), so
switching or adding a model is a config change rather than a refactor.

## Development

```bash
QT_QPA_PLATFORM=offscreen .venv/bin/pytest -q   # tests run headless
.venv/bin/ruff check src tests
```

Tests use fake eBay and AI backends, so the suite never touches the
network and needs no credentials.

## Building the desktop app

Run on the target platform — PyInstaller does not cross-compile.

```bash
pip install pyinstaller
python packaging/build.py
```

- Windows → `dist/ePayTool/ePayTool.exe`
- macOS → `dist/ePayTool.app`

## Layout

```
src/epay_tool/
  ai/         provider interface, Gemini + Ollama backends, prompts, schemas
  core/       pipeline, pricing, quality rules, background worker
  db/         SQLite models and session handling
  ebay/       OAuth, HTTP client, Catalog/Taxonomy/Browse/Inventory/Media
  ui/         main window, detail panel, settings dialog
```

## Known limits

- **Catalog coverage varies by category.** Excellent for electronics and
  media, weaker for clothing and no-name goods. Test with real inventory
  early.
- **Price research uses asking prices**, not sold prices. Actual sold
  data needs eBay's Marketplace Insights API, which requires separate
  approval; `ebay/browse.py` is the place to plug it in.
- **Used goods need real photos.** Catalog stock images are used only
  when the seller supplies none, and the app warns when a non-new item
  has no photos of its own.
