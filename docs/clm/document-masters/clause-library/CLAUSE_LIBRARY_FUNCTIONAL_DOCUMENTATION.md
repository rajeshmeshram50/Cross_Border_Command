# CLAUSE LIBRARY — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Clause Library**
> Route `/clm/clause-library`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Clause Library** is the reusable building-block store for contract drafting. Instead of retyping a force-majeure, arbitration, confidentiality or limitation-of-liability paragraph into every agreement, a legal user writes it once here and **inserts** it into any draft.

The screen has two tabs:

| Tab | What it holds | Code |
|---|---|---|
| **Clause Types** | The classification — Confidentiality, Payment, Termination, Dispute Resolution, Force Majeure | `CLT-NNN` |
| **Clause Library** | The clauses themselves — name + rich-text body | `CL-NNN` |

Clauses are **copied**, not linked. When inserted into an agreement, trade document or Case-to-Case draft, the clause's text is pasted into the document body as an `<h3>Name</h3>` heading followed by its content. Editing the library clause afterwards does **not** retroactively change documents that already used it — which is exactly what a legal team wants, but it means "is this clause in use?" has to be answered by searching document text.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Write once, reuse everywhere | One approved paragraph, used across every contract |
| Consistent wording | Legal language does not drift between drafts |
| Typed for retrieval | Clause types make a long library navigable |
| Snapshot semantics | A signed contract keeps the wording it was signed with |
| Safe deletes | A clause already inserted into a Case-to-Case agreement cannot be deleted |

### 1.3 Key features
- Two-tab master with per-branch codes.
- Rich-text clause body.
- **In-use lock on clause types** — a type referenced by any clause cannot be edited or deleted.
- **In-use detection on clauses** — best-effort text search across every CTC contract's current draft *and* every saved version.
- `ClmClauseInsertPanel` — the insert widget shared by the agreement, trade-document and CTC editors.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All types and clauses, all tenants |
| Client Admin / Client User | The client's rows + globals; Branch Switcher narrows |
| Branch User | Globals + client-level + **own branch only**; may view shared client-level clauses but not edit them |
| Employee | Reads the whole branch; edits/deletes only rows they created |

Menu slug: `clm.clause_library`.

---

## 3. BUSINESS PROCESS FLOW

```
   TAB 1 — CLAUSE TYPES
     Add "Force Majeure"  → CLT-004
        │  (the library links to a type by NAME, so a type in use is
        │   locked against BOTH edit and delete)
        ▼
   TAB 2 — CLAUSE LIBRARY
     ├─ clause_type    (picked from the Types tab — stored as the NAME)
     ├─ name           unique within your branch
     ├─ party          optional
     ├─ clause_status  Active by default
     └─ content        the rich-text paragraph
        │
        ▼  code CL-NNN allocated (restarts at 001 per branch)
   Clause saved
        │
        ▼  INSERTION (ClmClauseInsertPanel)
   Agreement / Trade Document / CTC draft editor
        → pastes  <h3>Clause Name</h3> + content  into the document body
        → the clause is now a COPY; later library edits do not propagate
        │
        ▼  usage detection
   Every CTC contract's `content` + every saved `versions[].content`
   is searched for the literal heading <h3>Clause Name</h3>
        → in_use flag on the list
        → DELETE blocked with 409
```

### 3.1 Why usage detection is a text search
There is no foreign key from a document back to a clause — the clause is **copied in**. The only reliable trace is the heading the insert panel writes. So `in_use` is computed by lower-casing every CTC contract's current content and each saved version, and looking for `<h3>clause name</h3>`.

This is explicitly **best-effort**:
- It covers Case-to-Case contracts only, not agreements or trade documents.
- Renaming a clause changes the needle, so a clause that *was* inserted under its old name stops registering as in use.
- A clause whose heading was edited inside the document also stops matching.

### 3.2 Clause types are locked harder than clauses
| Object | Edit | Delete |
|---|---|---|
| **Clause type** | **Blocked (409)** while any clause references it | Allowed (no guard) |
| **Clause** | Allowed | **Blocked (409)** when found in a CTC agreement |

The type edit lock exists because the library stores the type as a **name string** — renaming would orphan every clause pointing at it.

---

## 4. SCREEN SPECIFICATION (`ClmClauseLibraryPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **Clause Types** · **Clause Library** |
| Types table | CODE · TYPE NAME · DESCRIPTION · IN USE (count) · ACTIONS — Edit disabled while `in_use > 0` |
| Library table | CODE · CLAUSE TYPE · CLAUSE NAME · PARTY · STATUS · ACTIONS — Delete disabled when `in_use` |
| Add/Edit clause modal | Clause Type, Clause Name, Content (party and status are optional/legacy) |
| Insert panel | `ClmClauseInsertPanel` — mounted inside the agreement, trade-document and CTC editors |
| Ordering | `id ASC` on both tabs |
| Pager | Shared `WorklistPager` |

> The redesigned modals collect fewer fields than the original: a clause type now needs only a **name** (description is optional), and a clause needs only **type + name + content** (party is optional). Older payloads carrying the extra fields still work.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Clause-type name is unique **within your visibility scope**, case-insensitive |
| 2 | Clause name is unique **within your visibility scope**, case-insensitive |
| 3 | `CLT-NNN` and `CL-NNN` restart at 001 per branch |
| 4 | A clause type **cannot be edited** while any clause in the library references it (409) |
| 5 | A clause **cannot be deleted** once its heading is found in any CTC contract (409) |
| 6 | Type-usage counting is case-insensitive and scoped to what the caller can see |
| 7 | `clause_status` defaults to `Active` |
| 8 | Clause `description` and `party` are optional — the redesigned modals no longer collect them |
| 9 | Branch users may view shared client-level clauses but not edit them |
| 10 | Employees may only edit or delete rows they created themselves |

---

## 6. STATUS MODEL

- `clause_status` — `Active` by default (a free string).
- `status` — the generic master lifecycle column.
- **`in_use`** (derived) — on types, a **count** of referencing clauses; on clauses, a 0/1 flag from the CTC text search.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Usage detection is a **text search** | Only Case-to-Case contracts are searched — agreements and trade documents are not; a renamed clause stops matching its old insertions |
| Clause type delete | Has **no** guard, even though edit does — a type can be deleted while clauses reference its name |
| Type link by name | No foreign key; renaming is therefore blocked rather than cascaded |
| Clauses are copies | Editing a library clause never updates documents that already contain it (by design) |
| Type-update clash check | The rename-collision check is client-wide rather than scope-relative, so it is stricter than the create-time check |
| No versioning | Editing a clause overwrites it |

---

*Related documents: CLAUSE_LIBRARY_TECHNICAL_DOCUMENTATION.md · CLAUSE_LIBRARY_CODE_WALKTHROUGH.md · CLAUSE_LIBRARY_API_DOCUMENTATION.md*
