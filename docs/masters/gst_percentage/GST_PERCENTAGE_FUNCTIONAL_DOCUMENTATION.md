# GST PERCENTAGES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → GST Percentages

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**GST Percentages** are the tax slabs (0, 5, 12, 18, 28%, or tenant-specific custom values) applied to products and invoices. It is a small but heavily-referenced master.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_gst_percentage`.

### Downstream consumers
| Consumer | Reference column |
|---|---|
| Products | `products.gst_id` → a GST rate row |
| HSN Codes master | `master_hsn_codes.gst_rate_id` → a GST rate row |
| Quotations / Proforma Invoices | GST computed from the product's slab |

Because Products and HSN Codes both point at GST rate rows, this master enforces a **referential-integrity guard**: a rate that is in use cannot be deleted.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.gst_percentage` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `percentage` | GST % | number | Yes | Backend validates numeric; frontend caps 0–100 |
| `status` | Status | select | Yes | Active / Inactive |

The list also returns a computed **`in_use`** boolean (true when any product or HSN code references the rate) so the UI can disable the Delete button.

---

## 4. BUSINESS RULES

- **Uniqueness** — `percentage` is unique within the tenant scope. Being numeric, it uses **exact-match** uniqueness (not case-insensitive text folding), so `18` cannot be added twice.
- **In-use delete guard (409)** — deleting a rate that any product (`gst_id`) or HSN code (`gst_rate_id`) still references is blocked with HTTP **409** and a message naming the counts, e.g. *"This GST rate is in use by 3 products and 1 HSN code and cannot be deleted. Reassign those records to another GST rate first."*
- **`in_use` flag** — every row returned carries `in_use: true/false`, mirroring the guard, so the frontend disables Delete + shows a tooltip.
- **Range** — the DB column is `DECIMAL(5,2)`; values ≥ 1000 overflow at the database. The frontend caps at 100 (and `0` is a valid exempt slab). The backend master schema itself only enforces `numeric`.

---

## 5. SCREEN

`/masters/gst_percentage` — searchable list, KPI strip, Add/Edit modal with the single `percentage` field. Rows already used by products/HSN show a disabled Delete with an "in use" tooltip.

---

## 6. KNOWN LIMITATIONS

- The master-layer validation enforces only `numeric` on `percentage`; the 0–100 cap is a frontend guardrail. A direct API call with a huge value can still trigger a DB overflow (`DECIMAL(5,2)`).
- The in-use guard covers products and HSN codes; it does not scan historical invoice snapshots.

---
*Related documents: GST_PERCENTAGE_TECHNICAL_DOCUMENTATION.md, GST_PERCENTAGE_API_DOCUMENTATION.md, GST_PERCENTAGE_CODE_WALKTHROUGH.md*
