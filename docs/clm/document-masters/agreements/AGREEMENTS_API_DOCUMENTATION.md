# AGREEMENTS — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Agreements**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.agreements` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on GETs.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message, errors? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · **409** (duplicate type) · **422** (validation, in-use lock, oversized render, unreadable upload).
- Binary endpoints (`/download`, `/download-pdf`) stream a file, not JSON.

---

## 2. ENDPOINT INDEX

### Types tab
| Method | Path |
|---|---|
| GET · POST | `/clm/agreement-types` |
| PUT · DELETE | `/clm/agreement-types/{id}` |

### Library tab
| Method | Path | Purpose |
|---|---|---|
| GET · POST | `/clm/agreement-library` | List (+`is_signed`, +`in_use`) · Create |
| PUT · DELETE | `/clm/agreement-library/{id}` | Update · Delete (in-use lock) |
| GET | `/clm/agreement-library/{id}/download` | Word file |
| GET | `/clm/agreement-library/{id}/download-pdf` | Branded PDF |
| POST | `/clm/agreement-library/{id}/upload-docx` | Upload a revised Word file |
| POST | `/clm/agreement-library/upload-header-logo` | Page-shell logo |

### Sales-Matrix feed
| Method | Path |
|---|---|
| GET | `/clm/leads/{leadId}/agreement-applicable` |

---

## 3. TYPES TAB

### GET `/clm/agreement-types`
```json
{ "status": true,
  "data": [ { "id": 4, "code": "AT-002", "name": "Supply Agreement",
              "description": "Governs recurring supply of goods.",
              "branch_id": 2, "status": "active", "in_use": 3 } ],
  "count": 6 }
```

### POST `/clm/agreement-types`
```json
{ "name": "Quality Agreement", "description": "Defines QA obligations between the parties." }
```
| Field | Rule |
|---|---|
| `name` | required · max 255 · unique (case-insensitive) **within your scope** |
| `description` | **required** · max 500 |

**201** → `{ status:true, data: { …row…, "code": "AT-007" } }`
**409** → `{ "status": false, "message": "An agreement type named \"Quality Agreement\" already exists. Pick a different name." }`

### PUT / DELETE `/clm/agreement-types/{id}`
Standard scoped update/delete with `hierarchicalDenial` (403).

---

## 4. LIBRARY TAB

### GET `/clm/agreement-library`
```json
{
  "status": true,
  "data": [
    { "id": 31, "client_id": 3, "branch_id": 2,
      "code": "A-006",
      "agreement_type": "Supply Agreement",
      "title": "Master Supply Agreement",
      "purpose": "Governs recurring supply under the Rice segment.",
      "party": "Buyer, Consignee",
      "regulatory": "highly",
      "signing": true,
      "segment": "Rice, Tobacco",
      "agr_status": "Active",
      "content": "<p>…</p>",
      "docx_path": null,
      "docx_original_name": null,
      "header_config": { … },
      "footer_config": { … },
      "status": "active",
      "is_signed": false,
      "in_use": true }
  ],
  "count": 12
}
```

| Derived flag | Meaning |
|---|---|
| **`in_use`** | A signature request of type `agreement` referencing this row is `inprogress` **or** `completed` → **Edit and Delete are blocked** |
| `is_signed` | A signature request has reached `completed` (a subset of `in_use`) |

Ordering is `id ASC`.

### POST `/clm/agreement-library`
```json
{ "agreement_type": "Supply Agreement",
  "title": "Master Supply Agreement",
  "purpose": "Governs recurring supply under the Rice segment.",
  "party": "Buyer, Consignee",
  "regulatory": "highly",
  "signing": true,
  "segment": "Rice, Tobacco",
  "agr_status": "Active",
  "content": "<p>…</p>",
  "header_config": { … },
  "footer_config": { … } }
```

