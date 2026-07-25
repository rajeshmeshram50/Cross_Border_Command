# RISK LEVELS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Risk Levels

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Risk Levels** master (slug `risk_levels`) defines the risk-severity tags used for vendor and shipment screening — e.g. *Low*, *Medium*, *High*, *Critical* — each with a description of the criteria and the action required when a party is scored at that level. It is a **Legal & Compliance** master served by the shared engine (`MasterController` + `MasterPage.tsx`).

**Consumers:** KYC and compliance flows reference risk levels when scoring customers, vendors and consignees; the `action_required` text drives the "what to do next" guidance (e.g. *Escalate*). Because those links must stay stable, the two globally-seeded levels are protected (see §4).

---

## 2. ROLES & ACCESS

| Capability | Permission flag (module `master.risk_levels`) |
|---|---|
| View | `can_view` |
| Add | `can_add` |
| Edit | `can_edit` |
| Delete (soft) | `can_delete` |

`super_admin` bypasses all checks. Non-super users see globals + their own tier's rows per the creator-hierarchy.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | Risk Level | text | Yes | Max 50; stored as free text server-side |
| `description` | Description | text | No | Risk criteria (max 50) |
| `action_required` | Action Required | text | No | e.g. "Escalate" (max 50) |
| `status` | Status | select | Yes | Active / Inactive |

The React form offers `name` as a dropdown (Low / Medium / High / Critical), but the backend column is plain text.

---

## 4. BUSINESS RULES

- **Uniqueness:** `name` is unique (case-insensitive) within the tenant scope. "high"/"High" collide.
- **System-seed lock (the key rule):** *Low* and *High* ship as global `is_system` rows (`client_id`/`branch_id` NULL). They are:
  - **Not editable** — any update returns 403 (generic `is_system` guard).
  - **Not deletable** — delete returns 403 (`risk_levels` guard: "This risk level is system-managed and cannot be deleted").
  - **Not re-creatable** — trying to add a new "Low"/"High" (any casing) under any tenant is blocked with a 422 system-seed collision error.
- Custom levels (e.g. *Medium*, *Critical*) you create yourself behave as normal, editable/deletable rows.
- Uniqueness is per (client_id, branch_id) tuple; the same custom name may recur across sibling branches (but never collide with a global seed).

---

## 5. SCREEN

Generic `MasterPage.tsx`. Columns: Risk Level · Description · Action · Status. A KPI strip shows Total / Active / Inactive / **System Fixed** (count of `is_system` rows). Seeded rows show their Edit/Delete blocked.

---

## 6. KNOWN LIMITATIONS

- Only *Low* and *High* are seeded as system rows; *Medium*/*Critical* offered in the UI dropdown are not seeded and must be created as normal rows.
- `name` is stored as free text, so a level named outside the UI dropdown list is accepted via direct API.
- There is no numeric risk score or ordering — levels are labels, not ranked values.

---
*Related documents: RISK_LEVELS_TECHNICAL_DOCUMENTATION.md, RISK_LEVELS_API_DOCUMENTATION.md, RISK_LEVELS_CODE_WALKTHROUGH.md*
