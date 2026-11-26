# Master "Cannot Delete If In Use" — System Audit Sheet

**Goal:** For every master used in dropdowns, block deletion when any of its values is referenced anywhere in the system (show a clear "in use, cannot delete" message instead of deleting).

**Scope found:** 59 masters, all served by one generic endpoint
`DELETE /api/master/{slug}/{id}` → `MasterController@destroy`
([app/Http/Controllers/Api/MasterController.php](../app/Http/Controllers/Api/MasterController.php)).

---

## The core finding

A master's values are referenced in other tables. We can detect that reference **automatically** only when the link is declared, and there are two declared sources:

| Source | What it is | Masters covered |
|---|---|---|
| **DB foreign key** | a real FK constraint in Postgres pointing at the master table | **11** |
| **Config `ref`** | a dropdown field in `MasterController::SCHEMAS` whose `'ref' => 'slug'` points at another master | **13** (→ 21 masters total after dedup) |

**The remaining ~38 masters have NEITHER** — their values are stored in other tables as plain integer/text columns **without a DB foreign key**, so there is no automatic way to know where they are used. Those need an explicit, hand-built usage map (one or more `table.column` per master), verified by reading the code.

So a true "block delete if used **anywhere**" needs **two layers**:
1. **Automatic layer** (safe, no guessing) — covers the 21 declared masters and self-extends as FKs/refs are added.
2. **Manual usage-map layer** — one entry per remaining master, built by grepping the codebase for its id column.

---

## A. Masters that ALREADY block delete when in use (keep as-is)

| Master | Current rule |
|---|---|
| `gst_percentage` | blocked if used by any `products.gst_id` |
| `assets` | blocked if assigned to any employee (laptop/mobile/other) |
| `expense_category` | blocked if used by expense claims / claim payments |
| `service_categories` | never deletable — must be set Inactive |
| `asset_categories`, `address_types`, `customer_types`, `risk_levels`, `customer_classifications` | system-managed rows (`is_system`) can't be deleted |

Everything below currently deletes with **no in-use check.**

---

## B. Auto-detectable masters (FK or config `ref`) — guard can be generic

| Master | DB foreign keys pointing in | Config-ref fields pointing in |
|---|---|---|
| `countries` | `vendor_addresses.country_id` | `states.country_id`, `port_of_discharge.country_id` |
| `states` | `vendor_addresses.state_id` | `state_codes.state_id`, `vendor_directory.state` |
| `segments` | `clm_segment_rules.segment_id`, `vendor_segments.segment_id`, `vendors.segment_id` | `vendor_directory.segment_id` |
| `customer_classifications` | `vendors.classification_id` | — |
| `vendor_types` | `vendors.vendor_type_id` | — |
| `vendor_behaviour` | `vendors.vendor_behaviour_id` | — |
| `license_name` | `vendor_documents.license_type_id` | — |
| `risk_levels` | `vendors.risk_level_id` | — |
| `compliance_behaviours` | `vendors.compliance_behaviour_id` | — |
| `leave_type` | `leave_requests.leave_type_id` | — |
| `leave_plan` | `leave_requests.leave_plan_id` | — |
| `departments` | — | `departments.parent_id`, `roles.department_id`, `designations.department_id` |
| `roles` | — | `kpis.role_id` |
| `designations` | — | `designations.reports_to_id` |
| `asset_categories` | — | `assets.asset_type_id` |
| `vendor_directory` | — | `assets.vendor_id` |
| `warehouse_master` | — | `zone_master.warehouse`, `racks.warehouse`, `freezers.warehouse` |
| `zone_master` | — | `racks.zone` |
| `rack_type_master` | — | `racks.rackType` |
| `temp_class_master` | — | `racks.tempClass` |
| `racks` | — | `shelf_master.rack_ref` |

---

## C. Masters with NO FK and NO config ref — need an explicit usage map

These are used across transactional modules (sales / purchase / CLM / inventory / payroll) via plain columns. Their real usage must be mapped by hand (grep each id column) before a guard can be correct:

```
organization_types, company, bank_accounts, kpis, state_codes, address_types,
port_of_loading, port_of_discharge, hsn_codes, gst_percentage*, currencies, uom,
packaging_material, conditions, incoterms, customer_types, supplier_category,
applicable_types, document_type, haz_class, assets*, expense_category*,
payment_terms, approval_authority, procurement_category, sourcing_type,
deviation_reason, match_exception, advance_payment_rules, exchange_rate_log,
goods_service_flag, shelf_master, digital_twin, freezers, overtime_rates,
pt_slabs, trigger_point
```
`*` = already has a specific guard (section A); the rest have **none**.

---

## Recommended implementation (2 layers)

**Layer 1 — generic guard (safe, automatic):** before `$row->delete()`, check
(a) every incoming DB FK (from `information_schema`, cached) and
(b) every config `ref` reverse-reference,
for a row pointing at this id. If found → `409` "This <master> is in use by N record(s) in <place> and cannot be deleted." No false positives; self-extends.

**Layer 2 — explicit usage map:** a `slug => [[table, column], …]` map for the section-C masters, filled in batches after grepping each id column in the codebase, then checked the same way.

---

## Implemented (done)

A generic guard now runs on `DELETE /api/master/{slug}/{id}` for **all 59 masters**, before delete:
`MasterController::masterUsage()` checks three sources and returns `409` if any referencing row exists —
**declared DB foreign keys** + **config `ref` fields** + an explicit **`USAGE_MAP`**.

A code audit of the 38 section-C masters found that **most are not referenced by id at all** — they are
stored by name / code / enum string (e.g. `currency_code`, `supplier_category`, port names) or are not yet
consumed by any table. Only these needed an explicit map (`USAGE_MAP`):

| Master | Referenced by |
|---|---|
| `bank_accounts` | `quotations.bank_account_id`, `proforma_invoices.bank_account_id` |
| `hsn_codes` | `products.hsn_id`, `p2p_services.hsn_id` |
| `gst_percentage` | `products.gst_id`, `p2p_services.gst_id`, `p2p_service_suppliers.gst_id` |
| `uom` | `products.uom_id`, `p2p_services.uom_id` |
| `packaging_material` | `products.packaging_material_id`, `p2p_services.packaging_id` |
| `conditions` | `products.condition_id`, `p2p_services.condition_id` |
| `incoterms` | `shipment_orders.inco_term_id` |
| `haz_class` | `products.haz_class_id`, `p2p_services.haz_class_id` |
| `trigger_point` | `hr_document_templates.trigger_point_id` |

`assets` and `expense_category` keep their existing specific guards (assets' `other_master_asset_ids` is a
JSON array, handled there). Verified against real data: all 59 masters run without error, referenced rows are
blocked, free rows delete — and no master row was deleted during verification (read-only checks only).

*Audit sheet + implementation note. The guard lives in [MasterController.php](../app/Http/Controllers/Api/MasterController.php).*
