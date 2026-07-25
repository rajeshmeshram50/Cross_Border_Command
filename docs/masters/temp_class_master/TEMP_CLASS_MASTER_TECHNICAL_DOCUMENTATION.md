# TEMPERATURE CLASS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Temperature Class Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `temp_class_master` |
| Model | `App\Models\Masters\TempClassMaster` |
| Table | `master_temp_class_master` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — hard delete |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Notes |
|---|---|---|---|
| `class_code` | text | ✅ | — |
| `class_name` | text | ✅ | — |
| `temp_range_min` | number | — | negatives allowed |
| `temp_range_max` | number | — | negatives allowed |
| `description` | textarea | — | uncapped |
| `requires_monitoring` | select | — | No · Yes |
| `alert_threshold` | number | — | — |
| `suitable_products` | text | — | — |
| `status` | select | ✅ | Active · Inactive |

No reference fields — referenced **by** the Rack master (`racks.tempClass → temp_class_master`).

## 3. UNIQUENESS MODEL

`uEach: ['class_code', 'class_name']` — each independently unique, tenant-scoped, case-insensitive (both text → `LOWER()`).

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/temp_class_master` | `can_view` |
| GET | `/api/master/temp_class_master/{id}` | `can_view` |
| POST | `/api/master/temp_class_master` | `can_add` |
| PUT | `/api/master/temp_class_master/{id}` | `can_edit` |
| DELETE | `/api/master/temp_class_master/{id}` | `can_delete` |
| GET | `/api/master/temp_class_master/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING

Standard schema-driven master. Numeric fields validate as `numeric` (no min/max bounds configured, so negatives like −25 °C are accepted). No cascade parent — it is a source catalogue for the Rack master.

## 6. SECURITY & SCOPING

`applyReadScope` (tenant tier + switcher) · `resolveOwnership` (stamps client/branch; body untrusted) · `hierarchicalDenial` (own row / tier ladder).

## 7. METRICS

`/master-counts` aggregates `status` into Active vs Inactive.

---

*Related documents: TEMP_CLASS_MASTER_FUNCTIONAL_DOCUMENTATION.md · TEMP_CLASS_MASTER_API_DOCUMENTATION.md · TEMP_CLASS_MASTER_CODE_WALKTHROUGH.md*
