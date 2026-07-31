# AGREEMENTS TO APPROVE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements To Approve**
> Route `/clm/agreements-to-approve` · Endpoint `GET /api/clm/ctc-contracts/to-approve`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**Agreements To Approve** is the **approver's personal inbox** for Case-to-Case contracts. It lists every contract where **your email** appears on the approver list, and lets you act on it:

- **Approve** — record your consent
- **Reject** — block the contract with a reason
- **Request Clarification** — ask the sender a question without rejecting

### 1.2 The single most important thing to understand
> **The `status` on a row is *your own* decision — not the contract-wide verdict.**

Once **you** have approved your slot, the row moves to **your** *Approved* tab, even while other approvers are still pending and the contract as a whole is not yet approved. The contract-wide X-of-Y progress is tracked on the sender's screen (*Agreements We Sent*), not here.

This is deliberate: an approver's inbox should show *what still needs my attention*, not *what the contract is collectively waiting on*.

### 1.3 Sent vs To Approve — the mirror pair
| | Agreements We Sent | **Agreements To Approve** |
|---|---|---|
| Filter | `created_by = me` | **my email is an approver** |
| Viewpoint | The sender's | **The approver's** |
| `status` on a row | The contract-wide verdict | **My own decision** |
| Actions | Respond · Resubmit · Send for Signing | **Approve · Reject · Clarify** |
| Rows per contract | One | **One — the latest approval round** |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Anyone in the tenant | Contracts where their **email** is in the approver list (or is the legacy primary approver) |

Menu slug: `clm.agreements_to_approve`.

Authorisation is by **email match**, not by role or hierarchy. A user who is not a named approver on a contract receives **403** if they attempt to approve or reject it.

---

## 3. BUSINESS PROCESS FLOW

```
   A sender drafts a contract and names you as an approver
        │
        ▼
   It appears in AGREEMENTS TO APPROVE  (status = pending)
        │
        ├─▶ APPROVE                                    (POST /{id}/approve)
        │     · your slot is stamped approved + acted_at
        │     · the row moves to YOUR Approved tab immediately
        │     · the CONTRACT flips to approved only when EVERY approver has approved
        │
        ├─▶ REJECT  { reason }                         (POST /{id}/reject)
        │     · your slot is stamped rejected
        │     · one rejection BLOCKS the whole contract
        │     · the sender may revise and resubmit — a new round opens
        │
        └─▶ REQUEST CLARIFICATION  { query }           (POST /{id}/clarify)
              · appended to a SHARED thread, stamped with your name
              · the contract's approval_status becomes 'clarification'
              · the sender answers in the same thread
```

### 3.1 Approval rounds
The list is built from the contract's **version history**, not from its current status. A **round** opens on every *"Under Review"* submission (the initial draft and every resubmission) and closes on a *Rejected* or *Approved* decision.

A contract that was rejected, revised and then approved therefore has **three** persistent round entries — `Rejected → Pending → Approved` — instead of one row whose status keeps flipping. Each round preserves its own date and, for rejections, its own reason.

**The list shows only the latest round per contract** — rounds come back newest-first and are de-duplicated by contract code — so you see one actionable row per agreement.

### 3.2 The open round reflects *you*
The still-open round (no decision recorded yet) is resolved in this order:

1. **You have approved your slot** → the round shows `approved`
2. **You have rejected** → the round shows `rejected`
3. **A clarification is live** on the contract → the round shows `clarification`
4. Otherwise → `pending`

Rule 1 is what moves a row into your *Approved* tab even while the contract as a whole waits on others.

### 3.3 Clarification history is never hidden
The full clarification thread is attached to **every** round, not just the round that was in a clarification state. Before this, the history looked deleted once the agreement moved on — the data had always been there, it just was not surfaced.

---

## 4. SCREEN SPECIFICATION (`ClmAgreementsToApprovePage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible brief |
| Tabs | Filtered by **your** `status` — Pending / Approved / Rejected / Clarification |
| Search | Client-side across code and title |
| Table | CODE · TITLE · SENT BY · SENT DATE · APPROVER · **MY STATUS** · EXPIRY DATE · ACTIONS |
| Approver list | Every approver on the contract with their individual decision, so you can see who else has acted |
| Clarification panel | The shared thread, with a box to raise a new question |
| Rejection reason | Shown on a rejected round |
| Actions | **Approve** · **Reject** (reason required) · **Request Clarification** · Version History · Timeline |
| Ordering | Newest first (`id DESC`), one row per contract |
| Realtime | A `CtcApprovalUpdated` broadcast refreshes the row when another approver or the sender acts |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | The list shows contracts where your **email** is in `approver_emails`, or you are the legacy `primary_approver_email` |
| 2 | It is tenant-scoped but **not** branch-filtered |
| 3 | Rows are derived from the version history as **approval rounds**; only the **latest** round per contract is listed |
| 4 | A round's `status` on the open round reflects **your own** decision first |
| 5 | Only a **named approver** may approve or reject — otherwise **403** |
| 6 | Approving stamps your slot with `approved` + `acted_at`; the contract flips only when **all** approvers have approved |
| 7 | A partial approval keeps the contract `pending` and logs *"X approved (n of N) — awaiting remaining approvers"* |
| 8 | **One rejection blocks the whole contract**, but the row stays workable so the sender can revise |
| 9 | `reason` is **required** on reject (max 1000 characters) |
| 10 | Any approver may add to the **shared** clarification thread; each remark is attributed by name |
| 11 | The full clarification history is attached to every round |
| 12 | Contracts created before per-approver tracking (empty approver list) approve outright on one call |
| 13 | Every audit timestamp is stored UTC and converted to IST on read |

---

## 6. STATUS MODEL

```
Row status (YOURS)   pending | approved | rejected | clarification
Contract status       approval_status: pending | approved | rejected | clarification
                      stage: 1 Drafting · 2 Review · 3 Signing · 4 Repository
```

The two are independent: your row can read `approved` while the contract's `approval_status` is still `pending`, because another approver has not acted.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Personal status only | The contract-wide X-of-Y is not shown here — check *Agreements We Sent* or the approver list |
| Email-based authorisation | Approvers are matched by email, not by role or reporting line; changing a user's email detaches them |
| No delegation | An approver cannot delegate or reassign their slot |
| No reminders | `days_to_approve` / `reminder_days` are stored but no scheduler chases you |
| One row per contract | Earlier rounds are visible only through Version History / the Timeline modal |
| Round detection is label-based | Rounds are derived from version `status` strings (`Under Review` / `Approved` / `Rejected`) |
| Rejection is per round | There is no "undo my rejection" — the sender must resubmit, which opens a new round |

---

*Related documents: AGREEMENTS_TO_APPROVE_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_TO_APPROVE_CODE_WALKTHROUGH.md · AGREEMENTS_TO_APPROVE_API_DOCUMENTATION.md*
