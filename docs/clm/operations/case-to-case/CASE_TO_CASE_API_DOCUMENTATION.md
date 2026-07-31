# CASE TO CASE CONTRACTS (CTC) — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Case to Case Contracts**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slugs `clm.case_to_case`, `clm.agreements_sent`, `clm.agreements_to_approve` gate the three screens; the API enforces **tenant scope + approver authorisation**.
- Success: `{ status: true, data: … }` · Failure: `{ status: false, message }` or a Laravel 422 `{ message, errors }`.
- Codes: 200 · 201 · 401 · **403** (not an approver) · 404 · **422** (validation, category rule, lifecycle guard).
- All audit timestamps are stored **UTC** and returned converted to **Asia/Kolkata**.
- Route order: the literal paths (`/sent`, `/to-approve`, `/approver-candidates`, `/contact-persons`, `/placeholder-values`) precede `/{id}`, which is `whereNumber`-constrained.

---

## 2. ENDPOINT INDEX

### Lists
| Method | Path | Screen |
|---|---|---|
| GET | `/clm/ctc-contracts` | Case to Case Contracts |
| GET | `/clm/ctc-contracts/sent` | Agreements We Sent |
| GET | `/clm/ctc-contracts/to-approve` | Agreements To Approve |

### Lookups
| Method | Path |
|---|---|
| GET | `/clm/ctc-contracts/approver-candidates` · `/contact-persons` · `/placeholder-values` |

### CRUD
| Method | Path |
|---|---|
| POST | `/clm/ctc-contracts` |
| GET · PUT · DELETE | `/clm/ctc-contracts/{id}` |

### Approval
| Method | Path |
|---|---|
| POST | `/{id}/approve` · `/{id}/reject` · `/{id}/clarify` · `/{id}/respond` |

### Lifecycle
| Method | Path |
|---|---|
| POST | `/{id}/resubmit` · `/{id}/send-for-signing` · `/{id}/record-signature` · `/{id}/move-to-repository` |

### Audit
| Method | Path |
|---|---|
| GET | `/{id}/versions` · `/{id}/versions/{v}/download` |

### E-signature (served by `ClmSignatureController`)
| Method | Path |
|---|---|
| POST | `/clm/signature-requests/ctc-preview` · `/ctc-send` |
| GET | `/clm/ctc-contracts/{id}/sync-signature` |
| POST | `/clm/ctc-contracts/{id}/remind-signing` |

---

## 3. GET `/clm/ctc-contracts`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 12,
      "code": "CTC-004",
      "title": "Mutual Non-Disclosure Agreement",
      "agreement_type": "NDA",
      "org": "IGC-Agrotech",
      "counterparties": ["Royal Cashews (Customer)", "Royal Logistics FZE (Consignee)"],
      "eff_date": "01 Jun 2026",
      "end_date": "31 May 2027",
      "stage": 2,
      "approval_status": "pending",
      "status": "inprogress",
      "approvers": [
        { "name": "Parth Shah",  "status": "approved" },
        { "name": "Vedant Rao",  "status": "pending"  }
      ],
      "approval_progress": { "approved": 1, "total": 2 },
      "created_by_name": "Anita Desai",
      "submitted_at": "20 Jul 2026 15:42" }
  ]
}
```

`counterparties` are **role-labelled** — a company can appear as more than one role on the same agreement, so the popover says which.

`status` is the **list bucket**, derived:
```
approval_status === 'rejected'        → 'rejected'
stage >= 4 || status === 'signed'     → 'signed'
otherwise                              → 'inprogress'
```

---

## 4. POST `/clm/ctc-contracts`

```json
{ "title": "Mutual Non-Disclosure Agreement",
  "agreement_type": "NDA",
  "org_name": "IGC-Agrotech", "org_short_code": "IGCA",
  "org_state": "Maharashtra", "org_country": "India",
  "counterparties": [
    { "name": "Royal Cashews", "code": "C-009", "country": "India",
      "email": "legal@royal.com", "phone": "+91…",
      "badge": "Customer", "referred": "Buyer",
      "source_type": "customer", "source_id": "C-009" }
  ],
  "eff_date": "2026-06-01", "end_date": "2027-05-31",
  "auto_renewal": true, "renewal_type": "auto",
  "content": "<p>…</p>",
  "header_config": { … }, "footer_config": { … },
  "approvers": [ { "name": "Parth Shah", "email": "parth@igc.com",
                   "role": "Legal Head", "mandatory": true } ],
  "days_to_approve": 5, "reminder_days": 2 }
