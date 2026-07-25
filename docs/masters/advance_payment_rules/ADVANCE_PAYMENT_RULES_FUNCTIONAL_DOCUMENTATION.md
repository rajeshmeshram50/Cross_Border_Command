# ADVANCE PAYMENT RULES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Advance Payment Rules

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Advance Payment Rules set the **maximum advance %** allowed per (supplier/vendor type × procurement category) on a Purchase Order, plus the **amount above which an extra approval is required** and the **approver role** for that approval. It is a **P2P master** served by the generic engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** the advance-payment release flow on POs — reads the cap to bound the advance %, the threshold to trigger an extra approval, and the approver role for routing.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed globals |
| Client Admin / User | Own client + globals; branch-switcher narrowing |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own-created rows |

Permissioned module: `master.advance_payment_rules` (`can_view/add/edit/delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| vendor_type | Vendor Type | text | Yes | e.g. Manufacturer |
| procurement_cat | Procurement Category | text | No | nullable |
| max_advance_pct | Max Advance % | number | Yes | capped 0..100 (server-side) |
| approval_above | Approval Above (₹) | number | No | amount that needs extra approval |
| approver_role | Approver Role | text | No | role for extra approval |
| attachment_required | Attachment Required | select | Yes | Yes / No |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Composite uniqueness (`uFields = vendor_type + procurement_cat`)** — the **combination** must be unique per tenant. Both columns are text, so **both** are compared case-insensitively. So "Manufacturer / Raw Material" and "Manufacturer / Packaging" can both exist, but not two identical pairs.
- `max_advance_pct` is a percentage **capped 0..100** server-side (`required|numeric|min:0|max:100`).
- `attachment_required` and `status` are constrained to their enum options server-side.
- Text fields cap at 50 chars; empty optional fields store NULL.
- Delete is a **hard delete** (no soft-delete column).

---

## 5. SCREEN

Generic `MasterPage.tsx` list/add/edit/delete. Columns: Vendor Type, Procurement Category, Max Advance %, Approval Above, Approver Role, Attachment Required, Status. Search ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- `approver_role` is free text, not a FK to a role/user, so typos don't fail.
- `approval_above` is not validated against `max_advance_pct` — no cross-field consistency check.
- No auto-code; `next-code` returns `{code:null}`.

---
*Related documents: ADVANCE_PAYMENT_RULES_TECHNICAL_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_API_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_CODE_WALKTHROUGH.md*
