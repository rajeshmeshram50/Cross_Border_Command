# PORTS OF DISCHARGE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Ports of Discharge

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\PortOfDischarge` |
| Table | `master_port_of_discharge` |
| Slug | `port_of_discharge` |
| Fillable | `client_id, branch_id, name, code, country_id, city, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | Yes |

---

## 2. SCHEMA SPEC (`SCHEMAS['port_of_discharge']`)

```php
'fields' => [
  ['n' => 'name',       't' => 'text',   'r' => true],
  ['n' => 'code',       't' => 'text',   'r' => true],
  ['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'],
  ['n' => 'city',       't' => 'text'],
  ['n' => 'status',     't' => 'select', 'r' => true, 'opts' => ['Active','Inactive']],
],
'uEach' => ['name', 'code'],
```

Derived rules: `name`/`code` → required|string|max:50; `country_id` → required|integer (FK); `city` → nullable|string|max:50; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach` — `name` and `code` each independently unique, both text → `LOWER()` case-insensitive, tenant-scoped by `(client_id, branch_id)`. `country_id` is a required FK but is **not** part of the uniqueness key (uniqueness is name/code-only, not per-country).

---

## 4. ENDPOINTS (generic, tenant-scoped)

| Verb | Path | Purpose |
|---|---|---|
| GET | `/api/master-counts` | Dashboard aggregate |
| GET | `/api/master/port_of_discharge` | List (`?search=`, `?country_id=`, `?branch_id=`) |
| GET | `/api/master/port_of_discharge/next-code` | `{code:null}` |
| GET | `/api/master/port_of_discharge/{id}` | Single row |
| POST | `/api/master/port_of_discharge` | Create |
| PUT | `/api/master/port_of_discharge/{id}` | Update |
| DELETE | `/api/master/port_of_discharge/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

- **`country_id` cascade filter** — the list endpoint detects the `country_id` field in the schema and applies `where('country_id', ?country_id)`, so forms can load only a destination country's discharge ports.
- References `countries` via `country_id`. Otherwise a standard schema-driven master (no normalization, no system-seed lock, no sublists/uploads).

---

## 6. SECURITY & SCOPING

- Reads: `MasterVisibility::applyReadScope`.
- Writes: `resolveOwnership` stamps ownership; body `client_id` ignored for non-super.
- Edit/delete: `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Fields | 5 (name, code, country_id, city, status) |
| Required fields | 4 (name, code, country_id, status) |
| Unique columns | 2 independent (`uEach` name, code) |
| References out | 1 (`countries`) |
| Referenced by | shipment / packing document generation |

---

*Related documents: PORT_OF_DISCHARGE_FUNCTIONAL_DOCUMENTATION.md, PORT_OF_DISCHARGE_API_DOCUMENTATION.md, PORT_OF_DISCHARGE_CODE_WALKTHROUGH.md*
