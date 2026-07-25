# ASSETS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Assets

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. Overview

The **Assets** master is the register of company-owned equipment (laptops, machinery, furniture, vehicles) used for operations and depreciation tracking. Each asset carries an auto-generated **Asset ID** (`AST-####`), links to an **Asset Category** (for depreciation / useful-life rules) and optionally a **Supplier**, and stores its **purchase invoice** and **warranty card** as uploaded documents.

**Consumers**
- **HR / Employee Onboarding** — Stage 1 pulls assignable asset lists (Laptop, Mobile, etc.) grouped by category name for hand-out to new joiners.
- **Depreciation & fixed-asset reporting** — reads category depreciation rate + useful life.
- Any screen that renders an equipment picker.

It is one of three masters in the **Operations & Support** category, alongside Asset Categories and Expense Categories, and runs entirely on the schema-driven Masters engine (MasterController + MasterPage).

---

## 2. Roles & Access

| Role | View | Add | Edit | Delete |
|---|---|---|---|---|
| Super admin | All tenants | Yes (bypass) | Yes | Yes |
| Client admin / user | Global rows + own client | Yes | Own-tier rows | Own-tier rows |
| Branch user / employee | Global + client-level + own branch/own rows | Yes | Own rows / lower tier | Own rows / lower tier |

Access is gated by the `master.assets` module permission (`can_view` / `can_add` / `can_edit` / `can_delete`). Edits and deletes additionally pass the hierarchical rule — you may always change your own rows; otherwise the row's owner tier must not outrank you.

---

## 3. Fields

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `asset_name` | Asset Name | text | Yes | e.g. "HP Laptop 15s" |
| `code` | Asset ID | text | No | Auto `AST-####` if blank (see §4) |
| `asset_type_id` | Asset Category | select | Yes | Ref → `asset_categories` |
| `description` | Asset Description | textarea | No | Model / specs / condition |
| `vendor_id` | Supplier | select | No | Ref → `vendor_directory` |
| `purchase_date` | Purchase Date | date | No | |
| `warranty_expiry_date` | Warranty Expiry Date | date | No | Must be after purchase date & in the future (UI) |
| `invoice_file` → `invoice_file_path` | Invoice | file | Mandatory (UI) | PDF/JPG/PNG, ≤10 MB |
| `warranty_card_file` → `warranty_card_file_path` | Warranty Card | file | No | PDF/JPG/PNG, ≤10 MB |
| `status` | Status | select | Yes | Active / Inactive / Under Repair / Disposed |

`asset_number` and `assign_date` also exist as storable columns but are not surfaced on the standard master form.

---

## 4. Business Rules

1. **Auto Asset ID** — if `code` is left blank, the model generates the next `AST-0001`, `AST-0002`… on create (highest existing suffix + 1). The form pre-fills a preview from the current list.
2. **Uniqueness (per tenant, case-insensitive)** — **both** `asset_name` and `code` must each be independently unique within the tenant scope. A duplicate of either returns 422.
3. **File uploads** — Invoice and Warranty Card are stored on the public disk under `master/assets/…`; the disk path is saved to `invoice_file_path` / `warranty_card_file_path`. Replacing a file on edit deletes the previous file. Invoice is enforced mandatory by the form only.
4. **Warranty date guard (UI)** — Warranty Expiry must be later than Purchase Date and in the future.
5. **References** — the chosen Asset Category and Supplier must be visible to the same tenant scope.
6. **Soft delete** — removing an asset is a soft delete (`deleted_at`).

---

## 5. Screen

Masters dashboard → **Operations & Support → Assets**. Standard master list with search, KPI tiles (Total, Active, Under Repair, Disposed, With Warranty, Categories Used), an Add/Edit modal with a "Documents & Attachments" section for the two uploads, and row-level Edit / Delete actions honouring the permission + hierarchy rules.

---

## 6. Known Limitations

- Invoice "mandatory" is a front-end rule only; a direct API create can omit it.
- No asset-assignment lifecycle here (assignment to employees lives in HR onboarding); `assign_date`/`asset_number` are storable but not managed on this screen.
- Deleting an Asset Category still referenced by assets is not blocked at the asset side (see Asset Categories doc for the system-seed guard).

---

*Related documents: ASSETS_TECHNICAL_DOCUMENTATION.md, ASSETS_API_DOCUMENTATION.md, ASSETS_CODE_WALKTHROUGH.md*
