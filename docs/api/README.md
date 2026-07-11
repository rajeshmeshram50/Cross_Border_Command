# Cross-Border Command — API Collection

Postman/Insomnia collection for the CBC Laravel API, generated from the app's
actual routes (`php artisan route:list`). **605 requests** across **21 module
folders**, each request carrying a realistic sample payload (164 are the exact
hand-written example bodies from `payload-overrides.json`).

## Files
| File | What it is |
|---|---|
| `CrossBorderCommand.postman_collection.json` | The collection (import this) |
| `CrossBorderCommand.local.postman_environment.json` | A ready `Local` environment |

## Import & setup (Postman)
1. **Import** both files (drag them in, or *Import → Files*).
2. Select the **`CBC · Local`** environment (top-right).
3. Set the environment variables:
   - `base_url` → e.g. `http://127.0.0.1:8000`
   - `token` → filled automatically after login (see below)
   - `branch_id` → optional; the active branch id for branch-scoped GETs

## Getting a token
Run **`01 · Auth & Session → Auth → Create Login (public)`** with the sample body
(swap in real credentials). Its **test script auto-saves the returned token**
into the `{{token}}` variable — every other request then inherits
**Bearer `{{token}}`** from the collection automatically. No copy-paste needed.

## Conventions
- **Folders** — `NN · Module → Resource → Request`, e.g.
  `03 · Customers → Customer → Create Customer`.
- **Request names** — `List / Create / Get / Update / Delete <Resource>` for
  CRUD; other actions read as `Do Something · <Resource>`. Public routes are
  suffixed `(public)`. Each request's *description* carries the underlying
  `Controller@method` and the `METHOD /api/path`.
- **Auth** — Bearer `{{token}}` is set at the collection level and inherited by
  all requests. Public routes (login, OTP, signed PDF links, onboarding,
  Razorpay webhook) override to *No Auth*.
- **Bodies** — the 164 endpoints in `payload-overrides.json` carry the exact
  hand-written example payloads; every other write endpoint gets a realistic
  auto-derived sample. Overrides are matched by `METHOD /api/path`, so they stay
  attached regardless of folder/naming.
- **Path params** — Laravel `{id}` becomes Postman `:id`, exposed under each
  request's *Path Variables* (pre-filled with `1` — change to a real id).
- **Branch scope** — the SPA's Axios client injects `?branch_id={{branch_id}}`
  on GETs. Add that query param on any request you want branch-narrowed.
- **Bodies** — write endpoints (POST/PUT/PATCH) ship with an **example body
  derived from the controller's `$request->validate([...])` rules**:
  - **JSON** for normal endpoints — nested objects and arrays are reconstructed
    (`primary_address.city` → `{ "primary_address": { "city": ... } }`,
    `locations.*.type` → `{ "locations": [ { "type": ... } ] }`).
  - **form-data** for endpoints that accept file uploads (dotted keys become
    `field[0][sub]` / `field[]`; file fields are `type: file`).
  - **Realistic sample values** are inferred from the field name + rule —
    e.g. `company_name` → *Shree Agro Exports Pvt Ltd*, `cp_name` → *Rahul
    Sharma*, `city` → *Pune*, `state` → *Maharashtra*, `gst_number` →
    *27AADCI6120M1ZH*, `email` → an address, `*_id` → `1`, `amount` → `10000`,
    `date` → `2026-01-01`, `in:Active,Inactive` → `Active`. **Adjust to your
    real tenant data before sending** (IDs must exist, GSTIN must be unique).
  - A few endpoints show an empty `{}` — those validate via a FormRequest
    class (not an inline array) or take no body.

## Regenerating
Generated from the live routes + controller validation, so it never drifts.
All three inputs live in `docs/api/`; run from the repo root:
```bash
php artisan route:list --json --path=api > docs/api/routes.json
php docs/api/extract-payloads.php app/Http/Controllers/Api > docs/api/payloads.json
node docs/api/gen-collection.cjs docs/api      # writes the collection + environment
```
Re-run after changing routes or validation rules.
