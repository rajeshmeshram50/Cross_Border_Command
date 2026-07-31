# AGREEMENTS TO APPROVE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements To Approve**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.agreements_to_approve` gates the UI; the API enforces **tenant scope + approver membership by email**.
- Success: `{ status: true, data: … }` · Failure: `{ status: false, message }` or a Laravel 422.
- Codes: 200 · 401 · **403** (not a named approver) · 404 · 422.
- All audit timestamps are stored **UTC** and returned converted to **Asia/Kolkata**.
- `/to-approve` is declared **before** the generic `/{id}` route.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/ctc-contracts/to-approve` | **Your approval inbox** |
| POST | `/clm/ctc-contracts/{id}/approve` | Record your approval |
| POST | `/clm/ctc-contracts/{id}/reject` | Block the contract with a reason |
| POST | `/clm/ctc-contracts/{id}/clarify` | Ask the sender a question |
| GET | `/clm/ctc-contracts/{id}/versions` | The full audit trail (all rounds) |
| GET | `/clm/ctc-contracts/{id}/versions/{v}/download` | A version snapshot as PDF |

---

## 3. GET `/clm/ctc-contracts/to-approve`

Returns contracts where **your email** is in `approver_emails` (or you are the legacy `primary_approver_email`), newest first, **one row per contract** — the latest approval round.

No query parameters. **No branch filter.**

**200**
```json
{
  "status": true,
  "data": [
    { "id": "CTC-004",
      "dbId": 12,
      "title": "Mutual Non-Disclosure Agreement",
      "date": "22 Jul 2026 14:35",
      "createdBy": "Anita Desai",
      "approver": "Parth Shah",

      "status": "approved",

      "approvers": [
        { "name": "Parth Shah", "status": "approved" },
        { "name": "Vedant Rao", "status": "pending"  }
      ],

      "clarifications": [
        { "query": "Which entity signs on the consignee side?",
          "by": "Parth Shah",
          "date": "21 Jul 2026 11:30",
          "response": "Royal Logistics FZE — their MD signs.",
          "response_date": "21 Jul 2026 16:05",
          "resolved": false }
      ],

      "expDate": "31 May 2027",
      "rejReason": null }
  ]
}
```

### ⚠ `status` is **your own** decision
| Value | Meaning |
|---|---|
| `pending` | You have not acted on the current round |
| `approved` | **You** approved — even if other approvers are still pending and the contract is not yet approved |
| `rejected` | **You** rejected |
| `clarification` | A clarification is live on the contract and you have not acted |

The contract-wide X-of-Y progress is **not** on this payload — read `approvers[]` to see who else has acted, or use `GET /clm/ctc-contracts/sent` (the sender's view) for `approvedCount` / `approverCount`.

### Other fields
| Field | Meaning |
|---|---|
| `id` / `dbId` | `CTC-NNN` code and the numeric id (use `dbId` on the write endpoints) |
| `date` | The round's opening or closing date, IST-converted |
| `approver` | The **primary** approver's name (falls back to your own name) |
| `approvers[]` | Every approver with their individual decision — for display |
| `clarifications[]` | The **full** thread, attached to every round so history is never hidden |
| `rejReason` | The reason on a rejected round |
| `expDate` | The contract's `end_date` |

### How rows are built — approval rounds
Rows are derived from the contract's **version history**, not its current columns. A **round** opens on every `"Under Review"` entry (the initial draft and every resubmission) and closes on `"Approved"` or `"Rejected"`.

| Version status | Round effect |
|---|---|
| `Under Review` | opens a round |
| `Approved` | closes it as `approved` |
| `Rejected` | closes it as `rejected` (reason captured) |
| **`Approving`** | **ignored** — the partial-approval note, so a partial nod does not close the round |
| `Sent for Signing` · `Signed` | ignored (post-approval) |

A contract that was rejected, revised and then approved yields three persistent rounds; **only the latest is listed**. Earlier rounds are visible through `GET /{id}/versions`.

---

## 4. POST `/clm/ctc-contracts/{id}/approve`

No body.

**200** → `{ "status": true, "data": { …the same shape as a `/to-approve` row… } }`

**403 — not a named approver**
```json
{ "status": false, "message": "You are not an approver for this agreement." }
```

### What happens
1. Your slot in `approvers[]` is stamped `status: "approved"` with an `acted_at` timestamp (matched by **email**; the legacy `primary_approver_email` is the fallback).
2. If **every** approver has now approved → `approval_status: "approved"` and a version entry *"Approved by all N approver(s)"* (status `Approved`) closes the round.
3. Otherwise → `approval_status` stays `"pending"` and the version entry reads *"X approved (1 of 2) — awaiting remaining approvers"* with status **`Approving`**, which deliberately does **not** close the round.
4. Your row still moves to **your** *Approved* tab immediately.
5. A `CtcApprovalUpdated` broadcast fires.

> Contracts created before per-approver tracking (empty `approvers`) approve outright on one call.

---

## 5. POST `/clm/ctc-contracts/{id}/reject`

```json
{ "reason": "Clause 7 conflicts with our standard indemnity." }
```

| Field | Rule |
|---|---|
| `reason` | **required** · string · max 1000 |

**200** → `{ "status": true, "data": { … } }`

### What happens
- Your slot is stamped `rejected` + `acted_at`.
- `approval_status → "rejected"` — **one rejection blocks the whole contract**.
- **`status` stays `"inprogress"`** on the underlying row, so the sender can revise and resubmit repeatedly.
- A version entry *"Rejected by <you> — <reason>"* (status `Rejected`) closes the round with the reason attached.
- A `CtcApprovalUpdated` broadcast fires.

There is no "undo" — the sender must resubmit, which opens a **new** round.

---

## 6. POST `/clm/ctc-contracts/{id}/clarify`

```json
{ "query": "Which entity signs on the consignee side?" }
```

| Field | Rule |
|---|---|
| `query` | **required** · string · max 2000 |

**200** → `{ "status": true, "data": { … } }`

### What happens
- A new entry is appended to the **shared** thread, stamped with your name:
  ```json
  { "query": "…", "by": "Parth Shah", "date": "21 Jul 2026 11:30",
    "response": "", "resolved": false }
  ```
- `approval_status → "clarification"`.
- The sender answers via `POST /{id}/respond`, which fills the newest unanswered entry and adds its own `response_date`.
- Any approver may add to the same thread.

> **Caveat:** unlike `approve` and `reject`, this endpoint does **not** re-verify approver membership — it is tenant-scoped only.

---

## 7. AUDIT ENDPOINTS

### GET `/clm/ctc-contracts/{id}/versions`
The complete, append-only trail — including the rounds that are no longer listed in your inbox.

```json
{ "status": true,
  "data": [
    { "v": 1, "label": "Agreement drafted & submitted for internal review",
      "status": "Under Review", "date": "20 Jul 2026 21:12", "by": "Anita Desai" },
    { "v": 2, "label": "Rejected by Parth Shah — Clause 7 conflicts with our standard indemnity.",
      "status": "Rejected", "date": "21 Jul 2026 11:30", "by": "Parth Shah",
      "reason": "Clause 7 conflicts with our standard indemnity." },
    { "v": 3, "label": "Revised draft resubmitted for internal review",
      "status": "Under Review", "date": "22 Jul 2026 09:05", "by": "Anita Desai" },
    { "v": 4, "label": "Parth Shah approved (1 of 2) — awaiting remaining approvers",
      "status": "Approving", "date": "22 Jul 2026 14:35", "by": "Parth Shah" }
  ] }
