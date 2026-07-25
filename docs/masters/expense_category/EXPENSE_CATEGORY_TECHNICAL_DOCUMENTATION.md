# EXPENSE CATEGORIES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Expense Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. Model & Table

- **Model:** `App\Models\Masters\ExpenseCategories`
- **Table:** `master_expense_categories` (PostgreSQL, SoftDeletes)
- **Slug:** `expense_category`
- **Fillable:** `client_id`, `branch_id`, `code`, `name`, `monthly_limit`, `yearly_limit`, `description`, `status`, `created_by`.
- **Casts:** `monthly_limit` → decimal:2, `yearly_limit` → decimal:2.
- **Relations:** `client`, `branch`, `creator` (`created_by`).
- No file columns; no model-side auto-code hook (auto-code is served by the controller `AUTO_CODES` registry).

## 2. Schema Spec (`SCHEMAS['expense_category']`)

| n | t | r | opts |
|---|---|---|---|
| code | text | yes | |
| name | text | yes | |
| monthly_limit | number | no | |
| yearly_limit | number | no | |
| description | textarea | no | |
| status | select | yes | Active / Inactive |

`uEach` = `['code', 'name']`; `tenantScoped` = true (schema declaration).

## 3. Uniqueness Model

- `uEach` → `code` and `name` each validated independently, case-insensitive (`LOWER`) for text.
- Scoped to the resolved `(client_id, branch_id)` tuple, keeping each tenant's `EXC-` series and names isolated.

## 4. Endpoints

| Verb | Path | Action |
|---|---|---|
| GET | `/master/expense_category?search=&branch_id=` | list |
| GET | `/master/expense_category/{id}` | show |
| POST | `/master/expense_category` | create |
| PUT | `/master/expense_category/{id}` | update |
| DELETE | `/master/expense_category/{id}` | soft delete |
| GET | `/master/expense_category/next-code` | `{code:"EXC-##", prefix:"EXC-"}` |

## 5. Special Handling — auto-code (`AUTO_CODES`)

```php
'expense_category' => ['col' => 'code', 'prefix' => 'EXC-', 'pad' => 2],
```

- `nextCode()` scans `code` over the **same read scope the list uses** (`applyReadScope` + active `branch_id`), finds the max `EXC-(\d+)`, and returns `EXC-<max+1 padded to 2>`.
- Scoping over the *visible* rows (not a strict tuple) prevents handing back a code that collides with a row the user can already see.
- The code is a **client preview only** — the field is still submitted and re-validated for uniqueness on save; a race can 422 the second writer.
- No uploads, references-out, or sublists.

## 6. Security & Scoping

- `auth:sanctum` + `user.active` + `authorizeMaster('master.expense_category', …)`; super admin bypasses.
- Reads via `MasterVisibility::applyReadScope`; writes stamp ownership from the token (`resolveOwnership`); edit/delete pass `hierarchicalDenial`.
- No `is_system` rows seeded, so no edit/delete lock in practice.

## 7. Metrics

- Bare JSON, ownership names flattened, `orderByDesc('id')`.
- Every write bumps `MasterBundleCache` so HR expense/advance dropdowns refresh.

---

*Related documents: EXPENSE_CATEGORY_FUNCTIONAL_DOCUMENTATION.md, EXPENSE_CATEGORY_API_DOCUMENTATION.md, EXPENSE_CATEGORY_CODE_WALKTHROUGH.md*
