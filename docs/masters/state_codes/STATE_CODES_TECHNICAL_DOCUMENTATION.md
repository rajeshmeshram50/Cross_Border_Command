# STATE CODES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → State Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\StateCodes` |
| Table | `master_state_codes` |
| Slug | `state_codes` |
| Fillable | `client_id, branch_id, state_id, state_code, status, created_by` |
| Relations | `client()`, `branch()`, `creator()`, `state()` → `States` (on `state_id`) |
| Soft deletes | Yes |

---

## 2. SCHEMA SPEC (`SCHEMAS['state_codes']`)

```php
'fields' => [
  ['n' => 'state_id',   't' => 'select', 'r' => true, 'ref' => 'states'],
  ['n' => 'state_code', 't' => 'text',   'r' => true],
  ['n' => 'status',     't' => 'select', 'r' => true, 'opts' => ['Active','Inactive']],
],
'uFields' => ['state_id', 'state_code'],
```

Derived rules: `state_id` → required|integer; `state_code` → required|string|max:50; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

Composite `uFields` (2 columns). `state_id` (FK) → exact match; `state_code` (text) → `LOWER()` case-insensitive. Tenant-scoped by `(client_id, branch_id)`. Duplicate ⇒ 422 on `state_id`.

---

## 4. ENDPOINTS (generic, tenant-scoped)

| Verb | Path | Purpose |
|---|---|---|
| GET | `/api/master-counts` | Dashboard aggregate |
| GET | `/api/master/state_codes` | List (eager-loads `state:id,name,country_id`) |
| GET | `/api/master/state_codes/next-code` | `{code:null}` |
| GET | `/api/master/state_codes/{id}` | Single row |
| POST | `/api/master/state_codes` | Create |
| PUT | `/api/master/state_codes/{id}` | Update |
| DELETE | `/api/master/state_codes/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

- **State eager-load** — `list()` has a `$slug === 'state_codes'` branch that adds `->with('state:id,name,country_id')`, returning the state name inline and carrying `country_id` for frontend cascade. Avoids downloading `master_states` (10k+ rows) just to translate an id.
- **No direct `country_id` cascade** — the table has no `country_id` column, so the generic `?country_id=` filter is a no-op for this master; cascading is done client-side via the eager-loaded `state.country_id`.
- References `states` via `state_id`.

---

## 6. SECURITY & SCOPING

- Reads: `MasterVisibility::applyReadScope`.
- Writes: `resolveOwnership` stamps ownership; body `client_id` ignored for non-super.
- Edit/delete: `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Fields | 3 |
| Required fields | 3 (all) |
| Unique key | composite `state_id + state_code` |
| References out | 1 (`states`, eager-loaded) |
| Referenced by | GST invoice / tax-filing screens |

---

*Related documents: STATE_CODES_FUNCTIONAL_DOCUMENTATION.md, STATE_CODES_API_DOCUMENTATION.md, STATE_CODES_CODE_WALKTHROUGH.md*
