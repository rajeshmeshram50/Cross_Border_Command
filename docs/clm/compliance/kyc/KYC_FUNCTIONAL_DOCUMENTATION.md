# KYC — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **KYC**
> Route `/clm/kyc`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **KYC master** is the catalogue of *Know-Your-Customer* identity documents a trading partner can be asked to produce — PAN Card, Aadhaar, GST Certificate, Certificate of Incorporation, Bank Statement, IEC. It defines **what a document is**, not who has it.

Each entry records the document's name, the **authorities** that issue it (one document may have several), and how it expires. The Document Control Panel then picks entries from this catalogue and tags them **Mandatory** or **Optional** for a given segment; the party (customer / consignee / supplier) uploads the actual file into the Evidence Vault.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Define once, reuse everywhere | One "GST Certificate" entry serves every segment, every party, every branch |
| Multi-authority | A document can name several issuing bodies without duplicating the entry |
| Live authority names | Authorities are stored by id — renaming one updates every KYC row instantly |
| Expiry awareness | `N/A`, `Varies` or `MM/YYYY` drives the expiry column in the vault |
| Cannot orphan | A KYC entry in use by a rule or an upload cannot be deleted |

### 1.3 Key features
- Add / edit / delete with a per-branch `KYC-NNN` code.
- Multi-select authority picker (stored as ids, displayed as live names).
- Expiry descriptor.
- Per-row **in-use** flag + `used_in` list that locks the delete action.
- Feeds the DCP, the party onboarding forms, and the Evidence Vault.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All KYC entries, all tenants |
| Client Admin / Client User | The client's entries + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.kyc`.

---

## 3. BUSINESS PROCESS FLOW

```
   PREREQUISITE — Authority master already holds the issuing bodies
        │
        ▼
   Add KYC Document
     ├─ name       (unique within your branch, case-insensitive)
     ├─ authority  (one or more — picked from the Authority master, stored as IDS)
     ├─ expiry     'N/A' | 'Varies' | 'MM/YYYY'
     └─ status     active | inactive
        │
        ▼  code KYC-NNN allocated (restarts at 001 per branch)
   KYC entry saved
        │
        ├─→ Document Control Panel: tick it M or O for a segment
        │        (the rule stores the CODE, e.g. "KYC-003": "M")
        │
        ├─→ Customer / Consignee / Supplier form Stage 2:
        │        the required KYC list is rendered from the segment's rule
        │
        └─→ Evidence Vault: the party uploads the actual file
                 (segment_doc_uploads.doc_code = 'KYC-003')
        │
        ▼  delete attempt while referenced
   409 + used_in ["Segment Rules", "Segment Doc Uploads"]
```

### 3.1 Expiry semantics
| Value | Meaning |
|---|---|
| `N/A` | The document never expires (PAN, Certificate of Incorporation) |
| `Varies` | Expiry differs per issuance — the vault captures the actual date at upload |
| `MM/YYYY` | A fixed expiry pattern |

The value is a free-text descriptor for the catalogue. The **actual** expiry date of a specific uploaded file is captured separately on `segment_doc_uploads.expiry_date`.

---

## 4. SCREEN SPECIFICATION (`ClmKycPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Search | Client-side across code, name and authority names |
| Table | CODE · DOCUMENT NAME · ISSUING AUTHORITY (chips, first + "+N") · EXPIRY · STATUS · ACTIONS |
| Authority column | Rendered by the shared `AuthorityBadges` component from `authority_list` |
| Row actions | Edit · Delete (**disabled with a tooltip when `in_use`**, listing `used_in`) |
| Add/Edit modal | Document Name, Issuing Authority (multi-select), Expiry, Status |
| Ordering | `id ASC` |

The same modal (`KycModal`) is re-exported and **reused inside the Document Control Panel**, so a user configuring a rule can add a missing KYC document without leaving the page.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Document name is unique **within your visibility scope**, case-insensitive |
| 2 | At least one **valid** authority is required — unknown tokens are dropped and an empty result is rejected |
| 3 | `code` (`KYC-NNN`) is immutable and restarts at 001 per branch |
| 4 | `expiry` defaults to `N/A` when omitted |
| 5 | Editing is always allowed (subject to the creator-hierarchy rule); delete is blocked while referenced |
| 6 | Delete returns **409** with `used_in[]` |
| 7 | Authorities are stored as a comma-joined **id** list; the display name is resolved live |
| 8 | Consumers must read `authority_list` (array), never split the joined `authority` string |
| 9 | Employees may only edit or delete rows they created themselves |

### 5.1 Where "in use" is detected
| Table | Column | Label |
|---|---|---|
| `clm_segment_rules` | `doc_selections` (JSON contains `"KYC-003"`) | Segment Rules |
| `segment_doc_uploads` | `doc_code` | Segment Doc Uploads |

---

## 6. STATUS MODEL

`active` \| `inactive`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Usage check scope | The in-use lookup is **not** scoped by `client_id`. Codes restart per tenant, so another tenant's reference to *their* `KYC-001` can wrongly block your delete |
| Expiry | The catalogue value is descriptive free text; the real date lives on the upload |
| Delete | Hard delete, no restore |
| Status | `inactive` is stored but not filtered out of the DCP document picker |
| Field length | `authority` is capped at 2,000 characters — a practical limit of roughly 200 authority ids |

---

*Related documents: KYC_TECHNICAL_DOCUMENTATION.md · KYC_CODE_WALKTHROUGH.md · KYC_API_DOCUMENTATION.md*
