# TRADE DOCUMENTS — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Trade Documents**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.trade_documents` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on GETs.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message, errors? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · **409** (type in use) · **422** (validation, signed lock, oversized render, unreadable upload).
- Binary endpoints (`/download`, `/download-pdf`) stream a file, not JSON.

---

## 2. ENDPOINT INDEX

### Names tab
| Method | Path |
|---|---|
| GET · POST | `/clm/trade-doc-names` |
| PUT · DELETE | `/clm/trade-doc-names/{id}` |

### Library tab
| Method | Path | Purpose |
|---|---|---|
| GET · POST | `/clm/trade-doc-library` | List (+`is_signed`) · Create |
| PUT · DELETE | `/clm/trade-doc-library/{id}` | Update · Delete (signed lock) |
| GET | `/clm/trade-doc-library/{id}/download` | Word file |
| GET | `/clm/trade-doc-library/{id}/download-pdf` | Branded PDF |
| POST | `/clm/trade-doc-library/{id}/upload-docx` | Upload a revised Word file |
| POST | `/clm/trade-doc-library/upload-header-logo` | Page-shell logo |
| GET | `/clm/trade-doc-library/for-party/{party}` | Drafts applicable to a party |
| POST | `/clm/docx-to-html` | Standalone DOCX → HTML (no row) |

---

## 3. NAMES TAB

### GET `/clm/trade-doc-names`
```json
{ "status": true,
  "data": [ { "id": 5, "code": "TDN-003", "name": "Non-GMO Declaration",
              "branch_id": 2, "status": "active", "in_use": 2 } ],
  "count": 7 }
```
`in_use` is the number of **visible** library drafts whose `name` matches (case-insensitive, trimmed). Ordering is `id DESC`.

### POST `/clm/trade-doc-names`
```json
{ "name": "Packing Declaration" }
```
The duplicate check and the insert both run inside the per-client lock, so two concurrent adds cannot both succeed.

**201** → `{ status:true, data: { …row…, "code": "TDN-008" } }`
**422** → `{ "status": false, "message": "A trade document type named \"Packing Declaration\" already exists. Pick a different name." }`

### PUT `/clm/trade-doc-names/{id}`
```json
{ "name": "Packing Declaration (Export)" }
```
**409 — in use**
```json
{ "status": false,
  "message": "This trade document type is used by 2 drafts in the Trade Document Library, so it can't be edited. Remove or reassign them first." }
```
**422** — the rename collides with another visible type.

### DELETE `/clm/trade-doc-names/{id}`
**200** → `{ status:true, message:"Deleted" }`
**409 — in use**
```json
{ "status": false,
  "message": "This trade document is used by 2 drafts in the Trade Document Library. Remove or reassign them before deleting." }
```

> The library links to a type by its **name string**, not a foreign key — which is why renaming and deleting are both blocked rather than cascaded.

---

## 4. LIBRARY TAB

### GET `/clm/trade-doc-library`
```json
{
  "status": true,
  "data": [
    { "id": 12, "client_id": 3, "branch_id": 2,
      "code": "TDL-004",
      "name": "Non-GMO Declaration",
      "title": "Declaration of Non-Genetically Modified Origin",
      "doc_type": "Declaration",
      "purpose": "Confirms the consignment contains no GM material.",
      "party": "Buyer, Consignee",
      "regulatory": "highly",
      "segment": "Food Grade Ethanol, Rice",
      "content": "<p>…</p>",
      "docx_path": "trade_doc_library/c3/t12/aB3x.docx",
      "docx_original_name": "non-gmo.docx",
      "header_config": { "logo_path": "…", "title": "…", "confidential": true },
      "footer_config": { "text": "…", "page_numbers": true },
      "status": "active",
      "is_signed": true }
  ],
  "count": 9
}
```
`is_signed` is **derived**, not stored — it is true when a `clm_signature_requests` row of type `trade_doc` referencing this draft has reached `completed`. Ordering is `id DESC`.

