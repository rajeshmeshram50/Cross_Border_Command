# STATES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → States

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\States` |
| Table | `master_states` (very large — 10k+ rows) |
| Slug | `states` |
| Fillable | `client_id, branch_id, country_id, name, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | Yes |

---

## 2. SCHEMA SPEC (`SCHEMAS['states']`)

```php
'fields' => [
  ['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'],
  ['n' => 'name',       't' => 'text',   'r' => true],
  ['n' => 'status',     't' => 'select', 'r' => true, 'opts' => ['Active','Inactive']],
],
'uFields' => ['name', 'country_id'],
```

Derived rules: `country_id` → required|integer (FK, accepts string or int); `name` → required|string|max:50; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

Composite `uFields` (2 columns) → the engine matches the **combination**. Text columns (`name`) use `LOWER()`; reference/number columns (`country_id`) use exact equality. Tenant-scoped by `(client_id, branch_id)`. Duplicate → 422 on the first uField (`name`).

---

## 4. ENDPOINTS (generic, tenant-scoped)

| Verb | Path | Purpose |
|---|---|---|
| GET | `/api/master-counts` | Dashboard aggregate (SQL COUNT, not row pull) |
| GET | `/api/master/states` | List (`?search=`, `?country_id=`, `?branch_id=`) |
| GET | `/api/master/states/next-code` | `{code:null}` |
| GET | `/api/master/states/{id}` | Single row |
| POST | `/api/master/states` | Create |
| PUT | `/api/master/states/{id}` | Update |
| DELETE | `/api/master/states/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

- **`country_id` cascade filter** — the list endpoint checks the schema for a `country_id` field and, if present, applies `where('country_id', ?country_id)`. States has the column, so the filter works (used to load ~30 states per country instead of the whole table).
- **Large-table awareness** — `counts()` uses a single `selectRaw` aggregate specifically to avoid loading `master_states` into PHP (bug #16/#21).
- References `countries` via `country_id`. Otherwise a standard schema-driven master.

---

## 6. SECURITY & SCOPING

- Reads: `MasterVisibility::applyReadScope` (creator-hierarchy).
- Writes: `resolveOwnership` stamps ownership; body `client_id` ignored for non-super.
- Edit/delete: `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Fields | 3 |
| Required fields | 3 (all) |
| Unique key | composite `name + country_id` |
| References out | 1 (`countries`) |
| Referenced by | state_codes, legal_entities, address forms |
| Table size | 10k+ rows |

---

*Related documents: STATES_FUNCTIONAL_DOCUMENTATION.md, STATES_API_DOCUMENTATION.md, STATES_CODE_WALKTHROUGH.md*
