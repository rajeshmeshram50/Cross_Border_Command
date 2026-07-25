# FREEZER MANAGEMENT — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Freezer Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `freezers` |
| Model | `App\Models\Masters\Freezers` |
| Table | `master_freezers` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — hard delete |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Ref / Cascade |
|---|---|---|---|
| `name` | text | ✅ | — |
| `warehouse` | select | ✅ | **ref → `warehouse_master`** (label `wh_name`) |
| `capacity` | number | ✅ | boxes |
| `status` | select | ✅ | Active · Inactive |

`warehouse` is a reference field → validated `integer`; the frontend renders a cascading Warehouse dropdown.

## 3. UNIQUENESS MODEL

`uFields: ['name', 'warehouse']` — **composite** (2 fields), tenant-scoped. Because it is a combination:
- `name` is a text field → compared with `LOWER()` (case-insensitive).
- `warehouse` is a reference id → compared **exactly** (no case-fold).

So `"Freezer Alpha"` may exist once per warehouse; adding it again under the same warehouse fails, but the same name under a different warehouse is allowed.

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/freezers` | `can_view` |
| GET | `/api/master/freezers/{id}` | `can_view` |
| POST | `/api/master/freezers` | `can_add` |
| PUT | `/api/master/freezers/{id}` | `can_edit` |
| DELETE | `/api/master/freezers/{id}` | `can_delete` |
| GET | `/api/master/freezers/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING — REFERENCE CASCADE + COMPOSITE KEY

Two notable behaviours: (1) `warehouse → warehouse_master` reference cascade (validated `integer` only, no existence check); (2) the **composite** `name`+`warehouse` uniqueness described in §3, which mixes a case-insensitive text component with an exact-match FK component. Freezers are the only Warehouse-category master using a composite key.

## 6. SECURITY & SCOPING

`applyReadScope` (tenant tier + switcher) · `resolveOwnership` (stamps client/branch; body untrusted) · `hierarchicalDenial` (own row / tier ladder).

## 7. METRICS

`/master-counts` aggregates `status` into Active vs Inactive. Occupancy shown on the grid is a frontend metric, not part of the counts aggregate.

---

*Related documents: FREEZERS_FUNCTIONAL_DOCUMENTATION.md · FREEZERS_API_DOCUMENTATION.md · FREEZERS_CODE_WALKTHROUGH.md*
