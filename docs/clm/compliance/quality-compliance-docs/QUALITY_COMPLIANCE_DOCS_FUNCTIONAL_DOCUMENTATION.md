# QUALITY & COMPLIANCE DOCS (QC) — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Quality & Compliance Docs**
> Route `/clm/quality-docs`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Quality & Compliance master** catalogues the quality certificates and compliance documents a product or supplier must carry — ISO 9001, HACCP, GOTS, CE marking, WHO-GMP, BIS, RoHS, REACH, Certificate of Analysis, Phytosanitary Certificate.

It is the richest of the four document catalogues because compliance reviewers read these in isolation, not just as a checklist item. Beyond name and issuing authority, each entry records:
- **Purpose** — a one-line statement of what the certificate attests.
- **Document type** — `cert` (a formal certificate) or `comp` (a compliance document).
- **QA parameters** — the testing parameters the certificate covers.
- **Minimum criteria** — the acceptance thresholds.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Quality is specified, not assumed | QA parameters and minimum criteria are captured up front, not negotiated per shipment |
| Cert vs compliance doc | The `cert`/`comp` split drives the page's tab counts and lets reviewers filter |
| Reused by products | Product QC records reference these entries by name, so the master feeds the product master too |
| Live authority names | Issuing bodies are stored by id — renames propagate automatically |
| Correctly scoped delete guard | Uniquely among the four catalogues, QC's usage check is **client-scoped** |

### 1.3 Key features
- Add / edit / delete with a per-branch `QC-NNN` code.
- Tab counts — **All / Certificates / Compliance Docs**.
- Issuing-authority picker (stored as ids under the column `issued_by`).
- Free-text QA parameters and minimum acceptance criteria.
- Per-row **in-use** flag + `used_in` list that locks the delete action.
- Feeds the DCP, the party onboarding forms, the Evidence Vault, and the product QC records.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All QC entries, all tenants |
| Client Admin / Client User | The client's entries + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.quality_docs`.

---

## 3. BUSINESS PROCESS FLOW

```
   PREREQUISITE — Authority master holds the certifying bodies (BIS, FSSAI, CDSCO …)
        │
        ▼
   Add QC Document
     ├─ name          (unique within your branch, case-insensitive)
     ├─ purpose       (required — what the certificate attests)
     ├─ issued_by     (authority — stored as IDS)
     ├─ doc_type      cert | comp        (default: cert)
     ├─ qa_params     free text — testing parameters
     ├─ min_criteria  free text — acceptance thresholds
     └─ status        active | inactive
        │
        ▼  code QC-NNN allocated (restarts at 001 per branch)
   QC entry saved
        │
        ├─→ Document Control Panel: tick it M or O for a segment
        │        (the rule stores the CODE, e.g. "QC-003": "M")
        │
        ├─→ Customer / Consignee / Supplier form Stage 2:
        │        the required QC list renders from the segment's rule
        │
        ├─→ Evidence Vault: the party uploads the certificate
        │        (segment_doc_uploads.category = 'qc', doc_code = 'QC-003')
        │
        └─→ Product master: product QC records reference the entry BY NAME
        │
        ▼  delete attempt while referenced
   409 + used_in ["Segment Rules", "Segment Doc Uploads", "Product QC Records"]
```

### 3.1 `cert` vs `comp`
| Type | Meaning | Examples |
|---|---|---|
| `cert` | A formal certificate issued by a certifying body after audit or testing | ISO 9001, HACCP, GOTS, WHO-GMP, BIS |
| `comp` | A compliance document or declaration accompanying goods | RoHS declaration, REACH statement, Certificate of Analysis |

The distinction drives the page's tab counts (`counts.cert` / `counts.comp`) and lets a reviewer separate audited certifications from self-declared compliance paperwork.

### 3.2 QC vs the other three catalogues
| | KYC | DD | Trade Licence | **QC** |
|---|---|---|---|---|
| Asserts | Identity | Risk | Legal permission | **Product/process quality** |
| Authority column | `authority` | `authority` | `authority` | **`issued_by`** |
| Date column | `expiry` | `expiry` | `validity` | **none** |
| Extra fields | — | — | — | purpose, doc_type, qa_params, min_criteria |
| Usage check scoped by client | ✗ | ✗ | ✗ | **✓** |

---

## 4. SCREEN SPECIFICATION (`ClmQcPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **All** · **Certificates** · **Compliance Docs** with live counts |
| Search | Client-side across code, name, purpose and issuing authority |
| Table | CODE · CERTIFICATE NAME · PURPOSE · ISSUED BY (chips) · TYPE · STATUS · ACTIONS |
| Row actions | Edit · Delete (**disabled with a tooltip when `in_use`**, listing `used_in`) |
| Add/Edit modal | QC Certificate Name, Purpose, Issued By, Type (cert/comp), QA Parameters, Minimum Criteria, Status |
| Ordering | `id ASC` |

Duplicate-name failures return `errors.name`, so the message renders **inline under QC CERTIFICATE NAME** rather than as a global toast.

The modal (`QcModal`) is re-exported and **reused inside the Document Control Panel**, so a missing QC document can be created without leaving the rule-configuration screen.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Certificate name is unique **within your visibility scope**, case-insensitive |
| 2 | `purpose` is **required** (≤ 500 characters) |
| 3 | `issued_by` must resolve to at least one **valid** authority; unknown tokens are dropped |
| 4 | `doc_type` defaults to `cert` when omitted |
| 5 | `code` (`QC-NNN`) is immutable and restarts at 001 per branch |
| 6 | `qa_params` and `min_criteria` are optional free text (≤ 256 characters each) |
| 7 | Editing is always allowed (subject to the creator-hierarchy rule); delete is blocked while referenced |
| 8 | Delete returns **409** with `used_in[]` |
| 9 | Employees may only edit or delete rows they created themselves |

### 5.1 Where "in use" is detected — **all client-scoped**
| Table | Match | Label |
|---|---|---|
| `clm_segment_rules` | `doc_selections` contains `"QC-003"`, `client_id` matched | Segment Rules |
| `segment_doc_uploads` | `doc_code = 'QC-003'`, `client_id` matched | Segment Doc Uploads |
| `product_qc_records` | `qc_name = <name>`, scoped via a join to `products.client_id` | Product QC Records |

> `product_qc_records` has no `client_id` of its own, so the check joins through `products` to stay tenant-safe.

---

## 6. STATUS MODEL

`active` \| `inactive`. `doc_type` (`cert` \| `comp`) is a classification, not a lifecycle state.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Product link is by **name** | `product_qc_records.qc_name` stores the name, not the code — so renaming a QC entry silently detaches it from existing product records (unlike KYC/DD/TL, which are code-linked) |
| No expiry column | QC entries carry no `expiry`/`validity` descriptor; certificate expiry is captured only on the uploaded file |
| `issued_by` length | Capped at 255 characters — a QC document naming many certifying bodies can hit the limit |
| Free-text QA fields | `qa_params` and `min_criteria` are unstructured strings capped at 256 characters, not parameter/threshold pairs |
| Delete | Hard delete, no restore |
| Status | `inactive` is stored but not filtered out of the DCP document picker |

---

*Related documents: QUALITY_COMPLIANCE_DOCS_TECHNICAL_DOCUMENTATION.md · QUALITY_COMPLIANCE_DOCS_CODE_WALKTHROUGH.md · QUALITY_COMPLIANCE_DOCS_API_DOCUMENTATION.md*
