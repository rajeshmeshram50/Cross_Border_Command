# LICENSE TYPES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → License Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **License Types** master (slug `license_name`) is the governed catalogue of import/export and regulatory license categories a product or market may require — e.g. *Drug Wholesale License (DWL)*, *FSSAI License*, *IEC Code*. It is one of the **Legal & Compliance** masters and is served by the shared schema-driven engine (`MasterController` + `MasterPage.tsx`).

**Consumers:** CLM Trade Licenses (`ClmTradeLicenseController`) and KYC/compliance flows reference these types when recording which licenses a customer, vendor or consignee must hold; the issuing authority and validity window help compliance staff track expiry.

---

## 2. ROLES & ACCESS

| Capability | Permission flag (module `master.license_name`) |
|---|---|
| View list / open record | `can_view` |
| Add a license type | `can_add` |
| Edit a license type | `can_edit` |
| Delete (soft) | `can_delete` |

`super_admin` bypasses all checks. Visibility follows the creator-hierarchy: client admins see their client's rows plus globals; branch users see own-branch + client-level + globals; employees see only their own rows plus reference data.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | License Name | text | Yes | Max 50 chars; e.g. "Drug Wholesale License" |
| `license_code` | License Code | text | No | Max 50 chars; e.g. DWL, FSSAI, IEC |
| `issuing_authority` | Issuing Authority | text | No | e.g. CDSCO, FSSAI, DGFT |
| `validity_months` | Validity (months) | number | No | 0 = lifetime |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`):** `name` **and** `license_code` are each independently unique, case-insensitive, within the tenant scope. "IEC"/"iec" collide; the same name cannot be reused even under a different code.
- `license_code` is nullable — an empty code skips the uniqueness check and is stored as NULL.
- Uniqueness is per (client_id, branch_id) tuple, so the same license type may legitimately recur across sibling branches.
- No system-seeded rows ship for this master, so there is no delete/edit lock beyond the generic hierarchy gate.
- Every write refreshes the master-bundle dropdown cache so new types appear immediately in CLM/KYC forms.

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx`. Columns: License Name · Code · Authority · Validity · Status. Search box filters across the text/select fields (ILIKE). Add/Edit uses a modal form; Delete is a soft delete with confirm.

---

## 6. KNOWN LIMITATIONS

- The React config (`masterConfigs.ts`) declares only `license_code` as unique; the **backend** additionally enforces `name` uniqueness (`uEach`). A duplicate name is blocked server-side even though the UI may not pre-warn.
- `validity_months` has no upper bound and no expiry-alert engine — it is a stored reference figure only.

---
*Related documents: LICENSE_NAME_TECHNICAL_DOCUMENTATION.md, LICENSE_NAME_API_DOCUMENTATION.md, LICENSE_NAME_CODE_WALKTHROUGH.md*
