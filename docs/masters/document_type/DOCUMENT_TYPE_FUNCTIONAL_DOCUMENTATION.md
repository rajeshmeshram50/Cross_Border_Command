# DOCUMENT TYPES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Document Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Document Types** master (slug `document_type`) is the catalogue of document categories used for upload and linking across the platform — e.g. *GST Registration Certificate*, *PAN Card*, *Trade License*, *Certificate of Analysis (COA)*, *Safety Data Sheet (SDS)*. It is a **Legal & Compliance** master served by the shared engine (`MasterController` + `MasterPage.tsx`).

**Consumers:** CLM (KYC / DD / trade-document catalogues), customer & vendor onboarding, and compliance flows resolve which document a party must supply, whether it is mandatory, and who it applies to.

---

## 2. ROLES & ACCESS

| Capability | Permission flag (module `master.document_type`) |
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
| `title` | Document Type Name | text | Yes | Max 50; e.g. "GST Registration Certificate" |
| `applicable_to` | Applicable To | select | No | Customer / Vendor / Supplier / Both / Internal |
| `is_mandatory` | Is Mandatory | select | No | Yes / No |
| `status` | Status | select | Yes | Active / Inactive |

Note: the backend `applicable_to` enum includes **Vendor**, **Supplier**, **Both**, **Internal**, and **Customer**; the React dropdown currently lists only Customer / Supplier / Both / Internal.

---

## 4. BUSINESS RULES

- **Uniqueness (`uFields = [title]`):** `title` is unique, case-insensitive, within the tenant scope. "PAN Card"/"pan card" collide.
- `applicable_to` and `is_mandatory` are optional; empty values store as NULL.
- Enum values are enforced server-side — an out-of-list value is rejected with 422.
- No system-seeded rows ship, so no edit/delete lock beyond the hierarchy gate.
- Uniqueness is per (client_id, branch_id) tuple; the same title may recur across sibling branches.

---

## 5. SCREEN

Generic `MasterPage.tsx`. Columns: Document Type · Applicable To · Mandatory · Status. Search filters across the text/select fields. Add/Edit via modal; Delete is soft with confirm.

---

## 6. KNOWN LIMITATIONS

- The UI dropdown for `applicable_to` omits **Vendor**, which the backend enum accepts — a direct API call can set it.
- `is_mandatory` is a stored label only; it does not itself enforce document collection anywhere — the consuming CLM/onboarding screens decide how to use it.

---
*Related documents: DOCUMENT_TYPE_TECHNICAL_DOCUMENTATION.md, DOCUMENT_TYPE_API_DOCUMENTATION.md, DOCUMENT_TYPE_CODE_WALKTHROUGH.md*
