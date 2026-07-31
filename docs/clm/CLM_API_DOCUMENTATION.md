# CLM MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Central Legal Module
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation (module-wide index) |

---

## 1. CONVENTIONS

- Every CLM route sits inside `Route::middleware(['auth:sanctum','user.active'])`.
- The Axios client auto-injects `?branch_id=<active>` on **all GETs** — every CLM index honours it (only for roles that may switch: client_admin / client_user).
- `client_id` is **always** derived from `auth()->user()` — never accepted from the body.
- Success envelope: `{ "status": true, "data": …, "count"|"counts": … }`
- Failure envelope: `{ "status": false, "message": "…", "errors"?: {field:[…]}, "used_in"?: […] }`
- Status codes in use: **200 · 201 · 401 · 403 · 404 · 409 · 422 · 500 · 503**
  - **409** = referential conflict (row in use, duplicate rule, in-use type)
  - **422** = validation, or a business lock (signed/in-use document, oversized render)
  - **503** = Zoho Sign not configured

---

## 2. ENDPOINT INDEX

### 2.1 Compliance masters — identical shape ×6
| Method | Path |
|---|---|
| GET · POST | `/clm/segments` · `/clm/authorities` · `/clm/kyc-documents` · `/clm/dd-documents` · `/clm/trade-licenses` · `/clm/qc-documents` |
| PUT · DELETE | `…/{id}` |

### 2.2 Document Control Panel
| Method | Path |
|---|---|
| GET | `/clm/segment-rules` · `/clm/segment-rules/bootstrap` · `/clm/segment-rules/for-segment/{segmentId}` |
| POST | `/clm/segment-rules` |
| PUT · DELETE | `/clm/segment-rules/{id}` |

### 2.3 Trade Documents
| Method | Path |
|---|---|
| GET · POST · PUT · DELETE | `/clm/trade-doc-names[/{id}]` |
| GET · POST · PUT · DELETE | `/clm/trade-doc-library[/{id}]` |
| GET | `/clm/trade-doc-library/{id}/download` · `/download-pdf` · `/for-party/{party}` |
| POST | `/clm/trade-doc-library/{id}/upload-docx` · `/clm/trade-doc-library/upload-header-logo` · `/clm/docx-to-html` |

### 2.4 Agreements
| Method | Path |
|---|---|
| GET · POST · PUT · DELETE | `/clm/agreement-types[/{id}]` · `/clm/agreement-library[/{id}]` |
| GET | `/clm/agreement-library/{id}/download` · `/download-pdf` |
| POST | `/clm/agreement-library/{id}/upload-docx` · `/clm/agreement-library/upload-header-logo` |
| GET | `/clm/leads/{leadId}/agreement-applicable` |

### 2.5 Clauses & T&C
| Method | Path |
|---|---|
| GET · POST · PUT · DELETE | `/clm/clause-types[/{id}]` · `/clm/clause-library[/{id}]` |
| GET · POST · PUT · DELETE | `/clm/tnc-categories[/{id}]` · `/clm/tnc-library[/{id}]` |

### 2.6 E-signature
| Method | Path |
|---|---|
| POST | `/clm/signature-requests/preview` · `/clm/signature-requests` (send) |
| POST | `/clm/signature-requests/agreement-preview` · `/agreement-send` · `/sales-doc-send` · `/ctc-preview` · `/ctc-send` |
| GET | `/clm/signature-requests[?sync=true]` · `/{id}` |
| POST | `/clm/signature-requests/{id}/remind` · `/recall` |
| GET | `/clm/signature-requests/{id}/download-file/{index}` · `/view-file/{index}` · `/certificate` · `/declined-file` |

### 2.7 Case-to-Case
| Method | Path |
|---|---|
| GET · POST | `/clm/ctc-contracts` |
| GET | `/sent` · `/to-approve` · `/approver-candidates` · `/contact-persons` · `/placeholder-values` |
| GET · PUT · DELETE | `/clm/ctc-contracts/{id}` |
| POST | `/{id}/approve` · `/reject` · `/clarify` · `/respond` · `/resubmit` · `/send-for-signing` · `/record-signature` · `/move-to-repository` · `/remind-signing` |
| GET | `/{id}/versions` · `/{id}/versions/{v}/download` · `/{id}/sync-signature` |

