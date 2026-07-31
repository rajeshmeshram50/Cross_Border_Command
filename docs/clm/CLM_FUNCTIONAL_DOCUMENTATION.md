# CLM MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Central Legal Module (CLM)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation (module-wide) |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
CLM is the compliance and contracting backbone of the product. It answers one question for every trade: **"which documents does this deal legally need, do we have them, and have they been signed?"**

It does that in four layers:

1. **Masters** — the catalogues of what exists: business Segments, regulatory Authorities, and the four document catalogues (KYC, Due Diligence, Quality & Compliance, Trade Licenses).
2. **Rules** — the **Document Control Panel (DCP)** maps *segment × domestic/international* → the exact document set, each marked **Mandatory (M)** or **Optional (O)**.
3. **Content** — the drafting libraries: Trade Documents, Agreements, Clauses, Terms & Conditions. These are the actual papers, composed in a rich-text editor with a branded page shell and `{{placeholder}}` merge fields.
4. **Execution** — sending papers out for e-signature via **Zoho Sign**, tracking who viewed/signed/declined, and filing the signed PDF + completion certificate into the **Evidence Vault** / **Regulatory Defense File**.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Nothing ships uncompliant | The DCP rule decides required docs; missing mandatory docs block downstream Sales/P2P actions |
| One catalogue, many deals | Documents defined once per segment are reused for every customer, consignee and supplier in that segment |
| Domestic vs export | A single segment carries two independent document sets — India-domestic and international |
| Legal-grade audit | Every signature request stores signers, timestamps, the signed PDF and Zoho's completion certificate |
| Renames never break history | Authorities are stored by id and resolved live; segments cascade their rename into party records |
| Paper survives edits | Once a draft is sent for signature it locks — the master can never silently diverge from what the counterparty signed |

### 1.3 Key features
- **6 compliance masters** (Segment, Authority, KYC, DD, QC, Trade Licenses) — branch-isolated, code-sequenced, delete-guarded by usage.
- **Document Control Panel** — 2-stage rule builder; one rule per (segment, domestic|international).
- **4 drafting libraries** (Trade Documents, Agreements, Clauses, T&C) with DOCX ⇄ HTML round-trip, header/footer page shell and PDF export.
- **Zoho Sign integration** — multi-document bundles (up to 10), up to 5 signers, drag-positioned signature boxes, reminders, recall, decline capture.
- **Case-to-Case (CTC) contracts** — standalone agreements with no shipment: 4-stage lifecycle (Draft → Internal Approval → Signing → Repository), multi-approver voting, clarification threads, version history.
- **CLM Command Center** — Analytics, Diagnosis & Resolution Center, Regulatory Defense File.
- **Customer / Supplier Profiles** — per-party compliance scorecards (X of Y documents done).

---

## 2. WHERE IT LIVES (navigation)

Sidebar → **CLM** (visible to `branch_user` and `employee` only; higher tiers hold the permission rows purely to grant downward).

| Group | Screens | Route |
|---|---|---|
| **CLM Command Center** | CLM Analytics · Diagnosis & Resolution Center · Regulatory Defense File | `/clm/analytics`, `/clm/diagnosis-resolution`, `/clm/regulatory-defense` |
| **Operations — With Shipment ID** | Customer Profile · Supplier Profile | `/clm/buyer-profile`, `/clm/supplier-profile` |
| **Operations — Without Shipment ID** | Case to Case Contracts · Agreements We Sent · Agreements To Approve | `/clm/case-to-case`, `/clm/agreements-sent`, `/clm/agreements-to-approve` |
| **Compliance & Regulatory** | Segment · Authority · Quality & Compliance Docs · KYC · Due Diligence · Trade Licenses | `/clm/segment`, `/clm/authority`, `/clm/quality-docs`, `/clm/kyc`, `/clm/due-diligence`, `/clm/trade-licenses` |
| **Contract & Document Masters** | Document Control Panel · Trade Documents · Agreements · Terms & Conditions · Clause Library | `/clm/document-panel`, `/clm/trade-documents`, `/clm/agreements`, `/clm/terms-conditions`, `/clm/clause-library` |

> `/clm/segment` and `/master/segments` are the **same** screen over the same `clm_segments` table — adding on either surfaces on both.

---

## 3. ROLES & ACCESS

| Role | CLM access |
|---|---|
| Super Admin | Everything, across all tenants |
| Client Admin / Client User | Their client's rows + globals; may narrow with the Branch Switcher; grants CLM leaves downward |
| Branch User (branch admin) | Globals + client-level rows + **own branch only** — sibling branches are invisible |
| Employee | **Reads the whole branch's** CLM rows (CLM masters are branch-shared, unlike other masters) but can only **edit/delete rows they created themselves** |

Per-leaf visibility is driven by permission slugs `clm.segment`, `clm.kyc`, `clm.document_panel`, … Each route is also guarded server-side and by the frontend route guard (`routeAccess.ts`) — direct URL access to a page you lack is blocked.

