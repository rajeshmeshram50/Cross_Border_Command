# QUALITY & COMPLIANCE DOCS (QC) — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Quality & Compliance Docs**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.quality_docs` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on the GET.
- Success: `{ status: true, data, counts }` · Failure: `{ status: false, message, errors?, used_in? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · 409 · 422.

> The authority column on this master is **`issued_by`**, not `authority`.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/qc-documents` | List + cert/comp counts + resolved authority names + `in_use` |
| POST | `/clm/qc-documents` | Create (`QC-NNN` auto-allocated) |
| PUT | `/clm/qc-documents/{id}` | Update |
| DELETE | `/clm/qc-documents/{id}` | Hard delete (blocked while referenced) |

**Read-through endpoints that also return QC rows**

| Method | Path | Shape |
|---|---|---|
| GET | `/clm/segment-rules/bootstrap` | `data.qc[]` with `issued_by` (names) **and** `authority_list` (array) |
| GET | `/clm/segment-rules/for-segment/{segmentId}` | `data.qc[]` filtered to the rule's codes, each stamped `requirement: "M"\|"O"` |

---

## 3. GET `/clm/qc-documents`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 9, "client_id": 3, "branch_id": 2,
      "code": "QC-003",
      "name": "HACCP Certification",
      "purpose": "Attests that the facility operates a validated food-safety hazard control system.",
      "issued_by": "3",
      "issued_by_names": "FSSAI",
      "doc_type": "cert",
      "qa_params": "CCP monitoring records, microbial load, temperature logs",
      "min_criteria": "All CCPs within limits for 3 consecutive audits",
      "status": "active",
      "created_by": 55, "updated_by": 55,
      "created_at": "2026-06-06T11:20:05.000000Z",
      "updated_at": "2026-06-06T11:20:05.000000Z",
      "in_use": true,
      "used_in": ["Segment Rules", "Product QC Records"] }
  ],
  "counts": { "all": 14, "cert": 9, "comp": 5 }
}
```

| Field | Meaning |
|---|---|
| `code` | Immutable `QC-NNN`; what rules and uploads store |
| `purpose` | Required one-liner — what the certificate attests |
| `issued_by` | Raw storage — a comma-joined list of **authority ids** (max 255 chars) |
| `issued_by_names` | The same list resolved to current names |
| `doc_type` | `cert` (formal certificate) \| `comp` (compliance document) |
| `qa_params` | Free text — the testing parameters covered |
| `min_criteria` | Free text — minimum acceptance thresholds |
| `counts` | Drives the All / Certificates / Compliance Docs tabs |
| `in_use` / `used_in` | Delete would 409; `used_in` names the referencing areas |

Ordering is `id ASC`. Rows are branch-scoped.

---

## 4. POST `/clm/qc-documents`

```json
{ "name": "ISO 9001:2015",
  "purpose": "Certifies a documented quality management system.",
  "issued_by": "8",
  "doc_type": "cert",
  "qa_params": "Process audit, document control, corrective actions",
  "min_criteria": "No major non-conformities in the certification audit",
  "status": "active" }
```

| Field | Rule |
|---|---|
| `name` | required · string · max 255 · unique (case-insensitive) **within your scope** |
| `purpose` | **required** · string · max 500 |
| `issued_by` | required · string · max 255 · comma-joined **ids or names** |
| `doc_type` | optional · `cert` \| `comp` (default `cert`) |
| `qa_params` | optional · string · max 256 |
| `min_criteria` | optional · string · max 256 |
| `status` | optional · `active` \| `inactive` (default `active`) |

`issued_by` is normalised server-side: ids and names both resolve, matching is case-insensitive, duplicates collapse, unknown tokens are **dropped**.

**201** → `{ status:true, data: { …row…, "code": "QC-015", "issued_by": "8" } }`

**422 — duplicate name**
```json
{ "status": false,
  "message": "A QC document named \"ISO 9001:2015\" already exists. Pick a different name.",
  "errors": { "name": ["A QC document named \"ISO 9001:2015\" already exists. Pick a different name."] } }
```

**422 — no authority resolved**
```json
{ "message": "The given data was invalid.",
  "errors": { "issued_by": ["Select a valid authority."] } }
