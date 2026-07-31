# TERMS & CONDITIONS — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Terms & Conditions**
> Route `/clm/terms-conditions`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **T&C library** holds the standard terms printed on each kind of commercial document. When a Quotation, Proforma Invoice, Purchase Order, Debit Note or Credit Note is generated, its terms block comes from here — chosen by **(segment, document category)**.

The screen has two tabs:

| Tab | What it holds | Code |
|---|---|---|
| **Document Categories** | The kinds of document terms can attach to — Quotation, Proforma Invoice, Purchase Order, Debit Note, Credit Note | `DC-NNN` |
| **T&C Library** | The actual terms text, scoped to a segment set + category | `TNC-NNN` |

The four standard categories ship as **global** rows (`client_id` NULL) visible to every tenant; a client's own custom categories are merged on top.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Right terms, right paper | Each document category carries its own terms |
| Segment-aware | A highly-regulated segment can print stricter terms than a general one |
| One entry per combination | The uniqueness rule prevents two competing T&C blocks for the same segment + category |
| Ships with sane defaults | The standard categories are pre-seeded globally |
| Note documents simplified | Debit/Credit Notes carry no segment, regulatory tier or party at all |

### 1.3 Key features
- Two-tab master with per-branch codes.
- Global + client-level + branch categories merged in one list.
- Rich-text terms content.
- **One entry per (segment, category)** — enforced by set-overlap, not string equality.
- Special handling for Debit Note / Credit Note categories.
- Multi-segment scoping via a CSV (one segment for `highly`, many for `less`).

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All categories and entries, all tenants |
| Client Admin / Client User | Globals + the client's rows; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only** |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.terms_conditions`.

---

## 3. BUSINESS PROCESS FLOW

```
   TAB 1 — DOCUMENT CATEGORIES
     Seeded globally (client_id NULL):
       Quotation · Proforma Invoice · Purchase Order · Debit Note · Credit Note
     Add your own → DC-NNN (branch-owned)
        │
        ▼
   TAB 2 — T&C LIBRARY
     ├─ category    (picked from the categories tab)
     ├─ segment     CSV — ONE segment for "highly", MANY for "less"
     ├─ regulatory  highly | less
     ├─ party       who the terms address
     └─ content     the rich-text terms block
        │
        │  ── if the category is Debit Note or Credit Note ──
        │     segment / regulatory / party are FORCED BLANK
        │     (they render as "—" in the list)
        │
        ▼  uniqueness check: any SAME-CATEGORY row whose segment set
           OVERLAPS the incoming one is a duplicate → 422
        │
        ▼  code TNC-NNN allocated (restarts at 001 per branch)
   Entry saved
        │
        └─→ printed on the matching Quotation / PI / PO / Note PDF
```

### 3.1 The uniqueness rule (CBC #18)
> **One Terms & Conditions entry per (segment, document category) within a branch.**

Because a single row may scope **many** segments (a CSV, used for `less`-regulated terms), the check is not a string comparison. Both the incoming and each existing same-category row's segment CSV are normalised to a set of lower-cased tokens, and **any overlap** counts as a duplicate.

So if `"Rice, Wheat"` already has a *Quotation* entry, saving `"Wheat, Barley"` for *Quotation* is rejected — `Wheat` overlaps.

### 3.2 Note documents are different
Debit Notes and Credit Notes carry **no** segment, regulatory tier or party. Those fields are forced to empty strings server-side (matched by category name) and render as "—" in the list. The uniqueness rule is skipped for them entirely, so a tenant may hold exactly one Debit Note entry and one Credit Note entry without segment scoping.

> The blanking is done with **empty strings, not nulls** — Laravel's `ConvertEmptyStringsToNull` middleware turns the frontend's `''` into `null`, which would then hit the `?? 'General'` / `?? 'highly'` fallbacks and wrongly backfill values.

---

## 4. SCREEN SPECIFICATION (`ClmTncPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **Document Categories** · **T&C Library** |
| Categories table | CODE · SHORT CODE · CATEGORY NAME · ACTIONS |
| Library table | CODE · SEGMENT · REGULATORY · DOCUMENT CATEGORY · PARTY · ACTIONS — note rows show "—" for the blanked fields |
| Wizard | `ClmTncWizardModal` — category → segments → content |
| Ordering | `id ASC` on both tabs |
| Pager | Shared `WorklistPager` |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | The four standard categories are **global** (`client_id` NULL) and visible to every tenant |
| 2 | Category `short_code` is upper-cased on save |
| 3 | `DC-NNN` and `TNC-NNN` restart at 001 per branch |
| 4 | **One T&C entry per (segment, category) within a branch** — overlap of the segment sets is a duplicate (422) |
| 5 | Debit Note / Credit Note entries carry **no** segment, regulatory tier or party — forced blank server-side |
| 6 | Note-category entries are exempt from the uniqueness rule |
| 7 | `segment` is a CSV — one entry for `highly`, several for `less` |
| 8 | `segment` defaults to `General` and `regulatory` to `highly` when omitted (but **not** for note categories) |
| 9 | Sibling branches may hold their own entry for the same (segment, category) combination |
| 10 | Employees may only edit or delete rows they created themselves |

---

## 6. STATUS MODEL

Rows carry a generic `status` column; the panel does not expose a lifecycle toggle. The meaningful axes are `category`, `segment` and `regulatory`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Note detection by **name** | Debit/Credit Note handling is triggered by matching the literal category names — renaming those categories breaks the special handling |
| Category link is by **name** | Library rows store the category as a string, not an id; there is no in-use lock on categories |
| No delete guard | A category can be deleted while T&C entries reference it |
| Segment link is by **name** | Matching is string-based and not cascaded on a segment rename |
| Uniqueness is per branch | Two branches of one client may each define terms for the same (segment, category) — intentional, but easy to miss |
| No versioning | Editing an entry overwrites it; there is no history of the terms previously printed |

---

*Related documents: TERMS_CONDITIONS_TECHNICAL_DOCUMENTATION.md · TERMS_CONDITIONS_CODE_WALKTHROUGH.md · TERMS_CONDITIONS_API_DOCUMENTATION.md*