### POST `/clm/trade-doc-library`
```json
{ "name": "Non-GMO Declaration",
  "title": "Declaration of Non-Genetically Modified Origin",
  "doc_type": "Declaration",
  "purpose": "Confirms the consignment contains no GM material.",
  "party": "Buyer, Consignee",
  "regulatory": "highly",
  "segment": "Food Grade Ethanol, Rice",
  "content": "<p>…</p>",
  "header_config": { … },
  "footer_config": { … } }
```

| Field | Rule |
|---|---|
| `name` | required · max 255 · **the type name** from the Names catalogue |
| `title` | required · max 255 |
| `doc_type` | required · max 64 |
| `purpose` | required · max 500 |
| `party` | required · max 255 · CSV of `Buyer` / `Consignee` / `Supplier-*` |
| `regulatory` | optional · `highly` \| `less` |
| `segment` | **required** · max 500 · CSV, at least one |
| `file_path` | optional · max 500 |
| `content` | optional · the editor's HTML |
| `header_config` / `footer_config` | optional · array (same JSON shape as HR document templates) |

**201** → `{ status:true, data: { …row…, "code": "TDL-010" } }`

### PUT `/clm/trade-doc-library/{id}`
Same fields, all `sometimes`.

**422 — signed lock**
```json
{ "status": false,
  "message": "This trade document has already been signed by the customer/consignee and can no longer be edited." }
```

**403 — creator hierarchy** (branch users may view shared client-level drafts but not edit them).

> **Side effect:** when `content` changes, the previously uploaded Word file is deleted and `docx_path` / `docx_original_name` are cleared — otherwise `/download` would keep serving the stale file, which it prefers over regeneration.

### DELETE `/clm/trade-doc-library/{id}`
**200** → `{ status:true, message:"Deleted" }`
**422 — signed lock**
```json
{ "status": false,
  "message": "This trade document has already been signed by the customer/consignee and can no longer be deleted." }
```

---

## 5. FILE ENDPOINTS

### GET `/clm/trade-doc-library/{id}/download` — Word
Streams `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

Resolution order:
1. The stored `docx_path` if it exists (source of truth after a Word round-trip).
2. Otherwise a fresh DOCX generated from `content`, with the page-shell header/footer applied.

**422 — too large**
```json
{ "status": false,
  "message": "This trade document is too large to generate as a Word file — 1.42 MB (1,489,331 characters). The limit is 1,000,000 characters (~1 MB). Please shorten or split it." }
```

### GET `/clm/trade-doc-library/{id}/download-pdf`
Streams a branded PDF rendered through the shared `pdf.clm-signature-document` blade (header logo, body, footer, page numbers). Placeholders are **left unresolved** — they auto-fill only at send time, when a party is bound. Same 422 on oversize.

### POST `/clm/trade-doc-library/{id}/upload-docx`
`multipart/form-data` with a `docx` file (`.doc` or `.docx`, max **20 MB**).

**200** → `{ status:true, data: { …row with refreshed content, docx_path, docx_original_name… } }`

**422 — unreadable `.doc`**
```json
{ "status": false,
  "message": "This looks like an older .doc file, which can't be read. Open it in Word and use \"Save As → Word Document (.docx)\", then upload the .docx." }
```
**422 — no readable content**
```json
{ "status": false,
  "message": "We couldn't read any content from this Word file. Make sure it's a valid .docx that contains text, then try again." }
