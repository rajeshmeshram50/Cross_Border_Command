# AGREEMENTS WE SENT — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements We Sent**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.agreements_sent` gates the UI.
- Success: `{ status: true, data: … }` · Failure: `{ status: false, message }` or a Laravel 422.
- Codes: 200 · 401 · 404 · 422.
- All audit timestamps are stored **UTC** and returned converted to **Asia/Kolkata**.
- `/sent` is declared **before** the generic `/{id}` route.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/ctc-contracts/sent` | **The outbox** — contracts you created |
| POST | `/clm/ctc-contracts/{id}/respond` | Answer the newest open clarification |
| POST | `/clm/ctc-contracts/{id}/resubmit` | Revise and re-send for internal review |
| POST | `/clm/ctc-contracts/{id}/send-for-signing` | Once approved, move to Stage 3 |
| GET | `/clm/ctc-contracts/{id}/versions` | The append-only audit trail |
| GET | `/clm/ctc-contracts/{id}/versions/{v}/download` | A version snapshot as PDF |

---

## 3. GET `/clm/ctc-contracts/sent`

Returns contracts where **`created_by` is the authenticated user**, newest first. No query parameters, **no branch filter**.

**200**
```json
{
  "status": true,
  "data": [
    { "id": "CTC-004",
      "dbId": 12,
      "title": "Mutual Non-Disclosure Agreement",
      "cp": ["Royal Cashews", "Royal Logistics FZE"],
      "cpLabeled": ["Royal Cashews (Customer)", "Royal Logistics FZE (Consignee)"],
      "org": "IGC-Agrotech",
      "date": "20 Jul 2026",
      "effDate": "01 Jun 2026",
      "endDate": "31 May 2027",
      "expDate": "31 May 2027",
      "createdBy": "Anita Desai",

      "approver": "Parth Shah",
      "approval": "pending",
      "status": "clarify",

      "approvers": [
        { "name": "Parth Shah", "email": "parth@igc.com", "role": "Legal Head",
          "mandatory": true, "status": "approved", "acted_at": "21 Jul 2026 17:00" },
        { "name": "Vedant Rao", "email": "vedant@igc.com", "role": "Finance",
          "mandatory": false, "status": "pending", "acted_at": null }
      ],
      "approvedCount": 1,
      "approverCount": 2,

      "clarifications": [
        { "query": "Which entity signs on the consignee side?",
          "by": "Parth Shah",
          "date": "21 Jul 2026 11:30",
          "response": "",
          "resolved": false }
      ],
      "rejReason": null }
  ]
}
```

### The two status fields
| Field | Values | Meaning |
|---|---|---|
| **`approval`** | `pending` · `approved` · `rejected` | The headline verdict. **`clarification` is folded into `pending`** |
| **`status`** | `pending` · `approved` · `rejected` · **`clarify`** | The tab bucket — the only field that surfaces an open clarification |

> A contract awaiting your clarification response returns `approval: "pending"` **and** `status: "clarify"`. Consumers that need to detect an open clarification must read `status`.

### Other fields
| Field | Meaning |
|---|---|
| `id` / `dbId` | `CTC-NNN` code and the numeric id (use `dbId` for the write endpoints) |
| `cp` / `cpLabeled` | Counterparty names, plain and role-suffixed. Refreshed from the live Customer/Consignee/Vendor masters on every read |
| `approver` | The **primary** approver's name only — the real list is `approvers[]` |
| `approvers[]` | Every approver with their own `status` and IST `acted_at` |
| `approvedCount` / `approverCount` | The X-of-Y progress; the contract flips to approved only at `approvedCount === approverCount` |
| `clarifications[]` | The shared thread; `date` is when the question was asked, `response_date` (once answered) is when you replied |
| `rejReason` | The blocking objection when `status = "rejected"` |
| `date` | `submitted_at`, falling back to `created_at` |

---

## 4. POST `/clm/ctc-contracts/{id}/respond`

Answer the **newest** clarification that has no response yet.

```json
{ "response": "Royal Logistics FZE — their Managing Director signs." }
```

| Field | Rule |
|---|---|
| `response` | required · string · max 2000 |

**200** → `{ "status": true, "data": { …the same shape as a `/sent` row… } }`

This is the only CTC write action that returns the **sent** shape, because only the sender calls it.

The answered thread entry gains a second timestamp:
```json
{ "query": "Which entity signs on the consignee side?",
  "by": "Parth Shah",
  "date": "21 Jul 2026 11:30",
  "response": "Royal Logistics FZE — their Managing Director signs.",
  "response_date": "21 Jul 2026 16:05",
  "resolved": false }
