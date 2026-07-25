# HAZARD CLASSIFICATIONS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Hazard Classifications

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Hazard Classifications** master (slug `haz_class`) is the GHS/UN hazard-class catalogue for products that require special handling — e.g. *Flammable Liquid*, *Toxic Substance*, *Non-Hazardous*. It is a **Legal & Compliance** master served by the shared engine (`MasterController` + `MasterPage.tsx`).

**Consumers:** product master and compliance/trade-document flows tag goods with a hazard class so downstream shipping, warehousing (cold-chain/hazardous zones) and export documentation know the handling requirements.

---

## 2. ROLES & ACCESS

| Capability | Permission flag (module `master.haz_class`) |
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
| `name` | Hazard Class | text | Yes | Max 50; e.g. "Flammable Liquid" |
| `status` | Status | select | Yes | Active / Inactive |

This is a minimal two-field master.

---

## 4. BUSINESS RULES

- **Uniqueness (`uFields = [name]`):** `name` is unique, case-insensitive, within the tenant scope. "Toxic Substance"/"toxic substance" collide.
- No system-seeded rows ship, so there is no edit/delete lock beyond the hierarchy gate.
- Uniqueness is per (client_id, branch_id) tuple; the same class may recur across sibling branches.
- Every write refreshes the master-bundle dropdown cache.

---

## 5. SCREEN

Generic `MasterPage.tsx`. Columns: Hazard Class · Status. The "what to do" guide prompts: name the hazard class, set status Active so it becomes available for product tagging.

---

## 6. KNOWN LIMITATIONS

- Purely a label list — no GHS/UN pictogram, class number, or handling-rule fields are stored; those live (if at all) on the consuming product/compliance screens.

---
*Related documents: HAZ_CLASS_TECHNICAL_DOCUMENTATION.md, HAZ_CLASS_API_DOCUMENTATION.md, HAZ_CLASS_CODE_WALKTHROUGH.md*