```

| Field | Rule |
|---|---|
| `title` | **required** · max 255 |
| `agreement_type` | optional · max 255 |
| `org_*` | optional — "Our Organisation" from the Company Details master |
| `counterparties` | optional array; each entry carries `source_type` + `source_id` for live refresh |
| `approvers` | optional array; each is normalised to `{name, email(lowercased), role, mandatory, status:'pending', acted_at:null}` |
| `days_to_approve` / `reminder_days` | optional integers — **stored but not enforced by a scheduler** |

**201** → `{ status: true, data: { …shapeList… }, code: "CTC-005" }`

On create the contract goes **straight to Stage 2** (`approval_status: pending`, `status: inprogress`, `submitted_at: now`) and version 1 is written: *"Agreement drafted & submitted for internal review"*.

### 422 — the counterparty category rule
```json
{ "message": "The given data was invalid.",
  "errors": { "counterparties": ["Customer and Consignee must be in the same category. Customer is Domestic (India) but Consignee is International."] } }
```
> The Customer and the Consignee must both be Domestic (country = India) or both International. **Supplier is exempt.** The rule only fires when both a Customer and a Consignee are present, and it is enforced server-side on `store()` **and** `update()`.

### Code allocation
`CTC-NNN` is allocated under a `clients` row lock, **per branch**, using `count()+1` over `withTrashed()` so soft deletes never create a gap.

---

## 5. GET / PUT / DELETE `/clm/ctc-contracts/{id}`

- **GET** returns the full contract with counterparties refreshed from their live master records, all audit arrays converted to IST, the approval rounds, the clarification thread and the version list.
- **PUT** accepts `title`, `agreement_type`, `content`, `header_config`, `footer_config`, `counterparties`, `eff_date`, `end_date` — and re-runs the category rule when `counterparties` is present.
- **DELETE** soft-deletes.

> Lookups are `where('client_id', …)->findOrFail()` — tenant-scoped, but **not** branch-scoped. Any user in the tenant can open any contract by id.

---

## 6. APPROVAL ENDPOINTS

### POST `/{id}/approve`
No body. The caller must be a named approver (matched by **email**; the `primary_approver_email` slot is the legacy fallback).

**200** → `{ status: true, data: { …shapeApprove… } }`

**403**
```json
{ "status": false, "message": "You are not an approver for this agreement." }
```

**The arithmetic:** the caller's entry is stamped `approved` + `acted_at`. Only when **every** approver has approved does `approval_status` become `approved`. A partial approval keeps `approval_status: pending` and writes the audit note *"X approved (1 of 2) — awaiting remaining approvers"*.

> Contracts created before per-approver tracking (empty `approvers`) approve outright on one call.

### POST `/{id}/reject`
```json
{ "reason": "Clause 7 conflicts with our standard indemnity." }
```
`reason` is **required** (max 1000).

One rejection sets `approval_status: rejected` — but `status` stays **`inprogress`**, so the sender can revise and resubmit repeatedly.

### POST `/{id}/clarify`
```json
{ "query": "Which entity signs on the consignee side?" }
```
Appends `{query, by, date, response: "", resolved: false}` to the **shared** thread and sets `approval_status: clarification`. Any approver may add to the same thread.

### POST `/{id}/respond`
```json
{ "response": "Royal Logistics FZE — their MD signs." }
```
The **sender** answers the newest entry that has no response yet. A separate `response_date` is stamped so the Review Timeline shows the real answer time rather than reusing the question's timestamp.

> Each of these four fires a `CtcApprovalUpdated` broadcast (Laravel Reverb), deferred until after the response, so other approvers' screens update live. A Reverb outage never fails the request.

---

## 7. LIFECYCLE ENDPOINTS

### POST `/{id}/resubmit`
Revise and re-send for internal review — used both after an internal rejection **and** after a counterparty declined the e-signature. Either way the contract re-enters Stage 2 and **any live signing request is cleared**: a decline can never go straight back to Zoho. Repeatable.

Accepts the full edit payload (`content`, `title`, `agreement_type`, `header_config`, `footer_config`, `counterparties`, …) or just `content`.

### POST `/{id}/send-for-signing`
```json
{ "recipients": [ { "name": "M. Iyer", "email": "md@royal.com",
                    "role": "Managing Director", "contact": "+91…" } ],
  "days_to_sign": 14 }
