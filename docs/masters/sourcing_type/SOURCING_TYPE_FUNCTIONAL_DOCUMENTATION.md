# SOURCING TYPE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Sourcing Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Sourcing Type classifies **how a Purchase Order is procured** — Direct, Open Market, Spot, Rate Contract, Emergency — and drives the comparative-quotation and approval controls that PO creation must satisfy. It is one of the **P2P (Procure-to-Pay) masters** and is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** Purchase Order sourcing classification, comparative-quotation count enforcement (min-quote rules), approval-required gating, and urgency overrides on the PO flow.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.sourcing_type` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| type_code | Type Code | text | Yes | e.g. DIR, SPOT, RC |
| type_name | Type Name | text | Yes | e.g. Direct, Open Market |
| quotation_required | Quotation Required | select | Yes | Mandatory — Min 3 Quotes / Mandatory — Min 1 Quote / Optional / Not Required |
| approval_required | Approval Required | select | Yes | Yes / No |
| urgency_flag | Urgency Flag | select | No | Normal / Urgent / Emergency |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `type_code` **and** `type_name` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope. Adding "spot" when "Spot" exists is blocked.
- Same code/name may recur across different branches of one client (scope-limited).
- `quotation_required`, `approval_required`, `urgency_flag`, and `status` must each be one of their enum options (enforced server-side).
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Code, Type Name, Quotation Required, Approval Required, Urgency Flag, Status. Search runs an ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- No auto-code generation — `type_code` is typed manually (`next-code` returns `{code:null}`).
- `urgency_flag` is optional; PO-flow urgency overrides depend on it being populated to take effect.
- No FK enforcement between the enum values and downstream PO logic beyond the enum guard.

---
*Related documents: SOURCING_TYPE_TECHNICAL_DOCUMENTATION.md, SOURCING_TYPE_API_DOCUMENTATION.md, SOURCING_TYPE_CODE_WALKTHROUGH.md*
