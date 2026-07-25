# CURRENCIES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Currencies

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Currencies** hold the trading currencies (USD, EUR, GBP, INR…) with their symbol and a manually-maintained exchange rate vs INR, used for export invoicing and quotations.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_currencies`.

### Downstream consumers
| Consumer | How it uses a currency |
|---|---|
| Legal Entities master | `legal_entities.currency_id` references a currency |
| Quotations / Proforma Invoices | Invoice currency + symbol on export documents |
| Any price/amount field | Symbol rendered next to amounts |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.currencies` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | Currency Name | text | Yes | e.g. US Dollar; max 50 |
| `code` | Code | text | Yes | e.g. USD |
| `symbol` | Symbol | text | Yes | e.g. $, €, £, ₹ |
| `exchange_rate` | Exchange Rate (vs INR) | number | No | Manually maintained per RBI rate |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (backend)** — both `name` **and** `code` must each be independently unique within the tenant scope, case-insensitive (`uEach = ['name','code']`). "US Dollar"/"us dollar" collide, and "USD"/"usd" collide.
  - *Note:* the frontend config lists only `code` as its uniqueness hint, but the backend enforces both — the authoritative rule.
- **Exchange rate** — optional; entered manually (no live feed). Used for INR conversion on invoices.
- **Deletion** — soft delete, no in-use reference guard at this master (legal entities referencing a deleted currency are not blocked).

---

## 5. SCREEN

`/masters/currencies` — searchable list (search over `name`, `code`, `symbol`, `status`), KPI strip, Add/Edit modal with the five fields.

---

## 6. KNOWN LIMITATIONS

- Exchange rates are static — updated manually, not synced from any market feed.
- Deleting a currency does not check for referencing legal entities or documents.
- The frontend's uniqueness hint (`code` only) is narrower than the backend's actual rule (`name` + `code`).

---
*Related documents: CURRENCIES_TECHNICAL_DOCUMENTATION.md, CURRENCIES_API_DOCUMENTATION.md, CURRENCIES_CODE_WALKTHROUGH.md*
