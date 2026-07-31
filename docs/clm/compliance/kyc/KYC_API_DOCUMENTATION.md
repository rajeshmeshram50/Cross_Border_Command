# KYC — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **KYC**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.kyc` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on the GET.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message, errors?, used_in? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · 409 · 422.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/kyc-documents` | List + resolved authority names + `in_use` |
| POST | `/clm/kyc-documents` | Create (`KYC-NNN` auto-allocated) |
| PUT | `/clm/kyc-documents/{id}` | Update |
| DELETE | `/clm/kyc-documents/{id}` | Hard delete (blocked while referenced) |

**Read-through endpoints that also return KYC rows**

| Method | Path | Shape |
|---|---|---|
| GET | `/clm/segment-rules/bootstrap` | `data.kyc[]` with `authority` (string) **and** `authority_list` (array) |
| GET | `/clm/segment-rules/for-segment/{segmentId}` | `data.kyc[]` filtered to the rule's codes, each stamped `requirement: "M"\|"O"` |

---

## 3. GET `/clm/kyc-documents`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 7, "client_id": 3, "branch_id": 2,
      "code": "KYC-003",
      "name": "GST Certificate",
      "authority": "4, 12",
      "authority_names": "GST Department, State VAT Office",
      "expiry": "N/A",
      "status": "active",
      "created_by": 55, "updated_by": 55,
      "created_at": "2026-06-04T10:11:02.000000Z",
      "updated_at": "2026-06-04T10:11:02.000000Z",
      "in_use": true,
      "used_in": ["Segment Rules", "Segment Doc Uploads"] }
  ],
  "count": 11
}
```

| Field | Meaning |
|---|---|
| `code` | Immutable `KYC-NNN`; **this is what rules and uploads store** |
| `authority` | Raw storage — a comma-joined list of **authority ids** |
| `authority_names` | The same list resolved to current names |
| `expiry` | `N/A` \| `Varies` \| `MM/YYYY` (a descriptor, not an actual date) |
| `in_use` / `used_in` | Delete would 409; `used_in` names the referencing areas |

Ordering is `id ASC`. Rows are branch-scoped — a branch user never sees a sibling branch's entries.

---

## 4. POST `/clm/kyc-documents`

```json
{ "name": "GST Certificate",
  "authority": "4, 12",
  "expiry": "N/A",
  "status": "active" }
```

| Field | Rule |
|---|---|
| `name` | required · string · max 255 · unique (case-insensitive) **within your scope** |
| `authority` | required · string · max 2000 · comma-joined **ids or names** |
| `expiry` | optional · string · max 32 (default `N/A`) |
| `status` | optional · `active` \| `inactive` (default `active`) |

`authority` is normalised server-side: ids and names both resolve, matching is case-insensitive, duplicates collapse, unknown tokens are **dropped**.

**201** → `{ status:true, data: { …row…, "code": "KYC-012", "authority": "4, 12" } }`

**422 — duplicate name**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["A KYC document named \"GST Certificate\" already exists. Pick a different name."] } }
```

**422 — no authority resolved**
```json
{ "message": "The given data was invalid.",
  "errors": { "authority": ["Select at least one valid authority."] } }
```

**403 — no tenant** → `{ "status": false, "message": "No tenant context for this user" }`

---

## 5. PUT `/clm/kyc-documents/{id}`

Same fields, all `sometimes|required`. `code` is immutable.

**200** → `{ status:true, data: { …fresh row… } }`

There is **no in-use edit lock** — renaming a KYC document is safe because segment rules and uploads store the immutable `code`, never the name.

**422 — rename collides**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["Another KYC document named \"PAN Card\" already exists. Pick a different name."] } }
```

**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — employees can only manage rows they created themselves." }
```

---

## 6. DELETE `/clm/kyc-documents/{id}`

**200** → `{ status: true, message: "Deleted" }` (hard delete)

**409 — referenced**
```json
{ "status": false,
  "message": "This KYC document is in use by Segment Rules, Segment Doc Uploads. Remove or reassign those records before deleting.",
  "used_in": ["Segment Rules", "Segment Doc Uploads"] }
```

| `used_in` label | Source |
|---|---|
| `Segment Rules` | the code appears in `clm_segment_rules.doc_selections` |
| `Segment Doc Uploads` | a party has uploaded a file against this code |

> **Caveat:** the usage lookup is not scoped by `client_id`. Since `KYC-NNN` codes restart per tenant, another tenant's reference to *their* `KYC-001` can wrongly block your delete.

---

## 7. HOW KYC ROWS APPEAR ELSEWHERE

### In the Document Control Panel bootstrap
```json
{ "data": { "kyc": [
    { "id": 7, "code": "KYC-003", "name": "GST Certificate",
      "authority": "GST Department, State VAT Office",
      "authority_list": ["GST Department", "State VAT Office"],
      "expiry": "N/A", "status": "active" } ] } }
```

### In the rule (only the code is stored)
```json
{ "doc_selections": { "kyc": { "KYC-001": "M", "KYC-003": "M", "KYC-007": "O" } } }
```

### Read back for a party form
```json
{ "data": { "kyc": [
    { "id": 7, "code": "KYC-003", "name": "GST Certificate",
      "authority": "GST Department, State VAT Office",
      "authority_list": ["GST Department", "State VAT Office"],
      "expiry": "N/A", "status": "active",
      "requirement": "M" } ] } }
```

> Always consume **`authority_list`** when counting or iterating authorities — an authority name may itself contain commas, so re-splitting the joined `authority` string over-counts.

---

## 8. QUICK REFERENCE

```
GET    /clm/authorities                       # 1. the issuing bodies must exist first
POST   /clm/kyc-documents                     # 2. { name, authority, expiry?, status? }
GET    /clm/segment-rules/bootstrap           # 3. the DCP modal lists your KYC docs
POST   /clm/segment-rules                     #    doc_selections.kyc = { "KYC-003": "M" }
GET    /clm/segment-rules/for-segment/{id}    # 4. party forms read the required list
POST   /segment-uploads/{type}/{id}           # 5. the party uploads the actual file
DELETE /clm/kyc-documents/{id}                #    409 + used_in while referenced
```

---

## 9. NOTES (caveats)

1. `code` is immutable and branch-sequenced (`KYC-NNN`); it is the only identifier downstream tables store.
2. Name uniqueness is scope-relative — two branches of one client may each own a "PAN Card".
3. `authority` accepts ids **or** names on write and always returns the canonical id list.
4. `expiry` here is a descriptor; the real per-file expiry lives on `segment_doc_uploads.expiry_date`.
5. The usage check is not client-scoped (unlike QC's) — see §6.
6. Deletes are hard; there is no restore.
7. `status = inactive` is stored but is not filtered out of the DCP document picker.

---

*Related documents: KYC_FUNCTIONAL_DOCUMENTATION.md · KYC_TECHNICAL_DOCUMENTATION.md · KYC_CODE_WALKTHROUGH.md*
