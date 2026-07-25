# SEGMENTS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Segments

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Segments** are the business lines that classify orders, products and trading parties (e.g. Dry Fruits, Spices & Condiments, Pulses, Agro-Chemicals). They are one of the most widely consumed masters in the platform.

The master is served by the generic schema-driven engine (`MasterController` + `MasterPage.tsx`) but is unusual: it is **not** backed by a `master_*` table. Since the May-2026 consolidation it writes to the shared **`clm_segments`** table, so the simple "title + status" master form and the richer CLM Segment page edit the same rows.

### Downstream consumers
| Consumer | How it uses a segment |
|---|---|
| CLM Segment Rules (DCP) | Each segment carries required-document rules per party type (`ClmSegmentRule`) |
| Supplier / Vendor Directory | `vendor_directory.segment_id` references a segment (required field) |
| Customer / Consignee / Vendor / Product forms | Segment dropdown for tagging trading parties and goods |
| Reporting & filtering | Orders and products grouped by segment |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All segments across all tenants; may seed global rows |
| Client Admin / Client User | Own client's rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + own rows (CLM tables are branch-shared, so employees see the whole branch's segments) |

Permissioned module: `master.segments` (`can_view` / `can_add` / `can_edit` / `can_delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `title` | Segment Name | text | Yes | Stored on the `name` column via an accessor alias; max 50 chars |
| `status` | Status | select | Yes | Active / Inactive (model lower-cases to `active`/`inactive`) |

Auto-populated behind the scenes on create (not on the form): `code` (`S-NNN` per client), `regulatory_status` (defaults `less`), `buyer_consignee` (defaults `allowed`).

---

## 4. BUSINESS RULES

- **Uniqueness** — `title` must be unique within the tenant scope, case-insensitive ("Pulses" and "pulses" collide).
- **Title/name alias** — the form field is `title`, but the value lands on the `clm_segments.name` column; every response also appends `title` so existing frontends keep reading `row.title`.
- **Auto code** — on insert the model assigns the next `S-001…S-NNN` sequence per client (shared counter with `ClmSegmentController`).
- **Status normalization** — any status is folded to lowercase and forced to `active`/`inactive` (defaults `active`).
- **Deletion** — soft delete. There is no in-use reference guard on this master; removing a segment used by CLM rules/vendors can leave those references pointing at a deleted row, so deactivate rather than delete when in doubt.

---

## 5. SCREEN

`/masters/segments` — standard master shell: searchable list (search runs over `title`/`status`), KPI strip (Active/Inactive), Add/Edit modal with the two fields, row-level Edit/Delete gated by the creator-hierarchy. Detailed regulatory attributes are edited on the CLM Segment page, not here.

---

## 6. KNOWN LIMITATIONS

- Deleting a segment does not check whether CLM rules, vendors, customers or products still reference it.
- The master form exposes only `title` + `status`; `regulatory_status` / `buyer_consignee` can only be changed via the CLM Segment page.
- Backend enforces uniqueness on `title`; the two entry points (master form vs CLM page) share the counter, so codes stay consistent but the master form never shows the `S-NNN` code.

---
*Related documents: SEGMENTS_TECHNICAL_DOCUMENTATION.md, SEGMENTS_API_DOCUMENTATION.md, SEGMENTS_CODE_WALKTHROUGH.md*
