# CASE TO CASE CONTRACTS (CTC) — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Case to Case Contracts**
> Route `/clm/case-to-case`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**Case-to-Case (CTC)** contracts are one-off, standalone agreements that are **not** tied to a shipment or an opportunity — an NDA with a prospective partner, a one-time service agreement, a memorandum of understanding, a settlement.

Everything else in CLM hangs off a segment rule or a lead. CTC deliberately does not: the user drafts a contract, names its counterparties, sends it round for internal approval, then out for signature, and finally files it in the repository. It is the module's only screen with a **full four-stage lifecycle, multi-approver voting, a clarification thread and version history**.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Contracts without a deal | Cover agreements that have no shipment or opportunity behind them |
| Real internal approval | Every named approver must approve; one rejection blocks the contract |
| Auditable | Every state change appends an immutable version entry with who, what and when |
| Clarification loop | An approver can ask a question without rejecting; the sender answers in the same thread |
| Live counterparties | Party details are re-read from the customer/consignee/vendor masters on every view |
| E-signature | Send to counterparties via Zoho Sign, or record signatures manually |

### 1.3 Key features
- Full-screen **4-stage** create/edit form (`ClmCtcForm`).
- Counterparty picker over Customers, Consignees and Vendors, with a **category rule**.
- Multi-approver list with per-approver decisions and an X-of-Y progress badge.
- Clarification thread with sender responses.
- **Append-only version history** + a Review Timeline modal.
- Rich-text body with clause insertion and DOCX upload.
- Per-version PDF/DOCX download.
- Real-time approval broadcast (Laravel Reverb).

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All contracts, all tenants |
| Client Admin / Client User | The client's contracts |
| Branch User | Own branch |
| Employee | Own branch; may draft, and may approve when named as an approver |

Menu slug: `clm.case_to_case`. Two companion screens share the same table: **Agreements We Sent** (`clm.agreements_sent`) and **Agreements To Approve** (`clm.agreements_to_approve`).

---

## 3. THE FOUR STAGES