```
**422** when not yet approved:
```json
{ "status": false, "message": "Agreement must be approved before sending for signing." }
```
On success: `stage → 3`, recipients stored with `signed: false`.

### POST `/{id}/record-signature`
```json
{ "index": 0 }          // or { "email": "md@royal.com" }   or { "all": true }
```
**422** → `"No signing recipients to mark."` / `"Specify which recipient signed."`
**200** → `{ status: true, data: {…}, allSigned: true|false }`

When every recipient is signed, `cp_signed_date` is stamped and a *"Agreement signed by all parties"* version is appended.

### POST `/{id}/move-to-repository`
**422** when incomplete:
```json
{ "status": false, "message": "All parties must sign before moving to the repository." }
```
On success: `stage → 4`, `status → signed`.

---

## 8. AUDIT ENDPOINTS

### GET `/{id}/versions`
```json
{ "status": true,
  "data": [
    { "v": 1, "label": "Agreement drafted & submitted for internal review",
      "status": "Under Review", "date": "20 Jul 2026 21:12", "by": "Anita Desai" },
    { "v": 2, "label": "Rejected by Parth Shah — Clause 7 conflicts…",
      "status": "Rejected", "date": "21 Jul 2026 11:30", "by": "Parth Shah",
      "reason": "Clause 7 conflicts…" },
    { "v": 3, "label": "Revised draft resubmitted for internal review",
      "status": "Under Review", "date": "22 Jul 2026 09:05", "by": "Anita Desai" }
  ] }
```
Version history is **append-only** — entries are never rewritten. Dates are converted from stored UTC to IST.

### GET `/{id}/versions/{v}/download`
Streams that snapshot rendered to PDF with the page shell and footer page numbers. `memory_limit` is raised to 1 GB and `set_time_limit(300)` because 200–300-page agreements otherwise exhaust the defaults. **404** when the version number does not exist.

---

## 9. LOOKUP ENDPOINTS

| Endpoint | Returns |
|---|---|
| `GET /clm/ctc-contracts/approver-candidates` | The users who may be named as approvers |
| `GET /clm/ctc-contracts/contact-persons` | Contact people on the selectable counterparties, with their addresses |
| `GET /clm/ctc-contracts/placeholder-values` | The `{{party.*}}` / `{{org.*}}` token values available to the editor |

---

## 10. E-SIGNATURE

| Endpoint | Purpose |
|---|---|
| `POST /clm/signature-requests/ctc-preview` | Render the contract PDF as it will be sent |
| `POST /clm/signature-requests/ctc-send` | Create the Zoho Sign request (the org signature is stamped in) |
| `GET /clm/ctc-contracts/{id}/sync-signature` | Poll Zoho and refresh the Review Timeline |
| `POST /clm/ctc-contracts/{id}/remind-signing` | Nudge the counterparty |

`sync-signature` feeds the **same** Review Timeline as `GET /{id}`, so both go through the shared `CtcAuditTime` converter — when they didn't, the timeline shifted by 5:30 depending on which endpoint the SPA had last polled (CBC-574).

A counterparty **decline** stamps `signature_declined_at` and routes the contract back through `resubmit` → Stage 2.

---

## 11. QUICK REFERENCE

```
POST /clm/ctc-contracts                       # draft → Stage 2, CTC-NNN allocated
GET  /clm/ctc-contracts/to-approve            # the approver's inbox
POST /clm/ctc-contracts/{id}/approve          # …until ALL approvers have approved
POST /clm/ctc-contracts/{id}/reject           # { reason } — blocks; sender may revise
POST /clm/ctc-contracts/{id}/clarify          # { query } — shared thread
POST /clm/ctc-contracts/{id}/respond          # { response } — sender answers
POST /clm/ctc-contracts/{id}/resubmit         # back to Stage 2, clears any signing request
POST /clm/ctc-contracts/{id}/send-for-signing # requires approved → Stage 3
POST /clm/signature-requests/ctc-send         # or send via Zoho
POST /clm/ctc-contracts/{id}/record-signature # mark recipients signed
POST /clm/ctc-contracts/{id}/move-to-repository  # requires ALL signed → Stage 4
GET  /clm/ctc-contracts/{id}/versions         # the append-only audit trail
```

---

## 12. NOTES (caveats)

1. `CTC-NNN` is **branch-scoped**, allocated with `count()+1` over `withTrashed()`.
2. Lookups are tenant-scoped but **not** branch-scoped — any user in the tenant can open any contract by id.
3. Only a **named approver** (by email) may approve or reject; there is no role or hierarchy routing.
4. All approvers must approve; **one rejection blocks** the contract but leaves it workable.
5. The Customer/Consignee **category rule** is enforced server-side on create and update; Supplier is exempt.
6. `resubmit` always clears a live signing request.
7. `days_to_approve` / `reminder_days` / `days_to_sign` are stored but **not enforced**.
8. `record-signature` and `move-to-repository` are manual, sender-driven actions.
9. Version history is append-only and unpruned; `versions` grows with every state change.
10. Audit timestamps are stored UTC and converted to IST on read via the shared `CtcAuditTime` helper.
11. Counterparties are refreshed from their live masters on read — factual fields overlay, the user's `referred` alias and `badge` are preserved.

---

*Related documents: CASE_TO_CASE_FUNCTIONAL_DOCUMENTATION.md · CASE_TO_CASE_TECHNICAL_DOCUMENTATION.md · CASE_TO_CASE_CODE_WALKTHROUGH.md*