```
**422 — too large after conversion** — same shape as the download cap; the stored file is deleted.

> Validation checks **file + size + client extension**, deliberately not `mimes:doc,docx`: a `.docx` is a ZIP container and php-fileinfo commonly reports it as `application/zip`, which would reject valid Word files.

### POST `/clm/docx-to-html`
Standalone conversion with no library row and no persistence — used by editors not backed by a saved record (e.g. the CTC draft editor's "Upload Doc").

**200** → `{ "status": true, "html": "<p>…</p>" }`
**422** → `{ "status": false, "message": "Could not read this document." }`

### POST `/clm/trade-doc-library/upload-header-logo`
`multipart/form-data` with a `logo` file (`png,jpg,jpeg,svg,webp`, max 5 MB).

**200** → `{ "path": "trade_doc_library/c3/logos/aB3x.png", "url": "https://…/storage/…" }`

The path is not attached to a row here — it lands inside `header_config` when the form is saved, so the endpoint works for brand-new drafts too.

---

## 6. GET `/clm/trade-doc-library/for-party/{party}`

Lists drafts whose `party` CSV mentions the given key. Used by the customer / consignee / supplier forms.

| `{party}` | Matches |
|---|---|
| `buyer` or `customer` | `party LIKE '%Buyer%'` |
| `consignee` | `party LIKE '%Consignee%'` |
| `supplier` | `party LIKE '%Supplier-%'` (any sub-type) |
| anything else | `party LIKE '%{party}%'` (literal substring) |

**200** → `{ status:true, data:[ …rows… ], count: 4 }` (ordered `id ASC`)

> **Caveat:** this endpoint is **client-scoped only** — it does not apply the branch read scope the main list uses.

---

## 7. HOW TRADE DOCUMENTS ARE SENT

Sending is handled by the signature controller, not this one:

```json
POST /clm/signature-requests
{ "trade_doc_ids": [12, 15],
  "party_id": 88, "model_name": "Customer", "lead_id": 341,
  "signers": [ { "name": "A. Rao", "email": "a@buyer.com", "order": 1, "role": "buyer" } ],
  "document_settings": { "12": { "x":380,"y":720,"page":0,"width":150,"height":45 } },
  "header_config_overrides": { "12": { … } },
  "content_overrides": { "12": "<p>…</p>" } }
```
- Max **10** documents, max **5** signers.
- All documents in one request must target the **same applicable party** — a mixed Buyer/Consignee bundle returns 422.
- Per-document overrides never mutate the saved row; they apply only to the PDFs shipped to Zoho.
- The resulting request is tagged `document_type: "trade_doc"`, which is what flips `is_signed` once it completes.

---

## 8. QUICK REFERENCE

```
POST /clm/trade-doc-names                        # 1. the type catalogue
POST /clm/trade-doc-library                      # 2. the draft (segment REQUIRED)
POST /clm/trade-doc-library/upload-header-logo   #    page-shell logo
GET  /clm/trade-doc-library/{id}/download        #    edit in Word…
POST /clm/trade-doc-library/{id}/upload-docx     #    …and upload it back
GET  /clm/trade-doc-library/{id}/download-pdf    #    branded preview
GET  /clm/trade-doc-library/for-party/buyer      # 3. what applies to this party
POST /clm/signature-requests                     # 4. send via Zoho (trade_doc_ids[])
GET  /clm/signature-requests?sync=true           # 5. poll → is_signed flips → draft locks
```

---

## 9. NOTES (caveats)

1. The Names ↔ Library link is by **name string**, so a type in use can be neither renamed nor deleted (409).
2. Trade documents lock on **signed** (`completed`); agreements lock earlier, on **sent**.
3. The lock check guards against draft-id reuse — a request only locks a draft created at or before it.
4. Editing `content` deletes the stored Word file so downloads regenerate from the edited HTML.
5. Render ceiling is 1,000,000 characters (~1 MB of HTML) for both PDF and Word.
6. Upload ceiling is 20 MB; binary `.doc` files cannot be converted.
7. `/for-party/{party}` is client-scoped only, unlike the branch-scoped main list.
8. `TDL-NNN` and `TDN-NNN` restart at 001 per branch; legacy `TD-` codes were migrated to `TDL-`.
9. There is no version history — editing a draft overwrites it.

---

*Related documents: TRADE_DOCUMENTS_FUNCTIONAL_DOCUMENTATION.md · TRADE_DOCUMENTS_TECHNICAL_DOCUMENTATION.md · TRADE_DOCUMENTS_CODE_WALKTHROUGH.md*