```
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 1 — AGREEMENT DRAFTING                                         │
│    title · agreement type · our organisation · counterparties ·       │
│    effective/end dates · auto-renewal · body content · header/footer  │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  Submit & Send for Approval
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 2 — INTERNAL REVIEW & APPROVAL                                 │
│    every named approver decides independently:                        │
│      Approve · Reject (with reason) · Request Clarification           │
│    ALL must approve → approval_status = approved                      │
│    ANY rejection    → approval_status = rejected (sender may revise   │
│                       and resubmit, repeatedly)                       │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  Send for Signing & Negotiation
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 3 — SIGNING & NEGOTIATION                                      │
│    recipients listed; signatures recorded (manually or via Zoho)      │
│    a counterparty DECLINE sends the contract back to Stage 2          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  all parties signed
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 4 — FINAL CONTRACT REPOSITORY                                  │
│    status = signed; the contract is archived                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Two independent status axes
| Axis | Values | Meaning |
|---|---|---|
| `stage` | 1 · 2 · 3 · 4 | Where the contract is in its lifecycle |
| `approval_status` | `pending` · `approved` · `rejected` · `clarification` | The internal review verdict |
| `status` (list bucket) | `inprogress` · `signed` · `rejected` | What the list tab shows |

The list bucket is derived: rejected approval ⇒ `rejected`; stage ≥ 4 or status `signed` ⇒ `signed`; otherwise `inprogress`.

### 3.2 The counterparty category rule
> **The Customer and the Consignee on one agreement must share a category** — both Domestic (India) or both International.

Suppliers are exempt (they may be either), and "Our Organisation" is not a counterparty. The rule only fires when **both** a Customer and a Consignee are present. It is enforced **server-side** on create and on edit — the client-side filter is a convenience only.

### 3.3 Approval arithmetic
- Each approver carries its own `status` (`pending` → `approved` \| `rejected`) and `acted_at`.
- The contract flips to `approved` only when **every** approver has approved.
- A partial approval records an audit note *"X approved (n of N) — awaiting remaining approvers"* and keeps the round open.
- **One rejection blocks the whole agreement**, but the row stays workable (`status` remains `inprogress`) so the sender can revise and resubmit.
- Contracts drafted before per-approver tracking (no approver list) approve outright on a single nod.

---

## 4. SCREEN SPECIFICATION (`ClmCaseToCasePage.tsx`)

| Element | Behaviour |
|---|---|
| Header | "Create CTC Agreement" + a collapsible **stage-card** box explaining the four stages |
| Tabs | **All** · **Signed** · **In Progress** · **Rejected** (single-capsule tab bar) |
| Search | Client-side across code, title and counterparty |
| Table | CODE · TITLE · ORGANISATION · COUNTERPARTIES (+N popover) · STAGE · APPROVAL STATUS · STATUS · ACTIONS |
| Counterparty popover | Each name is suffixed with its role — *"Royal Cashews (Customer)"* — because one company can appear in more than one role |
| Row actions | Download · Edit · **Version History** · **Timeline** |
| Create/Edit | Full-screen 4-stage `ClmCtcForm` |
| Modals | `VersionHistoryModal` · `AgreementTimelineModal` · `ClmCtcSignPositionModal` |
| Editor | `CtcRichEditor` with clause insertion, table insertion and DOCX upload |
| Theme | Violet operations theme (`useOpsTheme`) |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | `CTC-NNN` is allocated **per branch**, under a client row lock, counting soft-deleted rows so the sequence stays gap-free |
| 2 | On create the contract enters **Stage 2** directly with `approval_status = pending` |
| 3 | Customer and Consignee must share a category (both India or both non-India); Supplier is exempt |
| 4 | Only a **named approver** may approve or reject (matched by email; the primary-approver slot is the legacy fallback) — otherwise 403 |
| 5 | The contract is `approved` only when **all** approvers have approved |
| 6 | One rejection sets `approval_status = rejected` but leaves `status = inprogress` so the draft stays workable |
| 7 | A clarification may be raised by **any** approver into a shared thread; the sender answers the newest open entry |
| 8 | Resubmission re-enters Stage 2 and **clears any live signing request** — a decline can never go straight back to Zoho |
| 9 | Send-for-signing requires `approval_status = approved` (422 otherwise) |
| 10 | Move-to-repository requires **every** recipient to have signed (422 otherwise) |
| 11 | Every state change appends a **version** entry (append-only; nothing is ever rewritten) |
| 12 | Counterparty factual fields (name, country, phone, email) are refreshed from the live master on read; the user's `referred` alias and `badge` are preserved |
| 13 | All audit timestamps are stored **UTC** and converted to IST on read |

---

## 6. STATUS MODEL

```
stage            1 Drafting → 2 Internal Review → 3 Signing → 4 Repository
approval_status  pending → approved | rejected | clarification
status           inprogress | signed | rejected      (the list bucket)

listStatus():  approval_status === 'rejected'          → 'rejected'
               stage >= 4 || status === 'signed'       → 'signed'
               otherwise                                → 'inprogress'
```

> The **Diagnosis & Resolution Center** uses a slightly extended version of this mapping that also surfaces `clarification` as its own bucket.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Manual signing | `record-signature` and `move-to-repository` are sender-driven actions; only the Zoho path detects signing automatically |
| No approval deadline enforcement | `days_to_approve` and `reminder_days` are stored but not enforced by a scheduler |
| Rejection is terminal per round | There is no "unreject" — the sender must revise and resubmit |
| Version content is a snapshot | Large contracts make `versions` a heavy JSON column; there is no pruning |
| Counterparty resolution | A counterparty whose source record was deleted keeps its stored snapshot silently |
| No branch-level approver routing | Approvers are chosen by email from a candidate list, not by role or hierarchy |
| Render limits | Very large version PDFs raise memory to 1 GB and a 300 s time limit; beyond that the download fails |

---

*Related documents: CASE_TO_CASE_TECHNICAL_DOCUMENTATION.md · CASE_TO_CASE_CODE_WALKTHROUGH.md · CASE_TO_CASE_API_DOCUMENTATION.md*
