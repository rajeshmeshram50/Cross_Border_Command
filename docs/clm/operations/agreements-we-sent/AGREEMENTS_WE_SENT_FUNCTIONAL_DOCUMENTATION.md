# AGREEMENTS WE SENT — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements We Sent**
> Route `/clm/agreements-sent` · Endpoint `GET /api/clm/ctc-contracts/sent`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**Agreements We Sent** is the **sender's outbox** for Case-to-Case contracts. It answers one question for the person who drafted a contract:

> *Where has my agreement got to — who has approved it, who hasn't, and what are they asking me?*

It is a filtered view of the same `ctc_contracts` table the Case to Case screen uses, restricted to contracts **you created**, and shaped to expose the approval detail a sender needs: the **X-of-Y approval count**, each approver's individual decision, the clarification thread and the rejection reason.

### 1.2 Sent vs To Approve — the mirror pair
| | **Agreements We Sent** | Agreements To Approve |
|---|---|---|
| Filter | `created_by = me` | my email is in `approver_emails` |
| Viewpoint | The **sender's** | The **approver's** |
| `status` on a row | The **contract-wide** verdict | The viewer's **own** decision |
| Key extra data | `approvedCount` / `approverCount`, full approver list | Per-round history |
| Actions | **Respond** to a clarification · revise & resubmit | Approve · Reject · Clarify |

> That status difference matters. Here, `status` tells you what the contract as a whole is doing. On *Agreements To Approve*, the same-looking field is **your personal decision**, not the contract's.

### 1.3 Business value
| Benefit | Description |
|---|---|
| Progress at a glance | "2 of 3 approved" instead of a single flat status |
| Per-approver detail | Who approved, who rejected, and when |
| Clarification loop | See every question raised and answer it in place |
| Rejection reason | The blocking objection is on the row, not buried in the timeline |
| One list per author | Only your own contracts, so a busy tenant stays readable |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Anyone in the tenant | Their **own** contracts (`created_by = me`) |

Menu slug: `clm.agreements_sent`. There is no admin override — a manager does not see another user's outbox here; they use the **Case to Case Contracts** list instead.

---

## 3. BUSINESS PROCESS FLOW

```
   You draft a contract on Case to Case Contracts
        │  (created_by = you)
        ▼
   It appears in AGREEMENTS WE SENT
        │
        ├─ approval "pending"       → approvedCount / approverCount shows progress
        │                             e.g. "1 of 3 approved — awaiting the rest"
        │
        ├─ approval "clarify"       → an approver asked a question
        │     └─▶ YOU RESPOND in the same thread          (POST /{id}/respond)
        │           the question and your answer each carry their own timestamp
        │
        ├─ approval "rejected"      → rejReason shows the blocking objection
        │     └─▶ YOU REVISE & RESUBMIT                   (POST /{id}/resubmit)
        │           the contract re-enters Stage 2 and any live signing request is cleared
        │
        └─ approval "approved"      → every approver has approved
              └─▶ Send for Signing & Negotiation          (POST /{id}/send-for-signing)
```

### 3.1 Reading the two status fields
Each row carries **both**:

| Field | Values | Meaning |
|---|---|---|
| `approval` | `pending` · `approved` · `rejected` | The headline verdict — note **`clarification` is folded into `pending`** here |
| `status` | `pending` · `approved` · `rejected` · **`clarify`** | The tab bucket, which *does* surface clarification separately |

So a contract awaiting a clarification response shows `approval: "pending"` (it is not yet decided) but `status: "clarify"` (it needs *your* input).

### 3.2 The approval count
`approvedCount / approverCount` counts entries in the approver list whose `status` is `approved`. Because **every** approver must approve before the contract flips, this is the number that tells a sender how close they are.

---

## 4. SCREEN SPECIFICATION (`ClmAgreementsSentPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible brief |
| Tabs | Filtered by `status` — All / Pending / Clarify / Approved / Rejected |
| Search | Client-side across code, title and counterparty |
| Table | CODE · TITLE · COUNTERPARTIES (+N, role-labelled) · ORGANISATION · SENT DATE · APPROVER · **APPROVAL PROGRESS (n of N)** · STATUS · EFF/END DATES · ACTIONS |
| Counterparty popover | Names suffixed with their role — *"Royal Cashews (Customer)"* |
| Approver detail | The full approver list with each person's decision and `acted_at` |
| Clarification panel | The thread, with a reply box for the newest unanswered question |
| Rejection banner | `rejReason` shown prominently when the contract is rejected |
| Actions | Respond · Revise & Resubmit · Send for Signing (once approved) · Version History · Timeline |
| Ordering | Newest first (`id DESC`) |
| Realtime | A `CtcApprovalUpdated` broadcast refreshes the row when an approver acts |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | The list shows only contracts where `created_by = the authenticated user` |
| 2 | It is **not** branch-filtered — your own contracts are yours regardless of branch |
| 3 | `approval` folds `clarification` into `pending`; `status` keeps `clarify` as its own bucket |
| 4 | `approvedCount` counts approver entries whose `status` is `approved` |
| 5 | Only the **sender** may respond to a clarification |
| 6 | A response fills the **newest** entry that has no response yet, and stamps its own `response_date` |
| 7 | Resubmission re-enters Stage 2 and clears any live signing request |
| 8 | Send-for-signing requires `approval_status = approved` |
| 9 | Every audit timestamp is stored UTC and converted to IST on read |
| 10 | Counterparty names are refreshed from their live master records on every read |

---

## 6. STATUS MODEL

```
approval  (headline)   pending | approved | rejected        ← clarification → pending
status    (tab bucket) pending | approved | rejected | clarify
```
Underneath, the contract still carries its own `stage` (1–4) and `approval_status`; this screen simply presents them from the sender's perspective.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Strictly own contracts | There is no "sent by my team" view; a manager must use Case to Case Contracts |
| No branch filter | Unlike the main list, this one ignores the Branch Switcher entirely |
| One clarification at a time | `respond` fills the newest unanswered entry; there is no way to answer an older one out of order |
| `approver` column | Shows the **primary** approver only; the full list is in the detail panel |
| No reminders | `days_to_approve` / `reminder_days` are stored but no scheduler chases approvers |
| No withdraw | A sent contract cannot be recalled from approval — only revised and resubmitted |

---

*Related documents: AGREEMENTS_WE_SENT_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_WE_SENT_CODE_WALKTHROUGH.md · AGREEMENTS_WE_SENT_API_DOCUMENTATION.md*