| Field | Rule | Default |
|---|---|---|
| `agreement_type` | required · max 255 · **the type name** | — |
| `title` | required · max 255 | — |
| `purpose` | optional · max 1000 | null |
| `party` | required · max 255 · CSV of `Buyer` / `Consignee` / `Supplier-*` | — |
| `regulatory` | optional · `highly` \| `less` | **`less`** |
| `signing` | optional · boolean | **`true`** |
| `segment` | optional · max 1024 · CSV of segment names/codes | null |
| `agr_status` | optional · max 32 | **`Active`** |
| `content` | optional · editor HTML | null |
| `header_config` / `footer_config` | optional · array | null |

**201** → `{ status:true, data: { …row…, "code": "A-012" } }`

### PUT `/clm/agreement-library/{id}`
Same fields, all `sometimes`.

**422 — in-use lock**
```json
{ "status": false, "message": "This agreement is In-use, you cannot edit it." }
```

**403 — creator hierarchy** (branch users may view shared client-level agreements but not edit them).

> **Side effect:** when `content` changes, the previously uploaded Word file is deleted and `docx_path` / `docx_original_name` cleared — `/download` prefers the stored file and would otherwise serve a stale document.

### DELETE `/clm/agreement-library/{id}`
**200** → `{ status:true, message:"Deleted" }`
**422** → `{ "status": false, "message": "This agreement is In-use, you cannot delete it." }`

---

## 5. FILE ENDPOINTS

Behaviour is identical to the trade-document equivalents; files live under `agreement_library/c{client}/…`.

| Endpoint | Notes |
|---|---|
| GET `/clm/agreement-library/{id}/download` | Prefers the stored `docx_path`, else regenerates from `content` with the page shell. 422 over 1,000,000 characters |
| GET `/clm/agreement-library/{id}/download-pdf` | Branded PDF via `pdf.clm-signature-document`; placeholders left unresolved; same 422 cap |
| POST `/clm/agreement-library/{id}/upload-docx` | `multipart/form-data` `docx`, `.doc`/`.docx`, max **20 MB**; refreshes `content` from the converted HTML; 422 on unreadable `.doc` or oversized result |
| POST `/clm/agreement-library/upload-header-logo` | `multipart/form-data` `logo` (`png,jpg,jpeg,svg,webp`, max 5 MB) → `{ "path": "agreement_library/c3/logos/…", "url": "…" }` |

---

## 6. GET `/clm/leads/{leadId}/agreement-applicable`

The Sales Matrix lead-detail **"Segment Details"** feed. Given an opportunity it resolves the applicable agreements *and* trade documents per segment, each stamped with its live signature status.

**Resolution chain:** lead → latest non-cancelled **Proforma Invoice** (falling back to the latest non-cancelled **Quotation**) → line-item `product_id`s → `products.segment_id` → `clm_segments` → matching agreements.

