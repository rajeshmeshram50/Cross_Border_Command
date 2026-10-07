# Documentation Guide

How module documentation is written in this repo, so the next set matches the
last one. Read this before writing a new document.

---

## 1. The four-document convention

Every documented module gets **four** markdown files, plus **one flow document**
per group of related modules.

| Document | Answers | Written for |
|---|---|---|
| **API** | *What can I call, with what, and what comes back?* | Integrators, QA writing API tests, anyone with Postman |
| **Functional** | *What does this do, and what are the rules?* | QA, BA, support, anyone who needs to know the behaviour without the code |
| **Technical** | *How is it built, and why that way?* | Developers joining the module; whoever has to change it |
| **Code Walkthrough** | *Where is it, and what happens on each request?* | A developer with the file open, debugging |
| **Flow** *(one per module group)* | *Why are these separate modules, and how do they hand off?* | Everyone — read first |

### Where the files go — this is not optional

The app has an in-app **Documentation Guide** (`Topbar → Documentation Guide`,
`/documentation`). It is served by `DocsGuideController`, which walks `docs/`
and collects **folders that hold a doc set**:

```
docs/<group>/<entity>/<ENTITY>_FUNCTIONAL_DOCUMENTATION.md
docs/<group>/<entity>/<ENTITY>_TECHNICAL_DOCUMENTATION.md
docs/<group>/<entity>/<ENTITY>_API_DOCUMENTATION.md
docs/<group>/<entity>/<ENTITY>_CODE_WALKTHROUGH.md
```

A group with only one entity may put its four files directly in
`docs/<group>/` — `docs/payment/` and `docs/clm/` both do.

> **Loose markdown at the `docs/` root is ignored.** A document written there
> exists on disk and is invisible in the app. This has already happened once:
> an entire P2P set was written flat and did not appear in the guide until it
> was moved into `docs/p2p/<entity>/`.

The controller matches on the **suffix**, so the prefix is free — but keep it
the entity's name in upper snake case so the file is identifiable on its own.

### Registering a new group

Two constants in `app/Http/Controllers/Api/DocsGuideController.php`:

```php
private const GROUP_LABELS = [ …, 'p2p' => 'Procure to Pay (P2P)' ];
private const GROUP_ORDER  = [ …, 'permission', 'p2p', 'integrations' ];
```

Without the label the group still appears, titleized — `p2p` becomes "P2p".
Without the order entry it falls to the end, alphabetically.

### The flow document

The guide has exactly four tabs, so a flow document has no slot. Put it at
`docs/<group>/README.md`, as `docs/clm/` does. It will not show in the app —
it is for the repo.

### The older flat style

`BIOMETRIC_*.md` at the docs root predates the folder convention. **Do not copy
it.** Its `.docx` exports sit beside it in title case
(`Biometric_API_Documentation.docx`) — the markdown is the source, the Word
file is an export.

---

## 2. What goes in each document

### API

- Base URL, auth, the response envelope, and the status codes actually used
- **Every** route, grouped by purpose, not alphabetically
- Request fields in a table: name, rule, and what the rule produces when it fails
- **Error messages quoted verbatim** — the reader will meet these strings, not paraphrases
- A `curl` section at the end that runs end to end in order

### Functional

- One opening paragraph that a non-developer can read
- Where it lives: menu path, URL, screen names
- **The form, field by field** — what the operator sees, which are required, which dropdown comes from which master
- Business rules in plain language
- A **"business rules QA should never see broken"** list — numbered, each one testable
- Roles and access
- Statuses and what each means on screen

### Technical

- Stack and an architecture diagram
- **Data model with real column lists**, taken from the live schema, not from memory
- Concurrency: every race, and the guard that closes it
- Multi-tenancy: how `client_id` / `branch_id` are resolved, and every place the scope is deliberately lifted *with the reason*
- The arithmetic, as code
- External coupling (Zoho, queues, files)
- **Where every field's data comes from** — endpoint and source table per dropdown
- What is derived server-side and never accepted from the client

### Code Walkthrough

- **The file map** — backend, frontend, routes
- Annotated request flows: the call, the guards in order, the transaction
- The key methods **quoted with their real comments**
- "Patterns you will see in this code" — the idioms and why they exist
- **A symptom → file table** at the end. This is the most used section; write it last, from the bugs you actually hit

### Flow

- Why these are separate modules
- The master diagram
- **Tab by tab** — each tab is its own flow: what it holds, how a row gets in, what you can do, how a row leaves
- The hand-offs between modules
- A table showing how the tabs line up across modules at each stage
- The rules that hold the whole thing together

---

## 3. Standards

### Verify everything against the code