### 2.8 Oversight
| Method | Path |
|---|---|
| GET | `/clm/buyer-profile` · `/clm/supplier-profile` · `/clm/regulatory-defense` · `/clm/diagnosis-resolution` |
| POST | `/clm/diagnosis-resolution/escalate` |

### 2.9 Evidence Vault (shared with Sales / P2P)
| Method | Path |
|---|---|
| GET | `/segment-uploads/{type}/{id}` · `/summary` · `/vault` · `/segment-uploads/download` |
| POST | `/segment-uploads/{type}/{id}` |
| DELETE | `/segment-uploads/{type}/{id}/{uploadId}` |

---

## 3. THE SHARED MASTER CONTRACT

Every one of the six compliance masters behaves identically — only the field set changes.

### GET `/clm/{master}?branch_id=`
```json
{ "status": true,
  "data": [ { "id": 12, "code": "KYC-003", "name": "GST Certificate",
              "authority": "4, 9", "authority_names": "GST Department, State VAT",
              "expiry": "N/A", "status": "active",
              "branch_id": 2, "in_use": true, "used_in": ["Segment Rules"] } ],
  "count": 1 }
```

### POST `/clm/{master}`
Field sets:

| Master | Body |
|---|---|
| `segments` | `{ name, regulatory_status: highly\|less, buyer_consignee: allowed\|not_allowed, status? }` |
| `authorities` | `{ name, description, status? }` |
| `kyc-documents` / `dd-documents` | `{ name, authority, expiry?, status? }` |
| `trade-licenses` | `{ name, authority, validity?, status? }` |
| `qc-documents` | `{ name, purpose, issued_by, doc_type?: cert\|comp, qa_params?, min_criteria?, status? }` |

`authority` / `issued_by` accept a comma-joined list of **ids or names**; the server normalises to canonical ids and returns 422 if none resolve.

**201** → `{ status:true, data:{…row with generated code…} }`

### PUT `/clm/{master}/{id}`
Same fields, all `sometimes|required`. **403** when `hierarchicalDenial` fires. Segment additionally returns **409/422** if name or tier changes while referenced.

### DELETE `/clm/{master}/{id}`
**200** `{ status:true, message:"Deleted" }` or **409**:
```json
{ "status": false,
  "message": "This KYC document is in use by Segment Rules, Segment Doc Uploads. Remove or reassign those records before deleting.",
  "used_in": ["Segment Rules", "Segment Doc Uploads"] }
```

---

## 4. KEY NON-CRUD ENDPOINTS

### GET `/clm/segment-rules/bootstrap`
One call returns every master the DCP modal needs, branch-scoped, with authorities pre-resolved:
```json
{ "status": true,
  "data": { "segments": [...], "authorities": [...],
            "kyc": [ { "code":"KYC-001", "authority":"UIDAI",
                       "authority_list":["UIDAI"], ... } ],
            "dd": [...], "tl": [...], "qc": [...] } }
```
`td` is intentionally absent — trade documents were removed from the panel.

### GET `/clm/segment-rules/for-segment/{segmentId}?document_type=domestic|international`
Always **200**, even when no rule exists:
```json
{ "status": true,
  "data": { "rule": { "rule_code":"SR-004", "document_type":"international", ... } | null,
            "kyc": [ { "id":3, "code":"KYC-003", "name":"GST Certificate",
                       "authority":"GST Department", "authority_list":["GST Department"],
                       "requirement":"M" } ],
            "dd": [...], "tl": [...], "qc": [...] } }
```

### POST `/clm/segment-rules`
```json
{ "segment_code": "SG-002", "regulatory_status": "highly",
  "document_type": "international",
  "auths": ["AUTH-001","AUTH-004"],
  "doc_selections": { "kyc": {"KYC-001":"M","KYC-004":"O"},
                      "dd": {"DD-002":"M"}, "tl": {}, "qc": {"QC-003":"O"} } }
```
**409** when a rule already exists for that (segment, document_type):
```json
{ "status": false,
  "message": "A International rule already exists for segment SG-002 (SR-004). Edit the existing rule instead.",
  "existing": { … } }
```

