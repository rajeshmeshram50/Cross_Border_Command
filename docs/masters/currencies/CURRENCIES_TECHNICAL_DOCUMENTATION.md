# CURRENCIES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Currencies

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `currencies` |
| Model | `App\Models\Masters\Currencies` |
| Table | `master_currencies` |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, name, code, symbol, exchange_rate, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'currencies' => ['fields' => [
    ['n' => 'name', 't' => 'text', 'r' => true],
    ['n' => 'code', 't' => 'text', 'r' => true],
    ['n' => 'symbol', 't' => 'text', 'r' => true],
    ['n' => 'exchange_rate', 't' => 'number'],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uEach' => ['name', 'code']],
```

Derived rules: `name/code/symbol` → required|string|max:50; `exchange_rate` → nullable|numeric; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach => ['name', 'code']` — each field independently unique. Both are text, so each runs the case-insensitive `LOWER(col)=LOWER(?)` check, tenant-scoped by `(client_id, branch_id)`. The same name/code can recur across branches of one client.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/currencies` | List (`?search=`, `?branch_id=`) |
| POST | `/master/currencies` | Create |
| GET | `/master/currencies/next-code` | `{ "code": null }` |
| GET | `/master/currencies/{id}` | Show |
| PUT | `/master/currencies/{id}` | Update |
| DELETE | `/master/currencies/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no auto-code, regex, sublists, uploads, in-use guard, or `in_use` flag. The only notable point is the dual `uEach` on `name` + `code`.

---

## 6. SECURITY & SCOPING

- READ: `applyReadScope` (peer-isolated employees; not a `clm_` table).
- WRITE: `resolveOwnership` stamps `client_id/branch_id/created_by`; body `client_id` untrusted for non-super.
- Edit/delete: `hierarchicalDenial` (own row / tier ladder).
- Cache: `MasterBundleCache::bump()` on writes.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Form fields | 5 |
| Uniqueness columns | 2 (`name`, `code` — each case-insensitive) |
| Reference guards on delete | None |

---
*Related documents: CURRENCIES_FUNCTIONAL_DOCUMENTATION.md, CURRENCIES_API_DOCUMENTATION.md, CURRENCIES_CODE_WALKTHROUGH.md*