Nothing goes in a document because it seems likely. Specifically:

| Claim | Check it against |
|---|---|
| A route exists | `routes/api.php` |
| A column exists | The live schema — `Schema::getColumnListing()` |
| A status or enum value | The model's constants |
| An error message | The controller, copied character for character |
| A screen name or step label | The component, not the ticket |
| Which frontend calls which backend | The actual `api.get/post` calls |

The last one has bitten this repo: there are **two Purchase Order screens on two
different backends**. Documenting one while pointing at the other's files is an
easy and invisible mistake.

### Quote the code's own comments

This codebase carries long explanatory comments, and most of them record a bug
that was fixed. When a rule looks arbitrary, the comment above it usually says
why. Quote it rather than paraphrasing — the original wording is evidence.

```php
/* A plain draft used to hold it too and nothing ever released it — drafts
   abandoned at Step 02 had taken a whole PI between them, so no further PO could
   be raised and the reason read "nothing left to order". */
```

### State the rule, then the reason

A rule without its reason gets "simplified away" by the next developer. One
sentence is enough:

> **A PO with money against it cannot be cancelled directly.** Without that rule
> a cancellation would silently write off cash already with the supplier.

### Say what is *not* true

Readers carry assumptions. Correct them explicitly:

- *"Step 05 is Payment Management. Physical inspection is a toggle on Step 01, not a step."*
- *"`submit` is `'yes'` / `'no'` — an enum, not a boolean."*
- *"The reservation is a quantity ledger, not a line lock."*
- *"Saving a payment DOES post to Zoho, if the bill already exists."*

### Mark what you could not verify

If something was not confirmed, say so in the document rather than writing it as
fact. A reader can act on "worth testing"; they cannot act on a confident
sentence that turns out to be wrong.

---

## 4. Formatting

| | |
|---|---|
| Tables | For anything with more than two parallel facts |
| ASCII diagrams | For flows and state machines — they survive copy-paste into Word |
| Code blocks | For real code and real messages only, never for prose |
| Bold | For the one fact in a paragraph that must not be missed |
| Headings | Numbered (`## 4.`, `### 4.1`), so sections can be cited in tickets |
| Line length | Wrap around 80 characters — diffs stay readable |

Keep heading numbers unique. When inserting a section between `4E` and `4F`,
renumber rather than creating a second `4F`.

---

## 5. The current sets

### HRMS Biometric — 4 documents

`BIOMETRIC_API_DOCUMENTATION` · `BIOMETRIC_FUNCTIONAL_DOCUMENTATION` ·
`BIOMETRIC_TECHNICAL_DOCUMENTATION` · `BIOMETRIC_CODE_WALKTHROUGH`

### Procure to Pay (P2P) — 12 documents + the flow

Group key `p2p`, three entities, in the folder convention:

```
docs/p2p/
├── README.md                     the end-to-end flow across all three
├── purchase-order/               PURCHASE_ORDER_{FUNCTIONAL,TECHNICAL,API}_DOCUMENTATION.md
│                                 PURCHASE_ORDER_CODE_WALKTHROUGH.md
├── payment-request/              PAYMENT_REQUEST_…
└── refund-adjustment/            REFUND_ADJUSTMENT_…
```

Shows in the guide as **Procure to Pay (P2P)** — 3 items, 12 documents.

### The other groups

`saas` · `masters` (57 entities) · `sales-matrix` · `hrms` · `client` ·
`branch` · `plan` · `payment` · `permission` · `integrations` · `clm` (21).

Run the guide to see the live count — it reads the folders, so the index is
never out of date with the files.

---

## 6. Writing a new set — the order that works

1. **Map the routes** — `routes/api.php` for the module's prefix. That is the skeleton.
2. **Read the controller docblocks.** In this codebase they usually state the design in three sentences.
3. **Pull the real schema** — column lists, not guesses.
4. **Collect the constants** — statuses, enums, caps, tolerances.
5. **Trace the frontend** — which screen calls which endpoint, and which masters feed which dropdown.
6. **Write the Flow document first.** It forces you to understand the hand-offs; the other four then fall out of it.
7. **API, then Functional, then Technical, then Code Walkthrough.** Each reuses what the last established.
8. **Write the symptom → file table last**, from what you actually had to look up.

---

## 7. Keeping them true

A document that drifts is worse than none, because it is trusted.

- When a rule changes, update the document in the **same commit**. The rule and its description are one change.
- When a document is found to be wrong, fix it and **say so** — in the commit message, not silently.
- Treat the error messages in the API document as a contract: if you change the wording in the controller, change it here.
- Re-export the `.docx` only when the markdown is settled. The markdown is the source of truth.
