# AGREEMENTS — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Agreements**
> Route `/clm/agreements`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Agreements master** holds the contract templates a business sends to its counterparties — NDAs, distribution agreements, supply agreements, quality agreements, agency agreements, indemnity undertakings. Where a *Trade Document* travels with a shipment, an **Agreement** governs the relationship.

The screen has two tabs:

| Tab | What it holds | Code |
|---|---|---|
| **Types** | The catalogue of agreement types — "Non-Disclosure Agreement", "Supply Agreement" | `AT-NNN` |
| **Library** | The actual templates — title, purpose, applicable party, regulatory tier, segment, body content, header/footer, signing flag | `A-NNN` |

Agreements are also the **only** document master with a lead-aware endpoint: given a Sales Matrix opportunity, the system walks its products → segments → matching agreements and tells the salesperson exactly which contracts apply to that deal.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Contracts, not forms | Governs the commercial relationship rather than an individual shipment |
| Tier-matched | A highly-regulated segment pulls only highly-regulated agreements |
| Deal-aware | The Sales Matrix shows exactly which agreements apply to an opportunity, with live send status |
| Required vs optional | Highly-regulated agreements render as **REQ**, less-regulated as **OPT** |
| Word + PDF round-trip | Draft in the editor, export to Word, edit, upload back |
| Stricter legal lock | An agreement locks as soon as it is **sent**, not merely once signed |

### 1.3 Key features
- Two-tab master (Types + Library) with per-branch codes.
- Multi-stage agreement wizard (`ClmAgreementWizardModal`).
- Rich-text body with clause insertion, table insertion and placeholder tokens.
- Header/footer page-shell configuration.
- **Download DOCX** · **Download PDF** · **Upload DOCX** · **Header-logo upload**.
- **`signing`** flag — whether the agreement requires e-signature at all.
- **`applicableForLead`** — the Sales Matrix "Segment Details" feed.
- Dual locks: `is_signed` (completed) and **`in_use`** (sent at least once).

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All types and templates, all tenants |
| Client Admin / Client User | The client's rows + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only**; may view shared client-level agreements but not edit them |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.agreements`.

---

## 3. BUSINESS PROCESS FLOW

```
   TAB 1 — TYPES
     Add "Supply Agreement" + description  → AT-002
        │
        ▼
   TAB 2 — LIBRARY (the templates)
     ├─ agreement_type  (picked from the Types catalogue — stored as the NAME)
     ├─ title           the contract heading
     ├─ purpose         what it governs
     ├─ party           CSV: Buyer / Consignee / Supplier-Material / …
     ├─ regulatory      highly | less     ← must MATCH the segment's tier to apply
     ├─ signing         true = requires e-signature
     ├─ segment         CSV — which segments this contract governs
     ├─ agr_status      Active | …        ← only Active agreements are offered
     ├─ content         rich-text body (or upload a .docx)
     └─ header/footer   page-shell config
        │
        ▼  code A-NNN allocated (restarts at 001 per branch)
   Template saved
        │
        ├─→ Download DOCX / PDF · Upload a revised .docx
        │
        ├─→ SALES MATRIX — lead detail "Segment Details" card
        │     lead → latest non-cancelled PI (else Quotation) → line items →
        │     products → segment_id → segments → matching agreements
        │     each row shows REQ/OPT + live signature status + Remind + downloads
        │
        └─→ Send for Signature (Zoho) — up to 10 agreements in one request
        │
        ▼  the FIRST time it is sent
   in_use = true  → EDIT and DELETE blocked (422)
        ▼  once fully signed
   is_signed = true
```

### 3.1 Why agreements lock earlier than trade documents
| Master | Locks when | Reason |
|---|---|---|
| Trade Document | a signature request reaches **`completed`** | The signed copy is a legal record |
| **Agreement** | a signature request reaches **`inprogress` OR `completed`** | Editing a contract that is already sitting in a counterparty's inbox would silently diverge the master from what they were asked to sign |

The message is deliberately plain: *"This agreement is In-use, you cannot edit it."*

