# PROCUREMENT CATEGORY MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Procurement Category

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Procurement Category classifies what is being procured and, per category, declares the **matching rigour** a Purchase Order must satisfy (2/3/4-way), whether a **Goods Receipt Note (GRN)** is required, and how **GST** is treated. It is one of the **P2P (Procure-to-Pay) masters** and is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** Purchase Order match-logic selection (3-way PO+VTI+GRN vs 2-way PO+VTI vs 4-way PO+VTI+GRN+QC), GRN-requirement gating on receipt, and GST treatment on procurement documents.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.procurement_category` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| cat_code | Cat Code | text | Yes | e.g. RAW, SVC |
| cat_name | Cat Name | text | Yes | e.g. Raw Material |
| match_logic | Match Logic | select | Yes | 3-Way (PO+VTI+GRN) / 2-Way (PO+VTI) / 4-Way (PO+VTI+GRN+QC) |
| grn_required | GRN Required | select | Yes | Yes — Physical Receipt / Yes — Service Confirmation / No |
| gst_applicable | GST Applicable | select | Yes | Yes / No / Reverse Charge |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `cat_code` **and** `cat_name` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope. Adding "raw" when "RAW" exists is blocked.
- Same code/name may recur across different branches of one client (scope-limited).
- `match_logic`, `grn_required`, `gst_applicable`, `status` must each be one of their enum options (enforced server-side).
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Cat Code, Cat Name, Match Logic, GRN Required, GST Applicable, Status. Search runs an ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- No auto-code generation — `cat_code` is typed manually (`next-code` returns `{code:null}`).
- No FK enforcement between `match_logic` / `gst_applicable` and downstream PO logic beyond the enum.
- No `is_system` column, so no system-seeded rows are protected from edit/delete by that path.

---
*Related documents: PROCUREMENT_CATEGORY_TECHNICAL_DOCUMENTATION.md, PROCUREMENT_CATEGORY_API_DOCUMENTATION.md, PROCUREMENT_CATEGORY_CODE_WALKTHROUGH.md*
