# APPROVAL AUTHORITY MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Approval Authority

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Approval Authority is the value-threshold + role matrix that decides **who can approve** a Purchase Order, Payment, VTI or GRN, and to whom it **escalates** when the amount exceeds a role's ceiling. It is a **P2P master** served by the generic engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** PO approval routing, Payment release approvals, VTI/GRN sign-off, escalation chains.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed globals |
| Client Admin / User | Own client + globals; branch-switcher narrowing |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own-created rows |

Permissioned module: `master.approval_authority` (`can_view/add/edit/delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| role_name | Approver Role | text | Yes | e.g. Purchase Manager |
| module_scope | Module Scope | select | Yes | Purchase Order / Payment / VTI / GRN / All |
| min_value | Min Value (₹) | number | No | lower bound |
| max_value | Max Value (₹) | number | Yes | approval ceiling |
| currency | Currency | select | No | INR / USD / EUR / GBP |
| escalate_to | Escalate To (Role) | text | No | role when ceiling exceeded |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Composite uniqueness (`uFields = role_name + module_scope`)** — the **combination** must be unique per tenant. `role_name` is compared case-insensitively (text); `module_scope` matches exactly (select). So "Purchase Manager / Purchase Order" and "Purchase Manager / Payment" can both exist, but not two identical pairs.
- `module_scope`, `currency`, `status` are constrained to their enum options server-side.
- Text fields cap at 50 chars; empty optional fields store NULL.
- Delete is a **hard delete** (no soft-delete column).

---

## 5. SCREEN

Generic `MasterPage.tsx` list/add/edit/delete. Columns: Approver Role, Module Scope, Min Value, Max Value, Escalate To, Status. Search ILIKE across text/select fields.

---

## 6. KNOWN LIMITATIONS

- Value bands (`min_value`/`max_value`) are not validated for overlap or continuity — two rows can leave gaps or overlaps in a role's ceiling.
- `escalate_to` is free text, not a FK to a role/user, so typos don't fail.
- No auto-code; `next-code` returns `{code:null}`.

---
*Related documents: APPROVAL_AUTHORITY_TECHNICAL_DOCUMENTATION.md, APPROVAL_AUTHORITY_API_DOCUMENTATION.md, APPROVAL_AUTHORITY_CODE_WALKTHROUGH.md*