### 3.2 How an agreement is matched to a deal
Two conditions must both hold:
1. **Regulatory tier matches** — `agreement.regulatory === segment.regulatory_status`.
2. **Segment matches** — the agreement's `segment` CSV contains the segment's **name or code** as a whole entry.

The CSV match wraps the needle in comma separators (`'Tobacco,%'`, `'%, Tobacco'`, `'%, Tobacco,%'`, …) so `Tobacco` never accidentally matches `Tobacco Stripping`.

Agreements naming only supplier or other parties are excluded from the Sales Matrix view — that side only ever deals with the buyer and consignee. A **blank** party stays universal (applicable to both), preserving the old permissive behaviour for unclassified rows.

### 3.3 REQ vs OPT
| Tier | Label on the lead |
|---|---|
| `highly` | **REQ** — required |
| `less` | **OPT** — optional |

---

## 4. SCREEN SPECIFICATION (`ClmAgreementsPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **Types** · **Library** |
| Types table | CODE · TYPE NAME · DESCRIPTION · IN USE · ACTIONS |
| Library table | CODE · AGREEMENT TYPE · TITLE · **APPLICABLE PARTY** · REGULATORY · SEGMENT · STATUS · ACTIONS |
| Applicable-party labels | Stored values are mapped to friendly labels for display — `Buyer → Customer`, `Supplier-Material → Material`, `Supplier-Strategic Risk → Strategic Risk`, etc. Unknown values pass through unchanged |
| Library actions | Edit · Delete · Download Word · Download PDF · Upload Word — Edit/Delete disabled when `in_use` |
| Wizard | `ClmAgreementWizardModal` — details → page shell → body editor |
| Ordering | `id ASC` |
| Pager | Shared `WorklistPager` |

> The label mapping exists because the wizard stores the internal value set (`Buyer`, `Supplier-Material`) while users think in terms of *Customer* and *Material*.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | An agreement-type **name** is unique within your scope (case-insensitive) |
| 2 | Agreement type `description` is **required** |
| 3 | `AT-NNN` and `A-NNN` restart at 001 per branch |
| 4 | Library `regulatory` defaults to `less`; `signing` defaults to **true**; `agr_status` defaults to `Active` |
| 5 | An agreement **locks against edit and delete** once it has been **sent** at least once (`inprogress` or `completed`) |
| 6 | Editing the body content **drops the previously uploaded Word file** so downloads regenerate from the edited HTML |
| 7 | Content over **1,000,000 characters** cannot be rendered to PDF or Word — a clean 422 is returned |
| 8 | Only `.doc`/`.docx` uploads are accepted, max 20 MB |
| 9 | On a lead, an agreement applies only when **both** its tier and its segment match, **and** `agr_status = 'Active'` |
| 10 | The lead view excludes supplier-only agreements; a blank `party` is treated as universal |
| 11 | Branch users may view shared client-level agreements but not edit them |

---

## 6. STATUS MODEL

- `agr_status` — `Active` by default; only Active agreements are offered on a lead.
- `status` — the generic master lifecycle column.
- **`in_use`** (derived) — sent at least once; blocks edit and delete.
- **`is_signed`** (derived) — fully signed; a subset of `in_use`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Type link is by **name** | Library rows store the type as a string, not an id |
| Segment link is by **CSV string** | Matching is done with LIKE patterns; a segment rename is not cascaded into the agreement library |
| No versioning | Editing a template overwrites it — but since it locks on first send, in practice the sent version is preserved by the signature record rather than by version history |
| Lead source | Segment Details reads the **latest non-cancelled PI**, falling back to the latest non-cancelled Quotation; leads with neither show nothing |
| Stage gate | The lead's Send button stays disabled until Stage 5 (Quotation vs PI) is complete (`lead_stage_id >= 6`) |
| Render ceiling | ~1 MB of HTML |
| `.doc` files | Binary Word 97-2003 files cannot be read |

---

*Related documents: AGREEMENTS_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_CODE_WALKTHROUGH.md · AGREEMENTS_API_DOCUMENTATION.md*
