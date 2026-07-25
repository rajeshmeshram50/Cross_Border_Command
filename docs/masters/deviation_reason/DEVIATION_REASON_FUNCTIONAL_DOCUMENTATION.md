# OVERRIDE / DEVIATION REASON MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Override / Deviation Reason

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Override / Deviation Reason defines the locked picklist behind **every manual override / deviation action** across the P2P flow. When a user departs from the expected path — overriding a Purchase Order value, deviating on a Vendor Comparison, forcing a VTI, adjusting a GRN, or releasing a Payment — they must select one of these reasons. Each reason carries flags that can **force an attachment upload** and/or **route the action for approval**. It is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** Purchase Order, Vendor Comparison, VTI, GRN and Payment — every manual override/deviation action reads this picklist and honours its per-reason `attachment_required` / `requires_approval` flags.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.deviation_reason` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| reason_code | Reason Code | text | Yes | e.g. PO-PRICE, GRN-QTY |
| reason_name | Reason Name | text | Yes | e.g. Price variance approved |
| module | Module | select | Yes | Purchase Order / Vendor Comparison / VTI / GRN / Payment / All |
| attachment_required | Attachment Required | select | Yes | Yes / No |
| requires_approval | Requires Approval | select | Yes | Yes / No |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `reason_code` **and** `reason_name` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope. Adding "price variance" when "Price Variance" exists is blocked.
- Same code/name may recur across different branches of one client (scope-limited).
- `module`, `attachment_required`, `requires_approval` and `status` must each match their enum options (enforced server-side).
- When a selected reason has `attachment_required = Yes`, the consuming override action must collect a file; `requires_approval = Yes` routes the action to approval.
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Reason Code, Reason Name, Module, Attachment Required, Requires Approval, Status. Search runs an ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- Frontend `masterConfigs.ts` labels the module option **"Supplier Comparison"**, but the **backend `module` enum is "Vendor Comparison"** (backend is authoritative — a body sending "Supplier Comparison" is rejected as an invalid enum).
- Frontend declares only `reason_code` unique, but the **backend enforces both** `reason_code` and `reason_name`.
- No auto-code generation — `reason_code` is typed manually (`next-code` returns `{code:null}`).
- No `is_system` column — no rows are lock-protected from deletion beyond the hierarchy gate.

---
*Related documents: DEVIATION_REASON_TECHNICAL_DOCUMENTATION.md, DEVIATION_REASON_API_DOCUMENTATION.md, DEVIATION_REASON_CODE_WALKTHROUGH.md*
