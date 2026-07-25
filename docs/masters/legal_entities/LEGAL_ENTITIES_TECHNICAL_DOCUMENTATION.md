# LEGAL ENTITIES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Legal Entities

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\LegalEntities`
- **Table:** `master_legal_entities`
- **Fillable:** `client_id, branch_id, entity_code, entity_name, legal_name, cin, date_of_incorporation, type_of_business, sector, nature_of_business, country_id, address_line1, address_line2, city, state_id, zip_code, currency_id, financial_year, logo_path, status, created_by`
- **Casts:** `date_of_incorporation => date`
- **Relations:** `client()`, `branch()`, `creator()`, `country()` (Countries), `state()` (States), `currency()` (Currencies), `banks()` → `hasMany(LegalEntityBank, 'legal_entity_id')`
- **Booted hook:** `creating` — auto-assigns `entity_code = 'LE-' + zero-pad(max(LE-####) + 1, 4)` when blank.

---

## 2. SCHEMA SPEC (from `SCHEMAS['legal_entities']`)

| Field | t | r | ref | Validation |
|---|---|---|---|---|
| entity_name | text | ✔ | — | required, string max 50, uEach |
| legal_name | text | ✔ | — | required, string max 50, uEach |
| cin | text | ✔ | — | required, string max 50, uEach |
| date_of_incorporation | date | ✔ | — | required, date |
| type_of_business | select | ✔ | — | Rule::in(12 options) |
| sector | select | ✔ | — | Rule::in(13 options) |
| nature_of_business | select | — | — | Rule::in(10 options) |
| country_id | select | ✔ | countries | required, integer |
| address_line1 | text | ✔ | — | required, string max 50 |
| address_line2 | text | — | — | nullable, string max 50 |
| city | text | ✔ | — | required, string max 50 |
| state_id | select | ✔ | states | required, integer |
| zip_code | text | ✔ | — | required, string max 50 |
| currency_id | select | — | currencies | nullable, integer |
| financial_year | select | — | — | Rule::in(3 options) |
| status | select | ✔ | — | Rule::in(Active, Inactive) |

`entity_code`, `logo_path` are not in SCHEMAS (handled by the model hook / upload absorber respectively).

---

## 3. UNIQUENESS MODEL

`uEach = [entity_name, cin, legal_name]`. Each is checked independently with `LOWER(col) = LOWER(?)` scoped to the row's `(client_id, branch_id)`; a hit throws 422 per field. No composite constraint. *(The frontend config lists only `entity_name, cin`, but the backend enforces all three.)*

---

## 4. ENDPOINTS (generic engine, scoped to `legal_entities`)

| Verb | Path | Notes |
|---|---|---|
| GET | `/api/master/legal_entities` | list; ?search=, ?country_id= (has country_id → cascade), ?branch_id= |
| POST | `/api/master/legal_entities` | store (multipart when logo present; carries `banks[]`) |
| GET | `/api/master/legal_entities/next-code` | `{code: null}` — not in AUTO_CODES |
| GET | `/api/master/legal_entities/{id}` | show (row includes inline `banks[]`) |
| PUT | `/api/master/legal_entities/{id}` | update |
| DELETE | `/api/master/legal_entities/{id}` | soft delete |

---

## 5. SPECIAL HANDLING

- **Auto-code:** model `creating` hook (not the `AUTO_CODES` registry). `next-code` therefore returns null.
- **Uploads (`absorbUploads`):** request key `logo_path` is a fillable path column, so the uploaded file is stored under `master/legal_entities` and the disk path written to `logo_path`; old file deleted on update.
- **Sublist (`syncSublists`):** `banks[]` fanned out to `LegalEntityBank`. Requires ≥1 bank; per-bank regex guards (name/branch charset, 9–18-digit account, IFSC pattern); allowed keys `bank_name, branch_name, account_number, ifsc_code, account_type, is_primary`; **true-sync** deletes rows absent from the payload.
- **Inline read (`withOwnership`):** when the row is a `LegalEntities`, `banks` is appended (ordered `is_primary desc, id`).
- **country_id cascade:** list endpoint honours `?country_id=` because the schema has a `country_id` field.

---

## 6. SECURITY & SCOPING

- `authorizeMaster('master.legal_entities', …)` per verb; super admin bypass.
- Reads via `applyReadScope`; writes stamp ownership via `resolveOwnership`.
- `hierarchicalDenial` gates edit/delete; `is_system` block present but column not used here.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 16 schema fields + `entity_code` (auto) + `logo_path` (upload) + `banks[]` sublist |
| Required fields | 11 (entity_name, legal_name, cin, date_of_incorporation, type_of_business, sector, country_id, address_line1, city, state_id, zip_code, status) |
| Uniqueness model | `uEach` (entity_name, cin, legal_name) |
| Auto-code | Yes — `LE-####` via model hook (not next-code endpoint) |
| Uploads / sublist | logo_path upload; `banks[]` sublist (≥1) |

---
*Related documents: LEGAL_ENTITIES_FUNCTIONAL_DOCUMENTATION.md, LEGAL_ENTITIES_API_DOCUMENTATION.md, LEGAL_ENTITIES_CODE_WALKTHROUGH.md*
