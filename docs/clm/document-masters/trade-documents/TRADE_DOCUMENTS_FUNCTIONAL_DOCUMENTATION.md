# TRADE DOCUMENTS — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Trade Documents**
> Route `/clm/trade-documents`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**Trade Documents** are the papers that travel with a shipment — declarations, undertakings, packing declarations, non-GMO statements, origin declarations, letters of indemnity. Unlike KYC/DD/QC/Trade-Licence entries (which are *catalogue items the counterparty produces*), a trade document is a **document you author and send** — drafted in a rich-text editor, wrapped in a branded page shell, and dispatched for e-signature via Zoho Sign.

The screen has two tabs:

| Tab | What it holds | Code |
|---|---|---|
| **Names** | The lightweight catalogue of document *types* — "Non-GMO Declaration", "Packing Declaration" | `TDN-NNN` |
| **Library** | The actual drafts — title, type, purpose, applicable party, segment, body content, header/footer | `TDL-NNN` |

A library draft picks its type by **name** from the Names catalogue, which is why a name in use cannot be renamed or deleted.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Author once, send many times | One draft serves every customer/consignee in its segment |
| Branded output | Header/footer page shell (logo, title, confidentiality, page numbers) applied to both PDF and Word |
| Word round-trip | Download as `.docx`, edit in Word, upload back — the editor stays in sync |
| Placeholder merge | `{{customer.*}}`, `{{consignee.*}}`, `{{product.*}}` resolve at send time |
| Legally safe | Once a draft comes back signed it locks against edit and delete |
| Party-aware | The applicable-party CSV drives which drafts surface for a buyer, consignee or supplier |

### 1.3 Key features
- Two-tab master (Names + Library) with per-branch codes.
- Rich-text body editor with insert-table, insert-placeholder and clause-insert panels.
- Header/footer configuration panel (shared with HR document templates).
- **Download DOCX** · **Download PDF** · **Upload DOCX**.
- Standalone **DOCX → HTML** conversion for editors with no saved row.
- Header-logo upload.
- **Party filter** endpoint used by the customer / consignee / supplier forms.
- Signed-draft lock (`is_signed`).

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All names and drafts, all tenants |
| Client Admin / Client User | The client's rows + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only**; may view shared client-level drafts but not edit them |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.trade_documents`.

---

## 3. BUSINESS PROCESS FLOW

```
   TAB 1 — NAMES (the catalogue)
     Add "Non-GMO Declaration"  → TDN-003
        │  (rename/delete blocked once any library draft uses this name)
        ▼
   TAB 2 — LIBRARY (the drafts)
     Stage 1 — details
       ├─ name        (picked from the Names catalogue — stored as the NAME string)
       ├─ title       the heading printed on the document
       ├─ doc_type    free-form classification
       ├─ purpose     what the document is for
       ├─ party       CSV: Buyer / Consignee / Supplier-Material / …
       ├─ regulatory  highly | less
       └─ segment     CSV — mandatory, at least one
     Stage 2 — page shell
       ├─ header_config   logo, title, confidentiality line
       └─ footer_config   footer text, page numbers
     Body — rich-text content (or upload a .docx)
        │
        ▼  code TDL-NNN allocated (restarts at 001 per branch)
   Draft saved
        │
        ├─→ Download DOCX / PDF  (page shell applied)
        ├─→ Upload a revised .docx  → content refreshed from its HTML
        ├─→ Customer / Consignee / Supplier form: /for-party/{party} lists applicable drafts
        └─→ Send for Signature (Zoho) — up to 10 drafts in one request
        │
        ▼  a signature request reaches `completed`
   is_signed = true  → EDIT and DELETE are blocked (422)
```

### 3.1 Applicable party
`party` is a CSV drawn from the wizard's value set: `Buyer`, `Consignee`, `Supplier-Material`, `Supplier-Logistic`, `Supplier-Tech`, `Supplier-Advisory`, `Supplier-Strategic Risk`.

