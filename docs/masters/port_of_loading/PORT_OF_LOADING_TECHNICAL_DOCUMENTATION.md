# PORTS OF LOADING MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Ports of Loading

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\PortOfLoading` |
| Table | `master_port_of_loading` |
| Slug | `port_of_loading` |
| Fillable | `client_id, branch_id, name, code, address, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | Yes |

---

## 2. SCHEMA SPEC (`SCHEMAS['port_of_loading']`)

```php
'fields' => [
  ['n' => 'name',    't' => 'text',     'r' => true],
  ['n' => 'code',    't' => 'text',     'r' => true],
  ['n' => 'address', 't' => 'textarea'],
  ['n' => 'status',  't' => 'select',   'r' => true, 'opts' => ['Active','Inactive']],
],
'uEach' => ['name', 'code'],
```

Derived rules: `name`/`code` → required|string|max:50; `address` → nullable|string (uncapped); `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach` — `name` and `code` each independently unique. Both are text, so both use `LOWER()` case-insensitive checks, tenant-scoped by `(client_id, branch_id)`. No composite constraint.

---

## 4. ENDPOINTS (generic, tenant-scoped)

| Verb | Path | Purpose |
|---|---|---|
| GET | `/api/master-counts` | Dashboard aggregate |
| GET | `/api/master/port_of_loading` | List (`?search=`, `?branch_id=`) |
| GET | `/api/master/port_of_loading/next-code` | `{code:null}` |
| GET | `/api/master/port_of_loading/{id}` | Single row |
| POST | `/api/master/port_of_loading` | Create |
| PUT | `/api/master/port_of_loading/{id}` | Update |
| DELETE | `/api/master/port_of_loading/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master. No refs, no `country_id` cascade, no normalization, no system-seed lock, no sublists/uploads. The only non-trivial rule is the dual independent uniqueness (`uEach` on name and code).

---

## 6. SECURITY & SCOPING

- Reads: `MasterVisibility::applyReadScope`.
- Writes: `resolveOwnership` stamps ownership; body `client_id` ignored for non-super.
- Edit/delete: `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Fields | 4 (name, code, address, status) |
| Required fields | 3 (name, code, status) |
| Unique columns | 2 independent (`uEach`) |
| References out | 0 |
| Referenced by | shipment / export document generation |

---

*Related documents: PORT_OF_LOADING_FUNCTIONAL_DOCUMENTATION.md, PORT_OF_LOADING_API_DOCUMENTATION.md, PORT_OF_LOADING_CODE_WALKTHROUGH.md*
