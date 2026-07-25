# MASTER DATA MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters (schema-driven lookups)
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Every master action is gated by a per-master permission `master.<slug>` (`can_view`/`can_add`/`can_edit`/`can_delete`); super admins bypass.
- `{slug}` identifies the master (e.g. `countries`, `hsn_codes`, `leave_type`). Unknown slug → **404**.
- Writes stamp `client_id`/`branch_id`/`created_by` from the authenticated user. Non-super-admins **cannot** set tenant ids in the body.
- List/show responses are **bare arrays/objects** (not wrapped in `{data}`), with flattened `client_name`/`branch_name`/`creator_name`/`creator_user_type` added.
- Status codes: 200/201 · 401 · 403 (permission / system-locked / hierarchy) · 404 (unknown slug/id) · 409 (in-use, e.g. GST) · 422 (validation / uniqueness).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/master-counts` | Batch `{slug:{active,inactive,total}}` for the dashboard |
| 2 | GET | `/master/{slug}` | List (supports `search`, `country_id`, `branch_id`) |
| 3 | POST | `/master/{slug}` | Create a row |
| 4 | GET | `/master/{slug}/next-code` | Next auto code (DEPT-/EXC-) or `{code:null}` |
| 5 | GET | `/master/{slug}/{id}` | Read one |
| 6 | PUT | `/master/{slug}/{id}` | Update |
| 7 | DELETE | `/master/{slug}/{id}` | Soft delete |
| 8 | (apiResource) | `/organization-types[...]` | Super-admin platform master (own controller) |

---

## 3. COUNTS

### GET `/master-counts?branch_id=`
Returns a map for every master the caller can view (perm-denied/empty tables fall back to zeros so no dashboard card hangs).
```json
{
  "countries":  { "active": 240, "inactive": 3,  "total": 243 },
  "hsn_codes":  { "active": 18,  "inactive": 0,  "total": 18 },
  "leave_type": { "active": 6,   "inactive": 1,  "total": 7 }
}
```
`active` counts rows whose `status` (lower/trimmed) ∈ `active/1/true/yes/enabled`. Optional `branch_id` narrows the scope for roles that may switch branch.

---

## 4. LIST / READ

### GET `/master/{slug}?search=&country_id=&branch_id=`
Scoped by the creator-hierarchy (`MasterVisibility`). Returns a bare array, newest first.
- `search` — case-insensitive ILIKE across the master's **text/email/textarea/select** fields.
- `country_id` — cascade filter for masters that have a `country_id` field (states, ports…).
- `state_codes` additionally embeds `state: {id,name,country_id}`.
```json
[
  { "id": 42, "name": "India", "iso_code": "IN", "status": "Active",
    "client_id": null, "branch_id": null, "created_by": null,
    "client_name": null, "branch_name": null, "creator_name": null, "creator_user_type": null }
]
```
Legal Entities additionally embed `banks: [...]`; GST Percentages embed `in_use: true|false`.

### GET `/master/{slug}/{id}`
Single scoped row (same shape as a list item). **404** if outside the caller's scope or missing.

### GET `/master/{slug}/next-code`
```json
{ "code": "DEPT-001", "prefix": "DEPT-" }   // departments / expense_category
{ "code": null }                            // every other master
```
The number is computed over the same rows the list shows (tenant + active branch), so it won't collide with a visible row.

---

## 5. CREATE / UPDATE

### POST `/master/{slug}`  ·  PUT `/master/{slug}/{id}`
Body = the master's schema fields (see the catalogue in MASTER_FUNCTIONAL_DOCUMENTATION.md §4). Example — Country:
```json
{ "name": "India", "iso_code": "in", "status": "Active" }
```
- **Normalization** — fields marked `normalize:'upper'` (iso_code, gstin, pan, cin, ifsc, leave short_code) are upper-cased before validation + save.
- **Validation** — required, type (email/date/numeric), enum (`opts`), regex (`pattern` + `patternMessage`), numeric `min`/`max`, text `maxLen` (default 50).
- **Uniqueness** — tenant-scoped, case-insensitive on text:
  - `uEach` → each listed field independently unique (e.g. countries: `name` and `iso_code` each).
  - `uFields` → the *combination* unique (e.g. states: `name`+`country_id`).
  - **System-seed collision** → names matching a global `is_system` row are rejected.
- **Ownership** — `created_by` + `client_id`/`branch_id` stamped server-side.
- **Uploads** — multipart `*_file` keys (e.g. `invoice_file`) stored under `master/{slug}` and written to `*_file_path`.
- **Sublists** — `legal_entities` accepts a `banks: [...]` array (≥1 required; each validated for name/branch/account(9-18)/IFSC).

**201** (create) / **200** (update) → the created/updated row with ownership fields.

**Restrictions:**
- `POST /master/address_types` → **403** (fixed vocabulary).
- Update/delete of an `is_system` row → **403**.
- Update/delete of a higher-tier row than the caller → **403** (hierarchy).

### Validation error (422)
```json
{ "message": "The given data was invalid.",
  "errors": { "iso_code": ["This ISO code is already registered. Please use a different value."] } }
```
Composite example: `{"errors":{"name":["A record with this combination of name + country_id already exists."]}}`.

---

## 6. DELETE

### DELETE `/master/{slug}/{id}`
Soft-deletes the scoped row. → `{ "message": "Deleted" }`.

**Blocked cases:**
| Case | Code | Message |
|---|---|---|
| No `can_delete` | 403 | permission denied |
| Higher-tier row | 403 | "…created by a Client Admin / another Branch." |
| `is_system` (asset_categories/address_types/customer_types/risk_levels/customer_classifications) | 403 | "…system-managed and cannot be deleted." |
| GST rate in use | 409 | "This GST rate is in use by N product(s) and M HSN code(s)…" |

---

## 7. QUICK REFERENCE
```
GET  /master-counts                 # dashboard pills (all masters at once)
GET  /master/countries?search=ind   # list + search
GET  /master/departments/next-code  # → DEPT-007
POST /master/currencies             # create (uEach name+code, case-insensitive)
PUT  /master/hsn_codes/12           # update (regex + gst ref)
DEL  /master/gst_percentage/3       # 409 if referenced by products/HSN
```

---

## 8. NOTES (caveats)
1. Responses are bare (no `{data}` wrapper); ownership fields are flattened onto each row.
2. Uniqueness is case-insensitive on text and scoped to the row's own (client_id, branch_id).
3. `organization_types` is served by its own `/organization-types` controller (super-admin only) but appears in `/master-counts`.
4. Only `departments` & `expense_category` return a real `next-code`; every other slug returns `{code:null}`.
5. Any write bumps the form-bundle cache — downstream dropdowns pick up the change immediately.
6. `search` matches text-type fields only; numeric/date columns aren't searched.

---

*Related documents: MASTER_TECHNICAL_DOCUMENTATION.md · MASTER_FUNCTIONAL_DOCUMENTATION.md · MASTER_CODE_WALKTHROUGH.md*
