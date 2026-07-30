# Connecting the app to eBay

Follow this once for the sandbox, then repeat steps 7–9 for production.
At every stage, `npm run doctor` (or **Verbindung prüfen** in the app)
tells you exactly what is still missing.

## What you need to understand first

eBay access has **two halves that cannot be merged**:

| Half | Who owns it | What it is |
| --- | --- | --- |
| The **application** | You, the developer | App ID, Cert ID, RuName — created in a free eBay developer account |
| The **seller account** | Your customer | Grants your app access by signing in once via OAuth |

Your customer cannot give you the first half, and you never need his
password. "The customer has permission to use the eBay API" means he can
grant *your* app access to *his* account — which is exactly what the
sign-in button does. **You still need your own developer account.**

## Does it cost anything?

No. The developer programme is free and there is no per-call fee.

| Item | Cost |
| --- | --- |
| eBay developer account | free |
| API calls | free, no per-call charge |
| Higher rate limits (Application Growth Check) | free, on request |
| AI provider | ~€1–5/month at 100+ products/day |
| eBay selling fees | unchanged — this app does not affect them |

Default limits are roughly 5,000 calls/day for the Buy APIs and higher for
the Sell APIs. This app uses about 8 calls per product, so 100 products a
day is roughly 800 calls — comfortably inside the free allowance.

## Which APIs need extra permission

This is the part that catches people out. Not everything is granted with a
standard developer account:

| API | Used for | Granted automatically? |
| --- | --- | --- |
| Taxonomy | Categories, required item specifics | Yes |
| Inventory / Account (Sell) | Creating and publishing listings | Yes |
| **Catalog** | Barcode → product data | Needs the `commerce.catalog.readonly` scope enabled for your app |
| **Browse** | Automatic price research | Needs approval via the eBay Partner Network — a business-model review that takes days and **can be declined** |
| Marketplace Insights | Real *sold* prices | Restricted; not used by this app |

The app works without the last three. If Catalog is missing, barcodes
cannot be resolved automatically and items go through the photo/AI path.
If Browse is missing, prices are left empty and the **Marktpreise prüfen**
button opens a pre-filled eBay search of completed sales instead — real
prices, one click, no approval needed.

## Step by step

### 1. Create a developer account

Register at <https://developer.ebay.com> (free). Under **Application
Keys** you get two separate key sets: **Sandbox** and **Production**.
Never mix them — a sandbox key against the production host fails with a
confusing error.

### 2. Create the RuName (redirect)

In the developer console, open **User Tokens → Get a Token from eBay via
Your Application**, then add a redirect URL. eBay calls this a *RuName*.

Set the **accept URL** to:

```
http://localhost:8123/callback
```

That is where the app's temporary local server catches the login
response. The RuName string itself (not the URL) goes into `.env`.

### 3. Fill in `.env`

```bash
cp .env.example .env
```

```ini
EPAY_EBAY_ENV=sandbox
EPAY_EBAY_CLIENT_ID=<App ID>
EPAY_EBAY_CLIENT_SECRET=<Cert ID>
EPAY_EBAY_RU_NAME=<RuName>
EPAY_EBAY_MARKETPLACE=EBAY_DE
```

### 4. Check the connection

```bash
npm run build
npm run doctor
```

Checks 1–3 must pass. Checks 4 and 5 (Catalog, Browse) may show a
warning — that is expected until the extra permissions are granted, and
the app still works.

### 5. Sign the seller in

Start the app (`npm run dev`) and click **Jetzt anmelden**. The browser
opens eBay's own login page; your customer enters his credentials there.
The app only ever receives a token, which is stored encrypted in the
operating system's credential store.

### 6. Business policies

eBay requires a payment, shipping and return policy on every listing. In
the customer's eBay account: **Mein eBay → Kontoeinstellungen →
Verkaufsrichtlinien**. Create at least one of each, then pick them in the
app under **Einstellungen**.

Run `npm run doctor` again — checks 6–9 should now pass.

### 7. Prove that publishing works

In the app, open **Verbindung prüfen** and click **Testangebot anlegen und
wieder löschen**. This creates a real draft listing and deletes it
immediately. It is never published and never visible to buyers. If this
passes, the first real listing will work.

### 8. Apply for the extra permissions

- **Catalog scope**: open a support ticket in the developer console and
  ask for `commerce.catalog.readonly` for your application.
- **Browse API**: apply for Buy API production access through the eBay
  Partner Network. Be honest about the use case (a seller tool doing price
  research). Approval is not guaranteed — plan for the manual fallback.

### 9. Switch to production

Swap in the production keys, set `EPAY_EBAY_ENV=production`, and run
`npm run doctor` once more. The seller has to sign in again, because
sandbox and production tokens are separate.

## Important: what the sandbox can and cannot tell you

The sandbox has **sparse, static catalog data**. Barcode lookups there
will often return nothing, and that is normal — it is not a bug in the
app and it says nothing about how well the catalog will work in reality.

- Sandbox proves the **plumbing**: keys, login, policies, publishing.
- Only production proves **coverage**: how many of the customer's actual
  products the catalog knows.

Test coverage with about 20 of the customer's real products as soon as
production keys exist. That number decides how much work goes down the
AI path and is the single most useful early measurement.

## Common errors

| Message | Cause |
| --- | --- |
| `invalid_client` | App ID/Cert ID wrong, or sandbox keys used against production |
| `insufficient permissions` on the catalog | `commerce.catalog.readonly` not enabled for the app |
| 403 on `item_summary/search` | Buy API (Browse) not approved |
| `Invalid redirect_uri` | RuName wrong, or its accept URL is not `http://localhost:8123/callback` |
| Zeitüberschreitung on login | Port 8123 blocked or already in use |
| Offer rejected on publish | Missing business policy, no merchant location, or a required item specific for that category |
