# SUPPLIER DIRECTORY MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Directory

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\VendorDirectory` |
| Table | `master_vendor_directory` |
| Slug | `vendor_directory` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['vendor_directory']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['vendor_directory']`.

| Column | Type | Rules |
|---|---|---|
| vendor_company_name | textarea | required, **max 512** (`maxLen` on schema) |
| contact_person | text | required, max 50 |
| mobile_number | text | required, max 50 |
| email_id | email | required, `email`, max 255 |
| segment_id | select (ref) | required, **integer** → `segments` master |
| address | text | required, max 50 |
| country | select | required, `Rule::in(India, USA, UAE, UK, Germany, Australia, Singapore, Other)` — plain enum |
| state | select (ref) | required, **integer** → `states` master |
| city | text | required, max 50 |
| mapping_mode | select | required, `Rule::in(Map from Vendor Master, Map New Vendor)` |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. The two references (`segment_id`, `state`) validate as integers but accept a string or int from the frontend `MasterSelect`.

---

## 3. UNIQUENESS MODEL

`uEach = [vendor_company_name, mobile_number, email_id]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/vendor_directory` | can_view |
| GET | `/api/master/vendor_directory/{id}` | can_view |
| POST | `/api/master/vendor_directory` | can_add |
| PUT | `/api/master/vendor_directory/{id}` | can_edit |
| DELETE | `/api/master/vendor_directory/{id}` | can_delete |
| GET | `/api/master/vendor_directory/next-code` | can_view → `{code:null}` |

---

## 5. SPECIAL HANDLING

This master is **not** a plain standard master — it carries two references:

- **`segment_id` → `segments` master** — validated as an integer id; the frontend `MasterSelect` may submit a string, which is accepted.
- **`state` → `states` master** — same integer-reference treatment.

The list endpoint eager-loads **only ownership** (`client/branch/creator`); it does **not** eager-load segment/state, so `segment_id`/`state` remain raw integer ids in the response and the frontend resolves their labels from its cached master bundle. The `country_id` cascade filter in `list()` does **not** apply here — this master has a `country` **enum** column, not a `country_id` FK.

---

## 6. SECURITY & SCOPING

`applyReadScope` (creator-hierarchy) governs list/read; `hierarchicalDenial` gates edit/delete (own row always OK; employees only own; else row tier ≤ user tier, else 403). Writes stamp ownership via `resolveOwnership`; a body `client_id` is honoured only for super admin. Every write calls `MasterBundleCache::bump()`. DB is PostgreSQL.

---

## 7. METRICS

`/master-counts` returns `{active, inactive, total}` computed by a single SQL aggregate (status IN active/1/true/yes/enabled). Responses are bare and `orderByDesc(id)`.

---
*Related documents: VENDOR_DIRECTORY_FUNCTIONAL_DOCUMENTATION.md, VENDOR_DIRECTORY_API_DOCUMENTATION.md, VENDOR_DIRECTORY_CODE_WALKTHROUGH.md*