---

## 4. BUSINESS PROCESS FLOW

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLM END-TO-END FLOW                             │
└────────────────────────────────────────────────────────────────────────┘

 SETUP (one-time, per branch)
   Authority master (FSSAI, DGFT, BIS, GST, UIDAI …)
        │
        ├─→ KYC docs        (PAN, Aadhaar, GST cert …)      each names 1..N authorities
        ├─→ DD docs         (bank ref, credit report …)
        ├─→ QC docs         (ISO 9001, HACCP …)             + QA params, min criteria
        └─→ Trade Licenses  (IEC, FSSAI licence …)
                                    │
   Segment master (Tobacco, Rice, Ethanol …)                │
        │   · regulatory tier: highly | less                │
        │   · buyer≠consignee allowed?                      │
        ▼                                                   ▼
   DOCUMENT CONTROL PANEL — one rule per (segment × domestic|international)
        Stage 1: pick segment, tier, trade type, auto-map authorities
        Stage 2: tick each KYC / DD / TL / QC document as M or O
        → the rule is what every downstream screen reads

 CONTENT (drafting libraries)
   Clause Library ──┐
   T&C Library    ──┤→ composed into → Trade Documents / Agreements / CTC drafts
   Agreement Types ─┘   (rich-text editor · header/footer page shell · placeholders)

 EXECUTION
   ┌── With Shipment ID ──────────────────────────────────────────────┐
   │  Sales lead → products → segments → DCP rule                      │
   │  Party (Customer / Consignee / Supplier) uploads required docs    │
   │      → segment_doc_uploads  (Evidence Vault)                      │
   │  Applicable Agreements + Trade Documents surface on the lead      │
   │      → Send for Signature (Zoho) → signed PDF + certificate       │
   └───────────────────────────────────────────────────────────────────┘
   ┌── Without Shipment ID (Case-to-Case) ────────────────────────────┐
   │  Stage 1 Draft → Stage 2 Internal Approval (all approvers must    │
   │  approve; reject/clarify loops back) → Stage 3 Signing →          │
   │  Stage 4 Final Contract Repository                                │
   └───────────────────────────────────────────────────────────────────┘

 OVERSIGHT
   Customer / Supplier Profile  → per-party X-of-Y compliance scorecards
   Diagnosis & Resolution       → what's blocked + escalate
   Regulatory Defense File      → the audit-ready evidence repository
   CLM Analytics                → completion trends