**200**
```json
{
  "status": true,
  "data": {
    "stage5Complete": true,
    "buyerEqualsConsignee": false,
    "lead": {
      "id": 341, "code": "OPP-0341",
      "customer":  { "id": 88, "code": "C-009", "name": "Royal Cashews",
                     "email": "buy@royal.com", "country": "India", "segment": "Rice" },
      "consignee": { "id": 51, "code": "CN-014", "name": "Royal Logistics",
                     "email": "ops@royal.com", "country": "UAE", "segment": "Rice" }
    },
    "pi":        { "id": 402, "code": "PI/25-26/0042", "status": "sent" },
    "quotation": { "id": 377, "code": "QT/25-26/0031", "status": "converted" },
    "totals": {
      "highly": { "matched": 1, "total": 5 },
      "less":   { "matched": 2, "total": 7 }
    },
    "segments": [
      {
        "id": 14, "code": "SG-004", "name": "Rice", "regulatory": "highly",
        "agreements": [
          {
            "id": 31, "code": "A-006", "title": "Master Supply Agreement",
            "agreement_type": "Supply Agreement",
            "party": "Buyer, Consignee",
            "regulatory": "highly",
            "segment": "Rice, Tobacco",
            "required": "REQ",
            "updated_at": "2026-07-14",
            "signature_request": {
              "id": 902, "status": "inprogress",
              "sent_at": "2026-07-20T10:12:00+00:00",
              "completed_at": null,
              "signed_url": null,
              "certificate_url": null,
              "reminder_count": 2,
              "last_reminder_sent_at": "2026-07-27T06:00:00+00:00"
            },
            "content": "<p>…</p>",
            "header_config": { … },
            "footer_config": { … }
          }
        ],
        "trade_documents": [ … ]
      }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `stage5Complete` | `lead_stage_id >= 6` — the Send button stays disabled until then |
| `buyerEqualsConsignee` | No distinct consignee, or it is flagged `same_as_customer`. Equal ⇒ one flat Trade Documents list; different ⇒ Buyer / Consignee / Both tabs |
| `required` | `REQ` when `regulatory = highly`, `OPT` when `less` |
| `signature_request` | `null` until the agreement is sent; then live status + reminder counters + download links |
| `totals.*.matched` | Segments **in this lead** for that tier |
| `totals.*.total` | **Active** segments configured in the master for that tier |
| `content` / `header_config` / `footer_config` | Seed for the send modal's Edit Header/Footer/Body popup — per-send overrides layer over these and never mutate the saved row |

### Which agreements appear
An agreement is included only when **all** of these hold:
1. `agreement.regulatory === segment.regulatory_status` (tier equality),
2. the agreement's `segment` CSV contains the segment's **name or code** as a whole comma entry (so `Tobacco` never matches `Tobacco Stripping`),
3. `agr_status = 'Active'`,
4. its `party` CSV names `Buyer` or `Consignee` — supplier-only rows are excluded; a **blank** `party` is treated as universal.

A lead with neither a non-cancelled PI nor Quotation returns empty `segments` and null signature lookups.

---

## 7. HOW AGREEMENTS ARE SENT

Sending is handled by the signature controller:

```json
POST /clm/signature-requests/agreement-send
{ "agreement_ids": [31], "party_id": 88, "model_name": "Customer", "lead_id": 341,
  "signers": [ { "name": "A. Rao", "email": "a@royal.com", "order": 1, "role": "buyer" } ],
  "document_settings": { "31": { "x":380, "y":720, "page":0, "width":150, "height":45 } },
  "content_overrides": { "31": "<p>…</p>" } }
```
`POST /clm/signature-requests` also accepts `agreement_ids[]` (mutually exclusive with `trade_doc_ids[]`). Either way the request is tagged `document_type: "agreement"`, which is what flips `in_use` — and, on completion, `is_signed`.

---

## 8. QUICK REFERENCE

```
POST /clm/agreement-types                          # 1. the type catalogue
POST /clm/agreement-library                        # 2. the template (party + segment + tier)
POST /clm/agreement-library/upload-header-logo     #    page-shell logo
GET  /clm/agreement-library/{id}/download          #    edit in Word…
POST /clm/agreement-library/{id}/upload-docx       #    …and upload it back
GET  /clm/leads/{leadId}/agreement-applicable      # 3. what applies to this deal
POST /clm/signature-requests/agreement-send        # 4. send via Zoho
GET  /clm/signature-requests?document_type=agreement&lead_id=341&sync=true
                                                   # 5. poll → in_use / is_signed flip
```

---

## 9. NOTES (caveats)

1. **Agreements lock on *sent*** (`inprogress` or `completed`), not merely on signed — stricter than trade documents.
2. The lock check guards against draft-id reuse: a request only locks a template created at or before it.
3. `signing` defaults to **true**; `regulatory` to `less`; `agr_status` to `Active`.
4. Only `agr_status = 'Active'` rows are offered on a lead.
5. Segment matching is **string-based** on a CSV and is not cascaded on a segment rename (the segment master blocks such renames while referenced).
6. `applicableForLead` prefers the PI but falls back to the Quotation, so Segment Details populates as soon as products are quoted.
7. Editing `content` deletes the stored Word file so downloads regenerate from the edited HTML.
8. Render ceiling 1,000,000 characters; upload ceiling 20 MB; binary `.doc` cannot be converted.
9. `A-NNN` and `AT-NNN` restart at 001 per branch.
10. The UI relabels stored party values for display (`Buyer → Customer`, `Supplier-Material → Material`); the API always returns the stored value.

---

*Related documents: AGREEMENTS_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_CODE_WALKTHROUGH.md*
