# DIGITAL TWIN — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Digital Twin

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `digital_twin` |
| Model | `App\Models\Masters\DigitalTwin` |
| Table | `master_digital_twin` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — hard delete |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Notes |
|---|---|---|---|
| `name` | text | ✅ | — |
| `status` | select | ✅ | Active · Inactive |

No reference fields. This is the minimal two-field master pattern (name + status).

## 3. UNIQUENESS MODEL

`uFields: ['name']` — single text field → promoted to **case-insensitive** single-field uniqueness (`LOWER()`), tenant-scoped.

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/digital_twin` | `can_view` |
| GET | `/api/master/digital_twin/{id}` | `can_view` |
| POST | `/api/master/digital_twin` | `can_add` |
| PUT | `/api/master/digital_twin/{id}` | `can_edit` |
| DELETE | `/api/master/digital_twin/{id}` | `can_delete` |
| GET | `/api/master/digital_twin/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING

Standard schema-driven master — no cascade, uploads, sublists, auto-code, or system-seed lock. The rich visual behaviour lives entirely on the frontend Digital Twin screen; the master persists only the view's name and status.

## 6. SECURITY & SCOPING

`applyReadScope` (tenant tier + switcher) · `resolveOwnership` (stamps client/branch; body untrusted) · `hierarchicalDenial` (own row / tier ladder).

## 7. METRICS

`/master-counts` aggregates `status` into Active vs Inactive.

---

*Related documents: DIGITAL_TWIN_FUNCTIONAL_DOCUMENTATION.md · DIGITAL_TWIN_API_DOCUMENTATION.md · DIGITAL_TWIN_CODE_WALKTHROUGH.md*
