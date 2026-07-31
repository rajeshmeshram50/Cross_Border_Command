# DIAGNOSIS & RESOLUTION CENTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Diagnosis & Resolution Center**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.diagnosis_resolution` gates the UI.
- Success: `{ status: true, data: … }` or `{ status: true, message: … }` · Failure: Laravel 422 for validation.
- Codes: 200 · 401 · 422.
- `index()` takes **no query parameters** — no filters, no pagination, no branch narrowing.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/diagnosis-resolution` | The combined three-block triage payload |
| POST | `/clm/diagnosis-resolution/escalate` | Raise an escalation on a blocked record |

---

## 3. GET `/clm/diagnosis-resolution`

Returns three blocks in one round-trip so the SPA can render its three sub-tabs without three separate calls.

**200**
```json
{
  "status": true,
  "data": {
    "buyer": {
      "buyers":     [ /* … */ ],
      "consignees": [ /* … */ ],
      "ws_eq":      [ /* … */ ],
      "ws_neq":     [ /* … */ ],
      "wos_eq":     [ /* … */ ],
      "wos_neq":    [ /* … */ ]
    },
    "supplier": {
      "ws_mat":  [ /* … */ ], "ws_logi":  [ /* … */ ],
      "wos_mat": [ /* … */ ], "wos_logi": [ /* … */ ], "wos_svc": [ /* … */ ],
      "txn_ws_mat":  [ /* … */ ], "txn_ws_logi":  [ /* … */ ],
      "txn_wos_mat": [ /* … */ ], "txn_wos_logi": [ /* … */ ], "txn_wos_svc": [ /* … */ ]
    },
    "ctc": [
      { "id": "CTC-004",
        "ctc": "CTC-004",
        "title": "Mutual Non-Disclosure Agreement",
        "counterparty": "Royal Cashews",
        "role": "Buyer",
        "status": "clarify" }
    ]
  }
}
```

### The `buyer` and `supplier` blocks
These are the payloads of `/clm/buyer-profile` and `/clm/supplier-profile`, **re-emitted verbatim**. The two controllers are method-injected and called **in-process** — not over HTTP — so scoping, field shapes and the five `{d, t}` document-family ratios are guaranteed identical.

For the authoritative field reference see:
- [CUSTOMER_PROFILE_API_DOCUMENTATION.md](../../operations/customer-profile/CUSTOMER_PROFILE_API_DOCUMENTATION.md)
- [SUPPLIER_PROFILE_API_DOCUMENTATION.md](../../operations/supplier-profile/SUPPLIER_PROFILE_API_DOCUMENTATION.md)

### The `ctc` block
| Field | Meaning |
|---|---|
| `id` | The contract **code** (`CTC-NNN`) — **not** the numeric primary key |
| `ctc` | The same value again |
| `title` | Contract title, `—` when blank |
| `counterparty` | The **first** counterparty's stored name, `—` when absent |
| `role` | `Buyer` \| `Supplier` \| `Partner` (see below) |
| `status` | One of **four** buckets (see below) |

Rows are ordered newest first and are `client_id`-scoped.

---

## 4. THE FOUR CTC STATUS BUCKETS

This screen surfaces **one bucket more** than the Case-to-Case list:

| Condition | This endpoint | Case-to-Case list |
|---|---|---|
| `approval_status = rejected` | `rejected` | `rejected` |
| **`approval_status = clarification`** | **`clarify`** | `inprogress` |
| `stage >= 4` or `status = signed` | `signed` | `signed` |
| otherwise | `inprogress` | `inprogress` |

Surfacing "waiting on a question" separately is the point of a triage screen — everywhere else in CLM a clarification is folded into `inprogress` or `pending`.

---

## 5. THE ROLE BADGE

`role` is normalised from the counterparty's stored `badge` (falling back to `source_type`):

| Stored value contains | `role` |
|---|---|
| `buy…` or exactly `customer` | **Buyer** |
| `supp…` or exactly `vendor` | **Supplier** |
| anything else | **Partner** |

> **Consignees are badged `Partner` here.** The Case-to-Case screen uses a finer mapping (Customer / Consignee / Supplier); this one does not distinguish consignees.

Counterparties are read from the **stored snapshot** — this endpoint does not refresh them from the live Customer / Consignee / Vendor masters, unlike the Case-to-Case screens.

---

## 6. POST `/clm/diagnosis-resolution/escalate`

```json
{ "reference": "CTC-004",
  "escalate_to": "Legal Head",
  "issue_type": "Missing mandatory KYC",
  "priority": "high",
  "message": "The GST certificate for Royal Cashews has been outstanding for 12 days and is blocking PI conversion.",
  "notify_via": ["email", "in-app"] }
