# Documentation tooling

Regenerates the screenshots and the product PDF. The screenshots are
captured from the **real built application**, driven over the Chrome
DevTools Protocol — they are not mockups.

## Regenerating everything

```bash
npm run build

DEMO_DIR=$(mktemp -d)

# 1. Let the app create its own schema (no duplicated SQL in the seed script).
electron . --user-data-dir="$DEMO_DIR" &   # quit it once the window appears

# 2. Seed demo products covering every queue state.
electron scripts/demo/seed.cjs --user-data-dir="$DEMO_DIR"

# 3. Launch with remote debugging and capture.
EPAY_EBAY_CLIENT_ID=demo EPAY_EBAY_CLIENT_SECRET=demo EPAY_EBAY_RU_NAME=demo \
EPAY_AI_PROVIDER=none \
  electron . --user-data-dir="$DEMO_DIR" --remote-debugging-port=9222 &
node scripts/demo/capture.mjs 9222 docs/images

# 4. Build the PDF (needs: pip install reportlab pillow).
python3 scripts/demo/build_pdf.py
```

On a headless machine, prefix the Electron commands with `xvfb-run -a` and
add `--no-sandbox`.

## Notes

- The demo data is fictional and lives only in the throwaway
  `--user-data-dir`. No real eBay account is touched and nothing is
  published.
- Product photos are neutral placeholder tiles; no product photography is
  fabricated.
- `safeStorage` needs an OS keyring. Where none exists (CI, containers)
  the app correctly shows its "not signed in" banner, and the screenshots
  will include it.