### POST `/clm/signature-requests`
```json
{ "trade_doc_ids": [12, 15],
  "party_id": 88, "model_name": "Customer", "lead_id": 341,
  "signers": [ { "name":"A. Rao", "email":"a@buyer.com", "order":1, "role":"buyer" } ],
  "expiry_days": 30, "is_sequential": false, "notes": "Please sign",
  "document_settings": { "12": { "x":380,"y":720,"page":0,"width":150,"height":45 } },
  "header_config_overrides": { "12": {…} },
  "content_overrides": { "12": "<p>…</p>" },
  "purchase_order_id": 77 }
```
Use `agreement_ids` instead of `trade_doc_ids` for agreement sends (mutually exclusive; max 10 each; max 5 signers).

**200** → `{ status:true, message, data:{ signature_request_id, zoho_request_id, status, document_count, document_ids, document_names, signers, expiry_date, auto_submitted, testing_mode } }`
**422** mixed applicable party · **503** Zoho unconfigured · **500** send failure (message already sanitised).

### GET `/clm/signature-requests?party_id=&model_name=&document_type=&lead_id=&status[]=&sync=true`
Capped at 200 rows, newest first. `sync=true` re-polls Zoho for `inprogress` rows and for `completed` rows still missing their signed files, then re-reads the list. Every path is resolved to an absolute URL (`signed_document_url`, `certificate_url`, `signed_document_paths[].file_url`).

### GET `/clm/leads/{leadId}/agreement-applicable`
The Sales Matrix "Segment Details" feed — see [agreements/AGREEMENTS_API_DOCUMENTATION.md](document-masters/agreements/AGREEMENTS_API_DOCUMENTATION.md).

---

## 5. ERROR EXAMPLES

**409 — in-use type**
```json
{ "status": false,
  "message": "This clause type is used by 3 clauses in the Clause Library, so it can't be edited. Remove or reassign those clauses first." }
```

**422 — signed document lock**
```json
{ "status": false,
  "message": "This trade document has already been signed by the customer/consignee and can no longer be edited." }
```

**422 — oversized render**
```json
{ "status": false,
  "message": "This trade document is too large to generate as a Word file — 1.42 MB (1,489,331 characters). The limit is 1,000,000 characters (~1 MB). Please shorten or split it." }
```

**403 — hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — it was created by another Branch." }
```

**500 — sanitised Zoho failure**
```json
{ "status": false,
  "message": "This document has already been signed or is being processed in another tab or session. Refresh the page to see its current status." }
```

---

## 6. QUICK REFERENCE

```
POST /clm/authorities                       # 1. regulatory bodies
POST /clm/kyc-documents | dd | qc | trade-licenses   # 2. document catalogues
POST /clm/segments                          # 3. business segments
GET  /clm/segment-rules/bootstrap           # 4. open the DCP modal
POST /clm/segment-rules                     #    save the (segment × domestic|international) rule
GET  /clm/segment-rules/for-segment/{id}    # 5. party forms read the required-doc list
POST /segment-uploads/{type}/{id}           # 6. party uploads evidence
POST /clm/trade-doc-library | agreement-library      # 7. draft the paper
POST /clm/signature-requests                # 8. send via Zoho
GET  /clm/signature-requests?sync=true      # 9. poll status → signed PDF + certificate
GET  /clm/buyer-profile | supplier-profile  # 10. compliance scorecards
```

---

## 7. NOTES (caveats)

1. `SR-NNN` rule codes are allocated **client-wide**, every other CLM code is per branch.
2. Trade documents lock on **signed**; agreements lock on **sent**.
3. Signature requests are soft-deleted and capped at 200 per list response.
4. Signed-document URLs never fall back to the certificate URL — they are separate artifacts.
5. `escalate()` returns an ack but persists only a log line.
6. `/clm/analytics` does **not** exist — the page composes `/clm/buyer-profile` + `/clm/supplier-profile`.

---

*Related documents: CLM_FUNCTIONAL_DOCUMENTATION.md · CLM_TECHNICAL_DOCUMENTATION.md · CLM_CODE_WALKTHROUGH.md*
