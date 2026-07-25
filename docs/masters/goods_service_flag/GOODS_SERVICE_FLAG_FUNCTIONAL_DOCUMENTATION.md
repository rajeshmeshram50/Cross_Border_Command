# GOODS VS SERVICE FLAG MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Goods vs Service Flag

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The Goods vs Service Flag decides **how a Purchase Order is received**. It is the switch that toggles the GRN (Goods Receipt Note) screen between **physical-receipt capture** (quantity + batch + warehouse) and **service-completion proof** (completion date + supporting document). The `evidence_type` field declares what attachment proves completion. It is one of the **P2P (Procure-to-Pay) masters** and is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** GRN screen logic (which capture form renders); and, alongside **Procurement Category**, the match / receipt workflow.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.goods_service_flag` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| flag_code | Flag Code | text | Yes | e.g. GOODS, SERVICE, MIXED |
| flag_name | Flag Name | text | Yes | e.g. Physical Goods |
| grn_screen | GRN Screen | select | Yes | see options below |
| evidence_type | Evidence Type | text | Yes | attachment that proves completion |
| status | Status | select | Yes | Active / Inactive |

**`grn_screen` options:** `Physical Receipt — Qty + Batch + Warehouse`, `Service Completion — Date + Proof Doc`, `Mixed — Partial Goods + Service`.

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `flag_code` **and** `flag_name` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope. Adding "goods" when "GOODS" exists is blocked.
- Same code/name may recur across different branches of one client (scope-limited).
- `grn_screen` must be one of the three enum options; `status` must be Active / Inactive (enforced server-side).
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Flag Code, Flag Name, GRN Screen, Evidence Type, Status. Search runs an ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- No auto-code generation — `flag_code` is typed manually (`next-code` returns `{code:null}`).
- No FK enforcement between `grn_screen` and downstream GRN logic beyond the enum.
- The flag only selects the capture form; it does not itself validate that the captured evidence matches `evidence_type`.

---
*Related documents: GOODS_SERVICE_FLAG_TECHNICAL_DOCUMENTATION.md, GOODS_SERVICE_FLAG_API_DOCUMENTATION.md, GOODS_SERVICE_FLAG_CODE_WALKTHROUGH.md*
