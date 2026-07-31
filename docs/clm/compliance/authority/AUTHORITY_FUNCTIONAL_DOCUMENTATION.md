# AUTHORITY — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Authority**
> Route `/clm/authority`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
An **Authority** is a body that issues or certifies a document — FSSAI, DGFT, BIS, UIDAI, the GST Department, a bank, a chamber of commerce. It is the shared lookup behind every CLM document master: a KYC document names the authority that issues it, a Trade Licence names the licensing body, a QC certificate names its certifying body.

The authority master is deliberately the **only** place these names are typed. Everywhere else stores the authority's **id**, and the display name is resolved live — so renaming "FSSAI" to "Food Safety and Standards Authority of India" instantly updates every KYC, DD, QC and Trade Licence row that references it, with no data migration.

### 1.2 Business value
| Benefit | Description |
|---|---|
| One source of truth | Type an authority name once; every document master reuses it |
| Free renames | Stored by id, resolved on read — a rename propagates by itself |
| Legacy kept in sync | The older name-based vendor/customer document tables are rewritten on rename |
| Safe deletes | Blocked while any document, party record or segment rule references it |
| Multi-authority docs | One document can name several authorities (a comma-joined id list) |

### 1.3 Key features
- Add / edit / delete with a per-branch `AUTH-NNN` code.
- Description field (mandatory) explaining what the body governs.
- Per-row **in-use** flag that locks the delete action.
- **Rename cascade** into the legacy name-based tables.
- Referenced by id in CLM masters, by name in legacy party documents, and by **code** inside segment rules.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All authorities, all tenants |
| Client Admin / Client User | The client's authorities + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.authority`.

---

## 3. BUSINESS PROCESS FLOW

```
   Add Authority
     ├─ name         (unique within your branch, case-insensitive)
     ├─ description  (required, ≤500 chars — what it governs)
     └─ status       active | inactive
        │
        ▼  code AUTH-NNN allocated (restarts at 001 per branch)
   Authority saved
        │
        ├─→ KYC / DD / Trade Licence documents pick 1..N authorities  (stored as IDS)
        ├─→ Quality & Compliance docs pick an issuing authority       (stored as IDS)
        ├─→ Document Control Panel auto-maps authority CODES into the rule's auths_json
        └─→ Legacy vendor/customer document rows store the authority NAME
        │
        ▼  rename
   CLM masters need no change (id → live name)
   Legacy name-based tables are REWRITTEN by cascadeRename()
        │
        ▼  delete attempt while referenced
   409 + used_in[]  — reassign those records first
```

### 3.1 The two storage styles
| Style | Tables | Rename behaviour |
|---|---|---|
| **By id** (current) | `clm_kyc_documents.authority`, `clm_dd_documents.authority`, `clm_trade_licenses.authority`, `clm_qc_documents.issued_by` | Nothing to do — the name is resolved live on every read |
| **By name** (legacy) | `vendor_documents.issuing_authority`, `customer_documents.issuing_authority`, `vendor_owners.issuing_authority` | Rewritten by the rename cascade |
| **By code** | `clm_segment_rules.auths_json` | Codes are immutable, so nothing to do |

A migration (`2026_06_17_000000_convert_clm_doc_authority_to_ids`) converted the CLM masters from names to ids. Tokens that don't resolve to a known id are passed through unchanged, so legacy free text is never lost.

---

## 4. SCREEN SPECIFICATION (`ClmAuthorityPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Search | Client-side across code, name and description |
| Table | CODE · AUTHORITY NAME · DESCRIPTION · STATUS · ACTIONS |
| Row actions | Edit (always available) · Delete (**disabled when `in_use`**) |
| Add/Edit modal | Name, Description, Status |
| Ordering | `id ASC` — oldest first |

Editing stays open even for in-use rows *by design*: the CLM masters reference by id and the legacy tables are kept in sync, so a rename is always safe. Only deletion is blocked.

The `AuthorityBadges.tsx` component renders authority chips elsewhere in CLM — it shows the first authority plus a "+N" popover for the rest.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Authority name is unique **within your visibility scope**, case-insensitive |
| 2 | Description is **required** (≤ 500 characters) |
| 3 | `code` (`AUTH-NNN`) is immutable and restarts at 001 per branch |
| 4 | Editing is allowed even when in use; deleting is not |
| 5 | A rename rewrites `issuing_authority` in `vendor_documents`, `customer_documents` and `vendor_owners`, scoped to the tenant |
| 6 | Delete returns **409** listing every referencing area |
| 7 | A document may name **several** authorities — stored as a comma-joined id list |
| 8 | Authority names may themselves contain commas, so consumers must use the array form (`authority_list`), never re-split the joined display string |
| 9 | Employees may only edit or delete authorities they created themselves |

### 5.1 Where "in use" is detected
| Reference style | Table / column | Label |
|---|---|---|
| id | `clm_kyc_documents.authority` | KYC Documents |
| id | `clm_dd_documents.authority` | Due Diligence Documents |
| id | `clm_trade_licenses.authority` | Trade Licenses |
| id | `clm_qc_documents.issued_by` | Quality & Compliance Docs |
| name | `vendor_documents.issuing_authority` | Vendor Documents |
| name | `customer_documents.issuing_authority` | Customer Documents |
| name | `vendor_owners.issuing_authority` | Vendor Owners |
| code | `clm_segment_rules.auths_json` | Segment Rules |

---

## 6. STATUS MODEL

`active` \| `inactive`. Inactive authorities remain resolvable for historical documents but should not be picked for new ones.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Commas in names | An authority named "Aadhaar, Passport, Voter ID" is legal but forces every consumer to use the array form — a UI that splits the joined string will over-count |
| Delete | Hard delete, no restore |
| Status | `inactive` is stored but not filtered out of the document-master pickers |
| Legacy sync | The rename cascade covers three known tables; a table added later must be registered in `nameUsageTables()` or it will drift |

---

*Related documents: AUTHORITY_TECHNICAL_DOCUMENTATION.md · AUTHORITY_CODE_WALKTHROUGH.md · AUTHORITY_API_DOCUMENTATION.md*