The `/for-party/{party}` endpoint maps three logical buckets:

| Request | Matches |
|---|---|
| `buyer` or `customer` | any party containing `Buyer` |
| `consignee` | any party containing `Consignee` |
| `supplier` | **any** `Supplier-*` sub-type |
| anything else | literal substring match (so a specific sub-type can be requested) |

### 3.2 Why the signed lock exists
A trade document that has come back signed via Zoho is a **legal record**. Editing the master afterwards would silently diverge it from the copy the customer or consignee actually signed. The lock is therefore a 422, not a warning.

> Trade documents lock on **signed** only. Agreements are stricter — they lock as soon as they are **sent**.

---

## 4. SCREEN SPECIFICATION (`ClmTradeDocumentsPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **Names** · **Library** |
| Names table | CODE · DOCUMENT TYPE NAME · IN USE (count) · ACTIONS — Edit/Delete disabled while `in_use > 0` |
| Library table | CODE · NAME · TITLE · TYPE · APPLICABLE PARTY · SEGMENT · STATUS · ACTIONS |
| Library actions | Edit · Delete · Download Word · Download PDF · Upload Word — Edit/Delete disabled when `is_signed` |
| Draft editor | `ClmTradeDocumentDraftPage` / `ClmTradeDocumentDraftModal` with `ClmRichTextToolbar`, `ClmInsertTableModal`, `ClmInsertPlaceholderModal`, `ClmClauseInsertPanel` |
| Ordering | **Newest first** (`id DESC`) on both tabs |
| Pager | Shared `WorklistPager` |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | A document-type **name** is unique within your scope (case-insensitive, whitespace-trimmed) |
| 2 | The dedupe + insert both run under the per-client lock, so two concurrent "Add" clicks cannot slip a duplicate through |
| 3 | A name **cannot be renamed or deleted** while any library draft references it (409) |
| 4 | Library `segment` is **mandatory** (at least one) |
| 5 | `TDN-NNN` and `TDL-NNN` restart at 001 per branch |
| 6 | Legacy `TD-` library codes were renamed to `TDL-` by migration, so the sequence stays continuous |
| 7 | A draft **locks against edit and delete** once a signature request for it reaches `completed` |
| 8 | Editing the body content **drops the previously uploaded Word file** so downloads regenerate from the edited HTML |
| 9 | Content over **1,000,000 characters** cannot be rendered to PDF or Word — a clean 422 is returned |
| 10 | Only `.doc`/`.docx` uploads are accepted, max 20 MB; binary `.doc` cannot be converted |
| 11 | An upload whose conversion yields no readable text is rejected and the stored file deleted |
| 12 | Branch users may view shared client-level drafts but not edit them |

---

## 6. STATUS MODEL

Library rows carry `status` (`active` by default). The operationally meaningful flag is **`is_signed`**, derived from `clm_signature_requests` rather than stored on the row.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Type link is by **name** | Library drafts store the type as a string, not an id — hence the rename/delete lock rather than a cascade |
| `for-party` scope | The party filter is **client-scoped only**, not branch-scoped like the main list |
| Render ceiling | ~1 MB of HTML; longer documents must be split |
| `.doc` files | Binary Word 97-2003 files cannot be read — the user is told to "Save As .docx" |
| DOCX fidelity | Complex Word formatting may not survive the HTML round-trip; the uploaded file is preferred on download precisely for that reason |
| Lock timing | The lock triggers on **completed**, so a draft can still be edited while a signature is in flight — which desyncs what was already sent |
| No versioning | Editing a draft overwrites it; there is no version history (unlike CTC contracts) |

---

*Related documents: TRADE_DOCUMENTS_TECHNICAL_DOCUMENTATION.md · TRADE_DOCUMENTS_CODE_WALKTHROUGH.md · TRADE_DOCUMENTS_API_DOCUMENTATION.md*
