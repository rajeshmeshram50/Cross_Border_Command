# MATCH EXCEPTION TYPE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Match Exception Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Match Exception Type defines the catalogue of discrepancies the **3-way match engine** can raise when reconciling a Purchase Order (PO) against the Vendor Tax Invoice (VTI) and the Goods Receipt Note (GRN). Each row names an exception, the variance tolerance that triggers it, whether it blocks or merely warns on payment release, and the role responsible for resolving it. It is one of the **P2P (Procure-to-Pay) masters** and is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** the PO vs VTI vs GRN three-way match engine (defines the exception types + resolver role); `blocks_payment` controls whether a matched exception hard-blocks or soft-warns payment release; `tolerance_pct` is the allowed variance before the exception fires.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.match_exception` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| exc_code | Exc Code | text | Yes | e.g. PRICE-VAR, QTY-SHORT |
| exc_name | Exc Name | text | Yes | e.g. Price Variance |
| tolerance_pct | Tolerance (%) | number | No | allowed variance before exception fires; 0–100 |
| blocks_payment | Blocks Payment | select | Yes | Yes — Hard Block / Yes — Soft Block (Warning) / No |
| resolver_role | Resolver Role | text | Yes | role responsible for clearing the exception |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `exc_code` **and** `exc_name` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope. Adding "price variance" when "Price Variance" exists is blocked.
- Same code/name may recur across different branches of one client (scope-limited).
- `tolerance_pct` is optional, but when supplied is validated **server-side as a percentage bounded 0..100** (`nullable|numeric|min:0|max:100`). Values above 100 or below 0 return 422.
- `blocks_payment` must be one of the three enum options (enforced server-side).
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Exc Code, Exc Name, Tolerance %, Blocks Payment, Resolver Role, Status. Search runs an ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- No auto-code generation — `exc_code` is typed manually (`next-code` returns `{code:null}`).
- The 0..100 bound guards data entry only; there is no FK enforcement between an exception type and the match-engine records that consume it.
- `resolver_role` is free text, not linked to the Roles master.

---
*Related documents: MATCH_EXCEPTION_TECHNICAL_DOCUMENTATION.md, MATCH_EXCEPTION_API_DOCUMENTATION.md, MATCH_EXCEPTION_CODE_WALKTHROUGH.md*
