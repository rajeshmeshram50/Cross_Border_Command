# PAYMENT TERMS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Payment Terms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Payment Terms defines the credit / advance structure a Purchase Order can be raised against — how many days of credit, what advance percentage is required before dispatch, and the milestone breakup for staged payments. It is one of the **P2P (Procure-to-Pay) masters** and is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** Purchase Order creation (term picker), Vendor / Supplier terms, Payment scheduling and advance-release checks, VTI (invoice) matching.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.payment_terms` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| term_code | Term Code | text | Yes | e.g. NET30, ADV100 |
| term_name | Term Name | text | Yes | e.g. Net 30 Days |
| credit_days | Credit Days | number | Yes | days before payment due |
| advance_pct | Advance Required (%) | number | No | advance before dispatch |
| payment_type | Payment Type | select | Yes | Full Advance / Partial Advance / Credit / Milestone-Based / COD |
| milestone_desc | Milestone Description | text | No | e.g. 50% dispatch, 50% delivery |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `term_code` **and** `term_name` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope. Adding "net 30" when "Net 30" exists is blocked.
- Same code/name may recur across different branches of one client (scope-limited).
- `payment_type` must be one of the five enum options (enforced server-side).
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Code, Term Name, Credit Days, Advance %, Payment Type, Status. Search runs an ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- Frontend `masterConfigs.ts` declares only `term_code` unique, but the **backend enforces both** `term_code` and `term_name` (backend is authoritative).
- No auto-code generation — `term_code` is typed manually (`next-code` returns `{code:null}`).
- No FK enforcement between `payment_type` and downstream PO logic beyond the enum.

---
*Related documents: PAYMENT_TERMS_TECHNICAL_DOCUMENTATION.md, PAYMENT_TERMS_API_DOCUMENTATION.md, PAYMENT_TERMS_CODE_WALKTHROUGH.md*
