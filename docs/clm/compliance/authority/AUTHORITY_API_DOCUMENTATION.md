# AUTHORITY — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Authority**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.authority` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on the GET.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message, errors?, used_in? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · 409 · 422.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/authorities` | List + per-row `in_use` |
| POST | `/clm/authorities` | Create (`AUTH-NNN` auto-allocated) |
| PUT | `/clm/authorities/{id}` | Update (rename cascades to legacy tables) |
| DELETE | `/clm/authorities/{id}` | Hard delete (blocked while referenced) |

---

## 3. GET `/clm/authorities`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 12, "client_id": 3, "branch_id": 2,
      "code": "AUTH-003", "name": "FSSAI",
      "description": "Food Safety and Standards Authority of India — licences and certifies food businesses.",
      "status": "active",
      "created_by": 55, "updated_by": 55,
      "created_at": "2026-06-02T07:40:12.000000Z",
      "updated_at": "2026-06-02T07:40:12.000000Z",
      "in_use": true }
  ],
  "count": 18
}
```

`in_use` is true when the authority's **id** appears in any CLM document master, its **name** appears in a legacy party-document table, or its **code** appears in a segment rule's `auths_json`. It disables Delete only — Edit stays available.

Ordering is `id ASC`.

---

## 4. POST `/clm/authorities`

```json
{ "name": "DGFT",
  "description": "Directorate General of Foreign Trade — issues IEC and export authorisations.",
  "status": "active" }
```

| Field | Rule |
|---|---|
| `name` | required · string · max 255 · unique (case-insensitive) **within your scope** |
| `description` | **required** · string · max 500 |
| `status` | optional · `active` \| `inactive` (default `active`) |

**201** → `{ status:true, data: { …row…, "code": "AUTH-019" } }`

**422 — duplicate name**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["An authority named \"DGFT\" already exists. Pick a different name."] } }
```

**403 — no tenant** → `{ "status": false, "message": "No tenant context for this user" }`

---

## 5. PUT `/clm/authorities/{id}`

```json
{ "name": "Food Safety and Standards Authority of India",
  "description": "…", "status": "active" }
```
All fields `sometimes|required`. `code` is immutable.

**200** → `{ status:true, data: { …fresh row… } }`

### Rename side effects
| Storage style | Tables | What happens |
|---|---|---|
| **id** | `clm_kyc_documents.authority`, `clm_dd_documents.authority`, `clm_trade_licenses.authority`, `clm_qc_documents.issued_by` | **Nothing** — the name is resolved live from the id on every read |
| **name** | `vendor_documents.issuing_authority`, `customer_documents.issuing_authority`, `vendor_owners.issuing_authority` | **Rewritten** by `cascadeRename()`, scoped to the tenant, inside the same transaction |
| **code** | `clm_segment_rules.auths_json` | Nothing — codes are immutable |

**422 — rename collides**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["Another authority named \"DGFT\" already exists. Pick a different name."] } }
```

**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — it was created by a Client Admin." }
```

---

## 6. DELETE `/clm/authorities/{id}`

**200** → `{ status: true, message: "Deleted" }`

**409 — referenced**
```json
{ "status": false,
  "message": "This authority is in use by KYC Documents, Trade Licenses, Segment Rules. Remove or reassign those records before deleting.",
  "used_in": ["KYC Documents", "Trade Licenses", "Segment Rules"] }
```

Possible `used_in` labels:

| Label | Source |
|---|---|
| `KYC Documents` | `clm_kyc_documents.authority` (by id) |
| `Due Diligence Documents` | `clm_dd_documents.authority` (by id) |
| `Trade Licenses` | `clm_trade_licenses.authority` (by id) |
| `Quality & Compliance Docs` | `clm_qc_documents.issued_by` (by id) |
| `Vendor Documents` | `vendor_documents.issuing_authority` (by name) |
| `Customer Documents` | `customer_documents.issuing_authority` (by name) |
| `Vendor Owners` | `vendor_owners.issuing_authority` (by name) |
| `Segment Rules` | `clm_segment_rules.auths_json` (by code) |

---

## 7. HOW OTHER ENDPOINTS EXPOSE AUTHORITIES

Any endpoint that returns a document referencing authorities ships **two** representations:

```json
{ "code": "KYC-003",
  "name": "GST Certificate",
  "authority": "GST Department, State VAT Office",     // display string
  "authority_list": ["GST Department", "State VAT Office"]   // ← use THIS to count/iterate
}
```

> **Never split `authority` on commas.** An authority name may itself contain commas (e.g. `"Aadhaar, Passport, Voter ID, Driving License"`), so splitting the joined string over-counts it. Always consume `authority_list`.

On **write**, the `authority` / `issued_by` field of any document master accepts a comma-joined list of **ids or names**; the server normalises to canonical ids, de-duplicates, drops unknown tokens, and returns 422 if nothing resolves:
```json
{ "message": "The given data was invalid.",
  "errors": { "authority": ["Select at least one valid authority."] } }
```

---

## 8. QUICK REFERENCE

```
GET    /clm/authorities              # list + in_use
POST   /clm/authorities              # { name, description, status? }
PUT    /clm/authorities/{id}         # rename → cascades into legacy name tables
DELETE /clm/authorities/{id}         # 409 + used_in while referenced

# consumed by
POST /clm/kyc-documents  { authority: "4, 12" | "FSSAI, DGFT" }
POST /clm/qc-documents   { issued_by: "7" }
GET  /clm/segment-rules/bootstrap    # every doc row pre-resolved to names + authority_list
```

---

## 9. NOTES (caveats)

1. `code` is immutable and branch-sequenced (`AUTH-NNN`).
2. Name uniqueness is scope-relative — two branches of one client may each own an "FSSAI".
3. Edit is **never** blocked by usage; only delete is.
4. Unknown tokens inside a stored authority list are echoed back unchanged, so legacy free text is never lost.
5. Deletes are hard; there is no restore.
6. `status = inactive` is stored but is not filtered out of the document-master pickers.

---

*Related documents: AUTHORITY_FUNCTIONAL_DOCUMENTATION.md · AUTHORITY_TECHNICAL_DOCUMENTATION.md · AUTHORITY_CODE_WALKTHROUGH.md*