```

| Field | Rule |
|---|---|
| `reference` | **required** · string · max 120 |
| `escalate_to` | **required** · string · max 120 |
| `issue_type` | **required** · string · max 120 |
| `priority` | **required** · one of `critical` \| `high` \| `medium` \| `low` |
| `message` | **required** · string · max 5000 |
| `notify_via` | optional · array of strings (max 40 chars each) |

**200**
```json
{ "status": true,
  "message": "Escalation recorded and the target has been notified." }
```

**422 — validation**
```json
{ "message": "The given data was invalid.",
  "errors": { "priority": ["The selected priority is invalid."] } }
```

### ⚠ What this endpoint actually does
> **It validates the payload, writes one `Log::info` line, and returns the acknowledgement above. Nothing else.**

| Expectation | Reality |
|---|---|
| A row in an escalations table | **No such table exists** |
| A notification record | Not created |
| Delivery over `notify_via` channels | Channels are accepted and logged, never used |
| `reference` resolves to a real record | Not validated against anything |
| "the target has been notified" | **Aspirational** — nobody is notified |

A 200 from this endpoint is **not** evidence that anyone was told. The controller's own docblock records this: *"there is no Notification model yet, so the notify-via channels are accepted but only logged."*

---

## 7. QUICK REFERENCE

```
GET  /clm/diagnosis-resolution              # three blocks in one call
     → data.buyer      (= /clm/buyer-profile payload, verbatim)
     → data.supplier   (= /clm/supplier-profile payload, verbatim)
     → data.ctc        code · title · first counterparty · role · 4-bucket status

POST /clm/diagnosis-resolution/escalate     # { reference, escalate_to, issue_type,
                                            #   priority, message, notify_via[] }
                                            # → 200 ack; persists a LOG LINE only

# drill-downs the UI links to
GET /segment-uploads/customer/{db_id}/vault
GET /segment-uploads/vendor/{supDbId}/vault
GET /clm/ctc-contracts/{id}/versions
```

---

## 8. NOTES (caveats)

1. **`escalate()` persists only an audit log line** — no escalations table, no notification, no delivery, despite the success message.
2. `index()` accepts **no query parameters**: no filters, no date range, no pagination, no branch narrowing.
3. The endpoint carries the cost of **both** profile aggregations — the two heaviest reads in CLM — on every call.
4. The `buyer` and `supplier` blocks are re-emitted verbatim from the profile controllers, which are called **in-process** via method injection; tenant scoping is inherited, not re-implemented.
5. In the `ctc` block, `id` is the contract **code**, not the numeric id.
6. Only the **first** counterparty of a contract is shown.
7. **Consignees are badged `Partner`** — the role mapping here is coarser than the Case-to-Case screen's.
8. Counterparty names come from the stored snapshot, with no live-master refresh.
9. The `ctc` block is `client_id`-scoped but **not** branch-scoped.
10. `qc` (Quality & Compliance) is not one of the tracked document families in either profile block.

---

*Related documents: DIAGNOSIS_RESOLUTION_FUNCTIONAL_DOCUMENTATION.md · DIAGNOSIS_RESOLUTION_TECHNICAL_DOCUMENTATION.md · DIAGNOSIS_RESOLUTION_CODE_WALKTHROUGH.md*