```

Reading that trail as rounds: v1 opens round A, v2 closes it `rejected`, v3 opens round B, v4 is ignored (partial) — so **round B is still open**, and your inbox row shows `approved` because *your* slot is approved.

### GET `/clm/ctc-contracts/{id}/versions/{v}/download`
Streams that snapshot as a PDF with the page shell and footer page numbers. **404** when the version number does not exist.

---

## 8. WORKED EXAMPLE — two approvers

| Step | Action | `approvers[]` | Contract `approval_status` | **Parth's row** | **Vedant's row** |
|---|---|---|---|---|---|
| 1 | Sender submits | both `pending` | `pending` | `pending` | `pending` |
| 2 | Parth approves | Parth `approved` | `pending` | **`approved`** | `pending` |
| 3 | Vedant clarifies | — | `clarification` | `approved` | **`clarification`** |
| 4 | Sender responds | — | `clarification` | `approved` | `clarification` |
| 5 | Vedant approves | both `approved` | **`approved`** | `approved` | `approved` |

Note step 2: Parth's row reads `approved` while the contract is still `pending`. That is the personal-inbox semantics — not a bug.

---

## 9. QUICK REFERENCE

```
GET  /clm/ctc-contracts/to-approve          # your inbox — status = YOUR decision
POST /clm/ctc-contracts/{dbId}/approve      # no body; 403 if you're not an approver
POST /clm/ctc-contracts/{dbId}/reject       # { reason } — blocks the whole contract
POST /clm/ctc-contracts/{dbId}/clarify      # { query } — shared thread
GET  /clm/ctc-contracts/{dbId}/versions     # all rounds, including older ones

# the sender's side
GET  /clm/ctc-contracts/sent                # approvedCount / approverCount
POST /clm/ctc-contracts/{dbId}/respond      # answers your clarification
POST /clm/ctc-contracts/{dbId}/resubmit     # opens a NEW round after a rejection
```

---

## 10. NOTES (caveats)

1. **`status` is your own decision**, not the contract-wide verdict. Read `approvers[]`, or the sender's `/sent` payload, for overall progress.
2. The list is filtered by **email** (`whereJsonContains('approver_emails', …)` or the legacy primary slot) and has **no branch filter**.
3. `approve` and `reject` **re-verify** membership and return 403 otherwise; **`clarify` does not**.
4. All approvers must approve before the contract flips; **one rejection blocks it**, but the row stays workable.
5. Rows are built from the **version history**; only the **latest round** per contract is listed.
6. Round boundaries depend on the literal version statuses `Under Review` / `Approved` / `Rejected`; `Approving` is deliberately excluded.
7. The full clarification history is attached to every round, so it never looks deleted.
8. Approvers cannot delegate or reassign their slot, and changing a user's email detaches them from contracts naming the old address.
9. `days_to_approve` / `reminder_days` are stored but **no scheduler chases approvers**.
10. All timestamps are IST-converted on read via the shared `CtcAuditTime` helper.

---

*Related documents: AGREEMENTS_TO_APPROVE_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_TO_APPROVE_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_TO_APPROVE_CODE_WALKTHROUGH.md*
