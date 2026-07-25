# COMPLIANCE BEHAVIOURS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Compliance Behaviours

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Compliance Behaviours** master (slug `compliance_behaviours`) is the catalogue of compliance-status behaviours and their follow-up actions — e.g. *Compliant* (no action), *Non-Compliant* (issue correction notice), *Under Review* (await audit), *Exempt* (maintain records). It captures rules for regulated, cold-chain and controlled-substance handling. It is a **Legal & Compliance** master served by the shared engine (`MasterController` + `MasterPage.tsx`).

**Consumers:** CLM and KYC/compliance flows tag a party or product with a behaviour and surface the `action_required` text as the next-step guidance for compliance staff.

---

## 2. ROLES & ACCESS

| Capability | Permission flag (module `master.compliance_behaviours`) |
|---|---|
| View | `can_view` |
| Add | `can_add` |
| Edit | `can_edit` |
| Delete (soft) | `can_delete` |

`super_admin` bypasses. Others see globals + their tier's rows per the creator-hierarchy.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | Behaviour Name | text | Yes | Max 50; e.g. "Compliant", "Under Review" |
| `action_required` | Action Required | text | No | Next steps; e.g. "Issue correction notice" |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uFields = [name]`):** `name` is unique, case-insensitive, within the tenant scope. "Compliant"/"compliant" collide.
- `action_required` is optional; an empty value stores as NULL.
- No system-seeded rows ship, so there is no edit/delete lock beyond the hierarchy gate.
- Uniqueness is per (client_id, branch_id) tuple; the same behaviour may recur across sibling branches.
- Every write refreshes the master-bundle dropdown cache.

---

## 5. SCREEN

Generic `MasterPage.tsx`. Columns: Behaviour Name · Action Required · Status. Search filters across the text/select fields. Add/Edit via modal; Delete is soft with confirm.

---

## 6. KNOWN LIMITATIONS

- `action_required` is stored free-text guidance only — it does not trigger any automated workflow.
- No severity/ordering — behaviours are labels with an advisory action, not a state machine.

---
*Related documents: COMPLIANCE_BEHAVIOURS_TECHNICAL_DOCUMENTATION.md, COMPLIANCE_BEHAVIOURS_API_DOCUMENTATION.md, COMPLIANCE_BEHAVIOURS_CODE_WALKTHROUGH.md*
