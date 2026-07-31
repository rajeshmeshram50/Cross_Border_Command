# DOCUMENT CONTROL PANEL (DCP) — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Document Control Panel**
> Route `/clm/document-panel`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Document Control Panel** is the rule engine at the centre of CLM. Everything else in the module is either an input to it (the segment and document catalogues) or a consumer of it (party onboarding, the Evidence Vault, the compliance scorecards, the Regulatory Defense File).

A **Segment Rule** answers one question:

> *For this business segment, trading **domestically** or **internationally**, exactly which KYC, Due-Diligence, Trade-Licence and Quality documents must a counterparty produce — and which of them are mandatory?*

One rule = one `(segment × domestic|international)` pair. Inside it, every selected document from the four catalogues is tagged **M (Mandatory)** or **O (Optional)**.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Compliance is configured, not coded | A compliance officer defines the document set; no developer involvement |
| Domestic ≠ export | One segment carries two independent document sets, so an India-domestic buyer isn't asked for export paperwork |
| Mandatory is enforceable | Missing **M** documents gate downstream Sales/P2P actions; **O** documents are informational |
| One rule, every party | The same rule drives customers, consignees and suppliers in that segment |
| Counts at a glance | Mandatory/optional totals are denormalised onto the rule row so the list renders without re-parsing JSON |

### 1.3 Key features
- Rule list with **All / Highly Regulated / Less Regulated** tab counts.
- Two-stage Add/Edit modal — Stage 1 selects the segment, tier, trade type and authorities; Stage 2 ticks documents M/O across four categories.
- A **single bootstrap call** loads every master the modal needs.
- Inline creation of a missing KYC / DD / QC / Trade-Licence document without leaving the panel.
- Per-rule authority chips and M/O badges.
- Filter modal with an active-filter count.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rules, all tenants |
| Client Admin / Client User | The client's rules + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rules they created |

Menu slug: `clm.document_panel`.

---

## 3. BUSINESS PROCESS FLOW

```
   PREREQUISITES
     Segment master        → the trade lines
     Authority master      → the issuing bodies
     KYC / DD / TL / QC    → the document catalogues
        │
        ▼
   ┌──────────────────── ADD RULE — STAGE 1 ────────────────────┐
   │  SELECT SEGMENT      (branch-scoped dropdown)               │
   │  REGULATORY STATUS   highly | less                          │
   │  DOCUMENT TYPE       ● Domestic   ○ International  (REQUIRED)│
   │  AUTHORITIES         auto-mapped / picked → auths_json      │
   └────────────────────────────┬───────────────────────────────┘
                                 ▼
   ┌──────────────────── ADD RULE — STAGE 2 ────────────────────┐
   │  KYC   □ KYC-001 [M|O]  □ KYC-003 [M|O]  …                 │
   │  DD    □ DD-002  [M|O]  …                                   │
   │  TL    □ TL-001  [M|O]  …                                   │
   │  QC    □ QC-003  [M|O]  …                                   │
   │  (missing document? add it inline — the modals are reused)  │
   └────────────────────────────┬───────────────────────────────┘
                                 ▼
   Save → rule_code SR-NNN allocated, M/O counts denormalised,
          picker cache bumped
        │
        ├─→ Segment now appears in the Customer / Consignee / Vendor
        │   segment dropdown (only segments with ≥1 document are offered)
        │
        ├─→ Party form Stage 2 renders the required-document checklist
        │
        ├─→ Evidence Vault tracks uploaded-vs-required per party
        │
        └─→ Buyer / Supplier Profile + Regulatory Defense File report X of Y
```

### 3.1 Domestic vs International
`document_type` is **mandatory** on every rule. A segment may hold **one domestic rule and one international rule**, each with a completely different document set — a domestic buyer is never asked for an IEC, an export buyer is.

Which rule applies to a party is decided by the party's country: India ⇒ `domestic`, anything else ⇒ `international`. When only one of the two rules exists, consumers fall back to whichever one is configured, so legacy single-type setups keep working.

Attempting to create a second rule of the same type for the same segment returns **409** naming the existing rule.

### 3.2 Mandatory vs Optional
| Tag | Meaning |
|---|---|
| **M** | The party cannot be considered compliant without it — missing M documents block downstream actions |
| **O** | Recommended; tracked and reported but not blocking |

Counts are rolled up at save time into `mandatory_count` and `optional_count` so the list can render badges without re-parsing the JSON on every row.

### 3.3 Trade Documents were removed
The panel originally had a fifth category, **td (Trade Documents)**. It was removed in June 2026: trade documents are now matched to a segment by the `segment` field on the trade-document library row itself, not by a DCP rule. The server strips any `td` key still sent by an older client.

---

## 4. SCREEN SPECIFICATION (`ClmDcpPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **All** · **Highly Regulated** · **Less Regulated** with live counts |
| Search | Client-side across rule code, segment code and segment name |
| Filter modal | `ClmDcpFilterModal` — additional narrowing with an active-filter count badge |
| Table | RULE CODE · SEGMENT · REGULATORY STATUS · DOCUMENT TYPE (Domestic/International) · AUTHORITIES (chips) · MANDATORY count · OPTIONAL count · ACTIONS |
| Authorities column | `AuthorityBadges` — first authority + "+N" popover, counted from the **array** form so comma-bearing names don't over-count |
| Ordering | **Newest first** (`id DESC`) so a freshly added rule tops the list |
| Add/Edit modal | Two stages as above; Stage 2 embeds `KycModal`, `DdModal`, `QcModal` and `TlModal` for inline document creation |
| Pager | Shared `WorklistPager` |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | One rule per **(segment, document_type)** — a duplicate returns **409** naming the existing rule |
| 2 | `document_type` (`domestic` \| `international`) is **required** on create and edit |
| 3 | `regulatory_status` (`highly` \| `less`) is required |
| 4 | `doc_selections` is required; each category maps a document **code** to `"M"` or `"O"` |
| 5 | The `td` category is stripped on write and never persisted |
| 6 | `mandatory_count` / `optional_count` are recomputed on every save |
| 7 | `rule_code` (`SR-NNN`) is immutable — and, unusually, **allocated client-wide**, not per branch |
| 8 | `segment_code` is snapshotted alongside `segment_id` so the rule survives a segment reference change |
| 9 | Every create / update / delete bumps the cached master bundle |
| 10 | A segment appears in the party segment pickers only when its rule holds **≥ 1 document** |
| 11 | Employees may only edit or delete rules they created themselves |

---

## 6. STATUS MODEL

Rules have a `status` column defaulting to `active`, but the panel does not expose a lifecycle toggle — a rule is either configured or deleted. The meaningful axes are `regulatory_status` (tier) and `document_type` (trade type).

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Rule codes | `SR-NNN` is allocated **client-wide**, unlike every other CLM code which restarts per branch — two branches of one client share the sequence |
| Trade Documents | No longer configurable here; they match by segment on the library row instead |
| No versioning | Editing a rule changes it in place; there is no history of what was required before |
| Silent picker effect | Emptying a rule's document list removes its segment from the party pickers, with no warning at save time |
| Delete | Hard delete; parties already onboarded under the rule keep their uploads but lose the checklist |
| `for-segment` fallback | When only one `document_type` rule exists, consumers silently fall back to it — convenient, but it can mask a missing domestic/international configuration |

---

*Related documents: DOCUMENT_CONTROL_PANEL_TECHNICAL_DOCUMENTATION.md · DOCUMENT_CONTROL_PANEL_CODE_WALKTHROUGH.md · DOCUMENT_CONTROL_PANEL_API_DOCUMENTATION.md*
