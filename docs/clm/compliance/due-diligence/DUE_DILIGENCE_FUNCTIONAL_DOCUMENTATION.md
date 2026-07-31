# DUE DILIGENCE (DD) — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Due Diligence (DD)**
> Route `/clm/due-diligence`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Where **KYC** answers *"who is this company?"*, **Due Diligence** answers *"is it safe to trade with them?"*. The DD master is the catalogue of **risk-verification documents** a counterparty can be asked to produce — bank reference letters, credit rating reports, audited financials, sanctions/AML screening certificates, litigation declarations, factory audit reports, references from existing buyers.

An entry defines **what the check is**, the **authority or body** that issues it, and how it expires. The Document Control Panel then decides, per segment, whether that check is Mandatory or Optional; the party uploads the evidence into the Evidence Vault.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Risk before revenue | Codifies the checks that must clear before a counterparty is onboarded |
| Segment-appropriate | A highly-regulated segment can demand far deeper DD than a less-regulated one |
| Multi-authority | A single check may be issued by several bodies (bank / rating agency / auditor) |
| Live authority names | Authorities are stored by id — renames propagate automatically |
| Cannot orphan | A DD entry referenced by a rule or an upload cannot be deleted |

### 1.3 Key features
- Add / edit / delete with a per-branch `DD-NNN` code.
- Multi-select authority picker (stored as ids, displayed as live names).
- Expiry descriptor (`N/A`, `Varies`, `MM/YYYY`).
- Per-row **in-use** flag + `used_in` list that locks the delete action.
- Feeds the DCP, the party onboarding forms, and the Evidence Vault.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All DD entries, all tenants |
| Client Admin / Client User | The client's entries + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.due_diligence`.

---

## 3. BUSINESS PROCESS FLOW

```
   PREREQUISITE — Authority master holds the issuing bodies
        │
        ▼
   Add DD Document
     ├─ name       (unique within your branch, case-insensitive)
     ├─ authority  (one or more — from the Authority master, stored as IDS)
     ├─ expiry     'N/A' | 'Varies' | 'MM/YYYY'
     └─ status     active | inactive
        │
        ▼  code DD-NNN allocated (restarts at 001 per branch)
   DD entry saved
        │
        ├─→ Document Control Panel: tick it M or O for a segment
        │        (the rule stores the CODE, e.g. "DD-002": "M")
        │
        ├─→ Customer / Consignee / Supplier form Stage 2:
        │        the required DD list renders from the segment's rule
        │
        └─→ Evidence Vault: the party uploads the actual report
                 (segment_doc_uploads.category = 'dd', doc_code = 'DD-002')
        │
        ▼  delete attempt while referenced
   409 + used_in ["Segment Rules", "Segment Doc Uploads"]
```

### 3.1 KYC vs DD — why they are separate catalogues
| | KYC | DD |
|---|---|---|
| Question answered | Identity — *who are you?* | Risk — *are you safe to trade with?* |
| Typical documents | PAN, Aadhaar, GST cert, Incorporation cert, IEC | Bank reference, credit report, audited financials, AML screening, factory audit |
| Refresh cadence | Rarely (identity is stable) | Periodically (risk changes) |
| Stored in | `clm_kyc_documents` | `clm_dd_documents` |
| Vault category | `kyc` | `dd` |

They are separate categories in `doc_selections` and in the Evidence Vault, so a segment can require heavy DD with light KYC or vice versa, and the profile scorecards report the two independently.

---

## 4. SCREEN SPECIFICATION (`ClmDdPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Search | Client-side across code, name and authority names |
| Table | CODE · DOCUMENT NAME · ISSUING AUTHORITY (chips, first + "+N") · EXPIRY · STATUS · ACTIONS |
| Authority column | Rendered by the shared `AuthorityBadges` component from `authority_list` |
| Row actions | Edit · Delete (**disabled with a tooltip when `in_use`**, listing `used_in`) |
| Add/Edit modal | Document Name, Issuing Authority (multi-select), Expiry, Status |
| Ordering | `id ASC` |

The modal (`DdModal`) is re-exported and **reused inside the Document Control Panel**, so a missing DD document can be created without leaving the rule-configuration screen.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Document name is unique **within your visibility scope**, case-insensitive |
| 2 | At least one **valid** authority is required — unknown tokens are dropped and an empty result is rejected |
| 3 | `code` (`DD-NNN`) is immutable and restarts at 001 per branch |
| 4 | `expiry` defaults to `N/A` when omitted |
| 5 | Editing is always allowed (subject to the creator-hierarchy rule); delete is blocked while referenced |
| 6 | Delete returns **409** with `used_in[]` |
| 7 | Authorities are stored as a comma-joined **id** list; display names resolve live |
| 8 | Consumers must read `authority_list` (array), never split the joined `authority` string |
| 9 | Employees may only edit or delete rows they created themselves |

### 5.1 Where "in use" is detected
| Table | Column | Label |
|---|---|---|
| `clm_segment_rules` | `doc_selections` (JSON contains `"DD-002"`) | Segment Rules |
| `segment_doc_uploads` | `doc_code` | Segment Doc Uploads |

---

## 6. STATUS MODEL

`active` \| `inactive`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Usage check scope | The in-use lookup is **not** scoped by `client_id`. Codes restart per tenant, so another tenant's reference to *their* `DD-001` can wrongly block your delete |
| No re-verification cycle | The catalogue has no "recheck every N months" field — periodic re-verification is a manual process |
| Expiry | The catalogue value is descriptive; the real date lives on the uploaded file |
| Delete | Hard delete, no restore |
| Status | `inactive` is stored but not filtered out of the DCP document picker |

---

*Related documents: DUE_DILIGENCE_TECHNICAL_DOCUMENTATION.md · DUE_DILIGENCE_CODE_WALKTHROUGH.md · DUE_DILIGENCE_API_DOCUMENTATION.md*
