# TRADE LICENSES — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Trade Licenses**
> Route `/clm/trade-licenses`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Trade Licenses master** is the catalogue of statutory permissions a business must hold to trade in a given segment — IEC (Importer Exporter Code), FSSAI Licence, Drug Licence, BIS Registration, Factory Licence, Pollution Control Board consent, APEDA/Spices Board registration, RCMC.

It differs from KYC and DD in what it asserts: KYC proves *identity*, DD assesses *risk*, and a Trade Licence proves **legal permission to trade**. Without the right licence the shipment itself is illegal, not merely undocumented — which is why highly-regulated segments almost always mark these Mandatory.

Each entry records the licence name, the **authorities** that issue it, and its **validity** pattern.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Legality, not just paperwork | Codifies the permissions without which a shipment cannot lawfully move |
| Segment-driven | A Tobacco or Pharma segment demands licences a general-goods segment does not |
| Multi-authority | One licence may be issued by several bodies (central + state) |
| Live authority names | Authorities are stored by id — renames propagate automatically |
| Cannot orphan | A licence referenced by a rule or an upload cannot be deleted |

### 1.3 Key features
- Add / edit / delete with a per-branch `TL-NNN` code.
- Multi-select authority picker (stored as ids, displayed as live names).
- **Validity** descriptor (the licence-specific analogue of KYC/DD's `expiry`).
- Per-row **in-use** flag + `used_in` list that locks the delete action.
- Feeds the DCP, the party onboarding forms, and the Evidence Vault.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All licences, all tenants |
| Client Admin / Client User | The client's licences + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.trade_licenses`.

---

## 3. BUSINESS PROCESS FLOW

```
   PREREQUISITE — Authority master holds the licensing bodies (DGFT, FSSAI, CDSCO, BIS …)
        │
        ▼
   Add Trade Licence
     ├─ name       (unique within your branch, case-insensitive)
     ├─ authority  (one or more — from the Authority master, stored as IDS)
     ├─ validity   'N/A' | 'Varies' | '1 Year' | '5 Years' | 'MM/YYYY' …
     └─ status     active | inactive
        │
        ▼  code TL-NNN allocated (restarts at 001 per branch)
   Licence saved
        │
        ├─→ Document Control Panel: tick it M or O for a segment
        │        (the rule stores the CODE, e.g. "TL-001": "M")
        │
        ├─→ Customer / Consignee / Supplier form Stage 2:
        │        the required licence list renders from the segment's rule
        │
        └─→ Evidence Vault: the party uploads the licence certificate
                 (segment_doc_uploads.category = 'tl', doc_code = 'TL-001')
        │
        ▼  delete attempt while referenced
   409 + used_in ["Segment Rules", "Segment Doc Uploads"]
```

### 3.1 The three compliance catalogues side by side
| | KYC | DD | Trade Licence |
|---|---|---|---|
| Asserts | Identity | Risk | **Legal permission** |
| Typical rows | PAN, GST cert, Incorporation cert | Bank reference, credit report, AML screening | IEC, FSSAI licence, BIS registration, RCMC |
| Consequence if missing | Cannot verify the party | Cannot assess exposure | **The trade itself is unlawful** |
| Date column | `expiry` | `expiry` | **`validity`** |
| Vault category | `kyc` | `dd` | `tl` |

---

## 4. SCREEN SPECIFICATION (`ClmTradeLicensesPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Search | Client-side across code, name and authority names |
| Table | CODE · LICENCE NAME · ISSUING AUTHORITY (chips, first + "+N") · VALIDITY · STATUS · ACTIONS |
| Authority column | Rendered by the shared `AuthorityBadges` component from `authority_list` |
| Row actions | Edit · Delete (**disabled with a tooltip when `in_use`**, listing `used_in`) |
| Add/Edit modal | Licence Name, Issuing Authority (multi-select), Validity, Status |
| Ordering | `id ASC` |

Validation failures return `errors.name`, so a duplicate name renders **inline under the LICENCE NAME field** rather than as a global toast.

The modal (`TlModal`) is re-exported and **reused inside the Document Control Panel**, so a missing licence can be created without leaving the rule-configuration screen.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Licence name is unique **within your visibility scope**, case-insensitive |
| 2 | At least one **valid** authority is required — unknown tokens are dropped and an empty result is rejected |
| 3 | `code` (`TL-NNN`) is immutable and restarts at 001 per branch |
| 4 | `validity` defaults to `N/A` when omitted |
| 5 | Editing is always allowed (subject to the creator-hierarchy rule); delete is blocked while referenced |
| 6 | Delete returns **409** with `used_in[]` |
| 7 | Authorities are stored as a comma-joined **id** list; display names resolve live |
| 8 | Consumers must read `authority_list` (array), never split the joined `authority` string |
| 9 | Employees may only edit or delete rows they created themselves |

### 5.1 Where "in use" is detected
| Table | Column | Label |
|---|---|---|
| `clm_segment_rules` | `doc_selections` (JSON contains `"TL-001"`) | Segment Rules |
| `segment_doc_uploads` | `doc_code` | Segment Doc Uploads |

---

## 6. STATUS MODEL

`active` \| `inactive`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Usage check scope | The in-use lookup is **not** scoped by `client_id`. Codes restart per tenant, so another tenant's reference to *their* `TL-001` can wrongly block your delete |
| Authority field length | `authority` is capped at **255** characters here (KYC and DD were widened to 2,000) — a licence can name far fewer authorities before hitting the limit |
| Validity | The catalogue value is a descriptor; the actual expiry date of a specific licence lives on the uploaded file |
| No renewal alerts | The master has no renewal-reminder mechanism; expiry tracking happens in the Evidence Vault |
| Delete | Hard delete, no restore |
| Status | `inactive` is stored but not filtered out of the DCP document picker |

---

*Related documents: TRADE_LICENSES_TECHNICAL_DOCUMENTATION.md · TRADE_LICENSES_CODE_WALKTHROUGH.md · TRADE_LICENSES_API_DOCUMENTATION.md*