```
`response_date` is distinct from `date` so the Review Timeline shows the real answer time rather than reusing the question's timestamp.

A `CtcApprovalUpdated` broadcast fires afterwards so the approver's screen updates live.

> **Caveat:** the endpoint is tenant-scoped but does **not** verify that the caller is the contract's creator. The UI only exposes it on your own rows.

---

## 5. POST `/clm/ctc-contracts/{id}/resubmit`

Revise and re-send for internal review. Used both after an **internal rejection** and after a **counterparty declined** the e-signature. Either way the contract re-enters **Stage 2**, and **any live signing request is cleared** — a decline can never go straight back to Zoho. Repeatable.

```json
{ "content": "<p>…revised body…</p>",
  "title": "Mutual Non-Disclosure Agreement (Rev 2)",
  "agreement_type": "NDA",
  "header_config": { … }, "footer_config": { … },
  "counterparties": [ … ] }
```
All fields optional; send just `content` for the lighter revise-after-rejection flow, or the full payload from the edit form.

**200** → `{ "status": true, "data": { …the raw contract row… } }`

A version entry is appended, labelled either *"Revised draft resubmitted for internal review"* or *"Draft revised after counterparty decline & resubmitted for internal review"*.

---

## 6. POST `/clm/ctc-contracts/{id}/send-for-signing`

```json
{ "recipients": [
    { "name": "M. Iyer", "email": "md@royal.com",
      "role": "Managing Director", "contact": "+91 98…" } ],
  "days_to_sign": 14 }
```

| Field | Rule |
|---|---|
| `recipients` | required · min 1; each needs `name`, the rest optional |
| `days_to_sign` | optional · 1–365 |

**422 — not yet approved**
```json
{ "status": false, "message": "Agreement must be approved before sending for signing." }
```

**200** → `stage → 3`, recipients stored with `signed: false`, version appended.

> Alternatively, `POST /clm/signature-requests/ctc-send` routes the contract through **Zoho Sign** instead of manual recording.

---

## 7. AUDIT ENDPOINTS

### GET `/clm/ctc-contracts/{id}/versions`
```json
{ "status": true,
  "data": [
    { "v": 1, "label": "Agreement drafted & submitted for internal review",
      "status": "Under Review", "date": "20 Jul 2026 21:12", "by": "Anita Desai" },
    { "v": 2, "label": "Parth Shah approved (1 of 2) — awaiting remaining approvers",
      "status": "Approving", "date": "21 Jul 2026 17:00", "by": "Parth Shah" }
  ] }
```
Append-only; dates converted from stored UTC to IST.

### GET `/clm/ctc-contracts/{id}/versions/{v}/download`
Streams that snapshot as a PDF with the page shell and footer page numbers. **404** when the version number does not exist.

---

## 8. QUICK REFERENCE

```
GET  /clm/ctc-contracts/sent                       # your outbox (created_by = you)
     → approvedCount / approverCount               #   how close to full approval
     → status = "clarify"                          #   an approver asked something
POST /clm/ctc-contracts/{dbId}/respond             # { response } — answers the newest question
     → status = "rejected", rejReason              #   the blocking objection
POST /clm/ctc-contracts/{dbId}/resubmit            # revise → back to Stage 2
     → approval = "approved"                       #   everyone approved
POST /clm/ctc-contracts/{dbId}/send-for-signing    # { recipients[], days_to_sign }
POST /clm/signature-requests/ctc-send              #   …or send via Zoho instead
GET  /clm/ctc-contracts/{dbId}/versions            # the audit trail
```

---

## 9. NOTES (caveats)

1. The list is filtered by **`created_by = you`** and has **no branch filter** — your contracts appear regardless of branch.
2. There is no "sent by my team" view; a manager uses the **Case to Case Contracts** list instead.
3. `approval` folds `clarification` into `pending`; only `status` keeps `clarify` distinct.
4. `approver` is the **primary** approver's name; read `approvers[]` for the full picture.
5. The contract only becomes `approved` when `approvedCount === approverCount` — **every** approver must approve.
6. One rejection blocks the contract but leaves it workable (`status` on the underlying row stays `inprogress`).
7. `respond` answers only the **newest unanswered** clarification, and is tenant-scoped rather than creator-scoped.
8. `resubmit` always clears a live signing request.
9. `days_to_approve` / `reminder_days` are stored but **no scheduler chases approvers**.
10. A sent contract cannot be withdrawn from approval — only revised and resubmitted.
11. All timestamps are IST-converted on read via the shared `CtcAuditTime` helper.

---

*Related documents: AGREEMENTS_WE_SENT_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_WE_SENT_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_WE_SENT_CODE_WALKTHROUGH.md*
