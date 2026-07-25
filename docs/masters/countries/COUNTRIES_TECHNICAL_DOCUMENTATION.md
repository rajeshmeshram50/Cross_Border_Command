# COUNTRIES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Countries

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\Countries` |
| Table | `master_countries` |
| Slug | `countries` |
| Fillable | `client_id, branch_id, name, iso_code, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` (all `BelongsTo`) |
| Helper | `Countries::isoFor(?string)` — name/iso → uppercase ISO, memoized per process |
| Soft deletes | Yes (engine convention) |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS['countries']`)

```php
'fields' => [
  ['n' => 'name',     't' => 'text',   'r' => true],
  ['n' => 'iso_code', 't' => 'text',   'normalize' => 'upper'],
  ['n' => 'status',   't' => 'select', 'r' => true, 'opts' => ['Active','Inactive']],
],
'uEach' => ['name', 'iso_code'],
```

Validation derived by the engine: `name` → required|string|max:50; `iso_code` → nullable|string|max:50 (uppercased first); `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach` — **each** listed column is independently unique. Text columns use a manual `whereRaw('LOWER(col)=LOWER(?)')` check scoped to the `(client_id, branch_id)` tuple. Both `name` and `iso_code` are text, so both are case-insensitive. There is no composite constraint.

---

## 4. ENDPOINTS (generic, tenant-scoped)

| Verb | Path | Purpose |
|---|---|---|
| GET | `/api/master-counts` | Batch Active/Inactive/total for dashboard cards |
| GET | `/api/master/countries` | List (`?search=`, `?branch_id=`) |
| GET | `/api/master/countries/next-code` | Returns `{code:null}` (no auto-code) |
| GET | `/api/master/countries/{id}` | Single row |
| POST | `/api/master/countries` | Create |
| PUT | `/api/master/countries/{id}` | Update |
| DELETE | `/api/master/countries/{id}` | Soft delete |

All behind `auth:sanctum` + `user.active`; each checks `master.countries` permission (super_admin bypass).

---

## 5. SPECIAL HANDLING

- **Cascade source** — `country_id` is consumed by `states` and `port_of_discharge`; the list endpoint's `?country_id=` filter applies only to masters that *have* a `country_id` column, which Countries itself does not.
- **Normalization** — `iso_code` uppercased pre-validate so the stored value and uniqueness check are canonical.
- Otherwise a standard schema-driven master (no refs, no system-seed lock, no sublists/uploads).

---

## 6. SECURITY & SCOPING

- Reads scoped by `MasterVisibility::applyReadScope` (creator-hierarchy tiers).
- Writes stamp `client_id / branch_id / created_by` via `resolveOwnership`; body `client_id` ignored for non-super users.
- Edit/delete gated by `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Fields | 3 (name, iso_code, status) |
| Required fields | 2 (name, status) |
| Unique columns | 2 independent (`uEach`) |
| References out | 0 |
| Referenced by | states, port_of_discharge, legal_entities, vendor_directory (+ address forms) |

---

*Related documents: COUNTRIES_FUNCTIONAL_DOCUMENTATION.md, COUNTRIES_API_DOCUMENTATION.md, COUNTRIES_CODE_WALKTHROUGH.md*