```

---

## 5. SCREEN SPECIFICATIONS (summary)

Each screen has its own detailed spec in the sub-folders listed in §8.

| Screen | What the user does |
|---|---|
| **Segment** | Add/edit trade segments; set regulatory tier + whether buyer may differ from consignee. Name and tier **freeze** once referenced. |
| **Authority** | Add/edit regulatory bodies. Rename cascades into legacy name-based tables; delete blocked while referenced. |
| **KYC / DD / Trade Licenses** | Catalogue a document: name + issuing authorities + expiry/validity. `in_use` badge shows where it's referenced. |
| **Quality & Compliance Docs** | Richer: purpose, issuing authority, cert vs compliance-doc type, QA parameters, minimum acceptance criteria. |
| **Document Control Panel** | 2-stage modal builds the segment rule. Lists rules with M/O count badges + authority chips. |
| **Trade Documents** | Two tabs — *Names* (the catalogue TDN-NNN) and *Library* (TDL-NNN drafts: title, type, purpose, applicable party, segment, body content, header/footer). Upload/download Word, export PDF. |
| **Agreements** | Two tabs — *Types* (AT-NNN) and *Library* (A-NNN). Same wizard shape as Trade Documents plus a "requires signing" flag. |
| **Clause Library** | Two tabs — *Clause Types* (CLT-NNN) and *Clauses* (CL-NNN). Clauses are **copied** into drafts as `<h3>Name</h3>` blocks. |
| **Terms & Conditions** | Two tabs — *Document Categories* (DC-NNN) and *T&C entries* (TNC-NNN). One entry per (segment, category). |
| **Case to Case Contracts** | Full-screen 4-stage form; counterparty picker; approver list; version history; timeline. |
| **Agreements We Sent** | The sender's outbox — X-of-Y approval progress, clarification replies, resubmit. |
| **Agreements To Approve** | The approver's inbox — approve / reject with reason / raise clarification. **The row status is *your own* decision, not the contract-wide verdict.** |
| **Customer / Supplier Profile** | Compliance scorecards split With-Shipment vs Without-Shipment, party-wise and transaction-wise. |
| **Diagnosis & Resolution** | Combined blocked-items view + escalation form. |
| **Regulatory Defense File** | Three tabs (with-shipment / without-shipment / case-to-case) each drilling into the Evidence Vault. |
| **CLM Analytics** | Completion dashboards built from the buyer + supplier profile endpoints. |

---

## 6. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Every CLM master is **branch-isolated**: the same name may exist in two branches; codes restart at 001 per branch |
| 2 | Employees **see** their whole branch's CLM rows but may only **edit/delete their own** |
| 3 | A segment's **name and regulatory status freeze** once it is referenced by any customer/consignee/vendor/product/rule/library |
| 4 | A segment rename **cascades** into the comma-joined `segment` strings on customers and consignees (whole-token match only) |
| 5 | One DCP rule per **(segment, document_type)** — a second `international` rule for the same segment returns 409 |
| 6 | `document_type` (domestic \| international) is **mandatory** on every rule; legacy rows were backfilled to `international` |
| 7 | Authorities are stored **by id** in KYC/DD/QC/TL and resolved to names at read time — renames propagate automatically |
| 8 | A master row cannot be deleted while referenced (segment rules, segment doc uploads, product QC records, party documents) — returns **409 with `used_in`** |
| 9 | A segment only appears in the Customer/Consignee/Vendor **segment picker** if its DCP rule has ≥ 1 document |
| 10 | A **Trade Document** locks against edit/delete once a signature request for it reaches `completed` |
| 11 | An **Agreement** locks as soon as it has been **sent** at least once (`inprogress` OR `completed`) — stricter than trade documents |
| 12 | One signature request may bundle at most **10 documents** and **5 signers**; duplicate signer emails are collapsed |
| 13 | All documents in one signature request must target the **same applicable party** (all Buyer, or all Consignee, or all Buyer+Consignee) |
| 14 | A **T&C** entry is unique per (segment, category); Debit/Credit Note categories carry no segment/regulatory/party at all |
| 15 | A **clause type** cannot be renamed or deleted while any clause references it (linked by name, not FK) |
| 16 | A **trade document name** cannot be renamed or deleted while any library draft uses it |
| 17 | A **clause** cannot be deleted once inserted into any CTC agreement |
| 18 | A CTC contract is only `approved` when **every** listed approver has approved; one rejection blocks the whole contract |
| 19 | On a CTC, the **Customer and Consignee must share a category** — both Domestic (India) or both International; Supplier is exempt |
| 20 | CTC cannot be sent for signing before approval; cannot move to repository before every recipient signs |
| 21 | Editing a sales document while its signature is in flight **supersedes** the pending request — it must be re-sent |

---

## 7. STATUS MODELS

**Signature request** — `draft → inprogress → completed`, with side exits `declined`, `recalled`, `expired`, `superseded`.

**CTC contract** — two independent axes:
- `stage`: 1 Drafting · 2 Internal Review · 3 Signing · 4 Repository
- `approval_status`: `pending` → `approved` \| `rejected` \| `clarification`
- list bucket (`status`): `inprogress` \| `signed` \| `rejected`

**Master rows** — `active` \| `inactive`.

---

## 8. RELATED DOCUMENTS

| Area | Folder |
|---|---|
| Segment, Authority, KYC, DD, QC, Trade Licenses | [compliance-masters/](compliance-masters/) |
| Document Control Panel (segment rules) | [document-control-panel/](document-control-panel/) |
| Trade Documents master | [trade-documents/](trade-documents/) |
| Agreements master | [agreements/](agreements/) |
| Clause Library + Terms & Conditions | [clauses-and-tnc/](clauses-and-tnc/) |
| Case-to-Case contracts + Sent/To-Approve | [case-to-case/](case-to-case/) |
| Zoho Sign e-signature | [signatures/](signatures/) |
| Analytics · Diagnosis · Regulatory Defense · Profiles | [command-center/](command-center/) |

---

## 9. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| CLM Analytics | Ships an embedded mock dataset alongside the live buyer/supplier feeds — there is no dedicated `/clm/analytics` endpoint |
| Escalations | `Diagnosis & Resolution → Escalate` writes an audit log line only; there is no escalation/notification store yet |
| Trade Documents in the DCP | The `td` category was **removed** from the Document Control Panel — trade documents are matched by segment on the library row instead |
| Clause / trade-doc "in use" | Detected by **string matching** the inserted heading, not by a foreign key — a renamed clause can slip past the guard |
| Rule codes | `SR-NNN` is allocated **client-wide**, not per branch (unlike every other CLM code) |
| Render limits | PDF/DOCX generation refuses content over ~1,000,000 characters (~1 MB of HTML) with a clean 422 |
| Legacy `.doc` | Only `.docx` can be converted; binary `.doc` uploads are rejected with a "Save As .docx" message |
| CTC signing | `record-signature` / `move-to-repository` are manual sender-side actions; only the Zoho path auto-detects signing |

---

*Related documents: CLM_TECHNICAL_DOCUMENTATION.md · CLM_CODE_WALKTHROUGH.md · CLM_API_DOCUMENTATION.md*