```

**403 — no tenant** → `{ "status": false, "message": "No tenant context for this user" }`

---

## 5. PUT `/clm/qc-documents/{id}`

Same fields, all `sometimes|required`. `code` is immutable.

**200** → `{ status:true, data: { …fresh row… } }`

There is **no in-use edit lock**, but note one consequence unique to QC: `product_qc_records.qc_name` references this row **by name**, and nothing cascades a rename. Renaming a QC entry silently detaches it from existing product QC records. (Segment rules and vault uploads are code-linked and therefore unaffected.)

**422 — rename collides**
```json
{ "status": false,
  "message": "Another QC document named \"HACCP Certification\" already exists. Pick a different name.",
  "errors": { "name": ["…"] } }
```

**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — it was created by another Branch." }
```

---

## 6. DELETE `/clm/qc-documents/{id}`

**200** → `{ status: true, message: "Deleted" }` (hard delete)

**409 — referenced**
```json
{ "status": false,
  "message": "This QC document is in use by Segment Rules, Segment Doc Uploads, Product QC Records. Remove or reassign those records before deleting.",
  "used_in": ["Segment Rules", "Segment Doc Uploads", "Product QC Records"] }
```

| `used_in` label | Source | Match |
|---|---|---|
| `Segment Rules` | `clm_segment_rules.doc_selections` | by **code**, scoped to `client_id` |
| `Segment Doc Uploads` | `segment_doc_uploads.doc_code` | by **code**, scoped to `client_id` |
| `Product QC Records` | `product_qc_records.qc_name` | by **name**, scoped via a join to `products.client_id` |

> Unlike KYC, DD and Trade Licenses, **QC's usage check is correctly scoped by `client_id`** — another tenant's `QC-001` can never block your delete.

---

## 7. HOW QC ROWS APPEAR ELSEWHERE

### In the Document Control Panel bootstrap
```json
{ "data": { "qc": [
    { "id": 9, "code": "QC-003", "name": "HACCP Certification",
      "purpose": "Attests that the facility operates a validated food-safety hazard control system.",
      "issued_by": "FSSAI",
      "authority_list": ["FSSAI"],
      "doc_type": "cert", "status": "active" } ] } }
```
Note the resolved names land on **`issued_by`** (overwriting the id string), while the array form is exposed as `authority_list` — the same key the other three catalogues use, so `AuthorityBadges` works uniformly.

### In the rule (only the code is stored)
```json
{ "doc_selections": { "qc": { "QC-003": "M", "QC-007": "O" } } }
```

### Read back for a party form
```json
{ "data": { "qc": [
    { "id": 9, "code": "QC-003", "name": "HACCP Certification",
      "purpose": "…", "doc_type": "cert", "status": "active",
      "requirement": "M" } ] } }
```

### In the Evidence Vault
```json
{ "category": "qc", "doc_code": "QC-003",
  "doc_name": "HACCP Certification", "requirement": "M",
  "attachment_name": "haccp-2026.pdf", "expiry_date": "2027-06-30" }
```

---

## 8. QUICK REFERENCE

```
GET    /clm/authorities                       # 1. the certifying bodies must exist first
POST   /clm/qc-documents                      # 2. { name, purpose, issued_by, doc_type?, qa_params?, min_criteria? }
GET    /clm/segment-rules/bootstrap           # 3. the DCP modal lists your QC docs
POST   /clm/segment-rules                     #    doc_selections.qc = { "QC-003": "M" }
GET    /clm/segment-rules/for-segment/{id}    # 4. party forms read the required list
POST   /segment-uploads/{type}/{id}           # 5. the party uploads the certificate (+ expiry_date)
DELETE /clm/qc-documents/{id}                 #    409 + used_in while referenced
```

---

## 9. NOTES (caveats)

1. The authority column is **`issued_by`** (resolved as `issued_by_names`), not `authority`.
2. `purpose` is **required** — the only one of the four catalogues to demand it.
3. `doc_type` defaults to `cert`; the `cert`/`comp` split drives the response's `counts` object.
4. `code` is immutable and branch-sequenced (`QC-NNN`).
5. **The usage check is client-scoped** — the correct implementation among the four catalogues.
6. `product_qc_records` links **by name**, so a rename detaches existing product records; there is no cascade.
7. `issued_by` is capped at 255 characters; `qa_params` / `min_criteria` at 256 each.
8. There is no expiry descriptor in the master; certificate expiry lives on `segment_doc_uploads.expiry_date`.
9. Deletes are hard; there is no restore.

---

*Related documents: QUALITY_COMPLIANCE_DOCS_FUNCTIONAL_DOCUMENTATION.md · QUALITY_COMPLIANCE_DOCS_TECHNICAL_DOCUMENTATION.md · QUALITY_COMPLIANCE_DOCS_CODE_WALKTHROUGH.md*
