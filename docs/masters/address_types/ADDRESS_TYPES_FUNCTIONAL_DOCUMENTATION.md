# ADDRESS TYPES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Address Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Address Types** master is a **closed, system-fixed vocabulary** used to classify any address on a customer, vendor, consignee or entity record (e.g. Registered Office vs Warehouse vs Billing Address). Unlike other masters, tenants **cannot add, rename or delete** the seeded entries — the set is fixed platform-wide. It is served by the schema-driven engine (`MasterController` + `MasterPage.tsx`) but with hard locks at both the API and model layers.

**Downstream consumers:** address sub-forms across Customers, Vendors, Consignees and Legal Entities tag each address with one of these types.

**Canonical seeded types** (from the model's `FIXED_NAMES`): **Warehouse**, **Registered Office**, **Billing Address**. (The controller's create-block message additionally names "Branch"; the authoritative fixed set is the model constant.)

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | May view; create is still blocked at the API (403) |
| Client Admin / Client User | View only (Add button hidden; POST returns 403) |
| Branch User | View only |
| Employee | View only |

Permissioned module: `master.address_types`. The frontend config sets `lockedFixed: true`, hiding the Add button.

---

## 3. FIELDS

| Field | Label · Type · Required | Options / Ref | Rules & Notes |
|---|---|---|---|
| `name` | Address Type · text · **required** | — | Max 50; case-insensitive unique. Name of seeded rows cannot be edited. |
| `status` | Status · select · **required** | Active / Inactive | Enforced via `Rule::in`. |
| `is_system` | (system flag) · boolean | — | Read-only marker; `true` on seeded rows → locks edit/delete. |

Plus engine-managed `client_id`, `branch_id`, `created_by`.

---

## 4. BUSINESS RULES

- **LOCKED-FIXED (create blocked)** — `POST /master/address_types` returns **403** unconditionally ("Address Types is a fixed master…"). No tenant can extend the vocabulary, even via direct API/Postman.
- **Model-level guards** — `AddressTypes::booted()` throws on any Eloquent `creating` (blocks seeders/Tinker too), blocks `name` edits, and blocks deletion of any `FIXED_NAMES` row.
- **Edit blocked on system rows** — `update()` returns **403** when `is_system = true` ("system-managed and cannot be edited").
- **Delete blocked on system rows** — `destroy()` returns **403** for `is_system` rows ("system-managed and cannot be deleted"); the model's `deleting` guard also blocks the canonical names.
- **Uniqueness (`uEach` = `name`)** — case-insensitive; combined with the **system-seed collision check**, a branch user cannot shadow-create "Registered Office" inside their own scope.
- **Normalization** — none.

---

## 5. SCREEN

Path: `/masters/address_types`. Standard master shell, but the **Add button is hidden** (`lockedFixed`). KPIs include a "System Fixed" count. Edit/Delete on seeded rows fail with a 403 toast. List columns: Address Type · Status.

---

## 6. KNOWN LIMITATIONS

- There is a naming discrepancy between the model's `FIXED_NAMES` (Warehouse / Registered Office / Billing Address), the controller's create-block message (mentions "Branch"), and the frontend prototype seed data (which lists five sample rows). The **model constant is authoritative** for what is truly locked.
- Because creation is fully blocked, this master cannot be extended — any new address category needs a code/migration change, not a UI action.

---

*Related documents: ADDRESS_TYPES_TECHNICAL_DOCUMENTATION.md, ADDRESS_TYPES_API_DOCUMENTATION.md, ADDRESS_TYPES_CODE_WALKTHROUGH.md*
