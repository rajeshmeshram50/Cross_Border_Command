# DUE DILIGENCE (DD) — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Due Diligence (DD)**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.due_diligence` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on the GET.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message, errors?, used_in? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · 409 · 422.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/dd-documents` | List + resolved authority names + `in_use` |
| POST | `/clm/dd-documents` | Create (`DD-NNN` auto-allocated) |
| PUT | `/clm/dd-documents/{id}` | Update |
| DELETE | `/clm/dd-documents/{id}` | Hard delete (blocked while referenced) |

**Read-through endpoints that also return DD rows**

| Method | Path | Shape |
|---|---|---|
| GET | `/clm/segment-rules/bootstrap` | `data.dd[]` with `authority` (string) **and** `authority_list` (array) |
| GET | `/clm/segment-rules/for-segment/{segmentId}` | `data.dd[]` filtered to the rule's codes, each stamped `requirement: "M"\|"O"` |

---

## 3. GET `/clm/dd-documents`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 4, "client_id": 3, "branch_id": 2,
      "code": "DD-002",
      "name": "Bank Reference Letter",
      "authority": "9",
      "authority_names": "Scheduled Commercial Bank",
      "expiry": "Varies",
      "status": "active",
      "created_by": 55, "updated_by": 55,
      "created_at": "2026-06-05T08:14:33.000000Z",
      "updated_at": "2026-06-05T08:14:33.000000Z",
      "in_use": true,
      "used_in": ["Segment Rules"] }
  ],
  "count": 6
}
```

| Field | Meaning |
|---|---|
| `code` | Immutable `DD-NNN`; **this is what rules and uploads store** |
| `authority` | Raw storage — a comma-joined list of **authority ids** |
| `authority_names` | The same list resolved to current names |
| `expiry` | `N/A` \| `Varies` \| `MM/YYYY` (a descriptor, not an actual date) |
| `in_use` / `used_in` | Delete would 409; `used_in` names the referencing areas |

Ordering is `id ASC`. Rows are branch-scoped.

---

## 4. POST `/clm/dd-documents`

```json
{ "name": "Credit Rating Report",
  "authority": "11, 14",
  "expiry": "Varies",
  "status": "active" }
```

| Field | Rule |
|---|---|
| `name` | required · string · max 255 · unique (case-insensitive) **within your scope** |
| `authority` | required · string · max 2000 · comma-joined **ids or names** |
| `expiry` | optional · string · max 32 (default `N/A`) |
| `status` | optional · `active` \| `inactive` (default `active`) |

`authority` is normalised server-side: ids and names both resolve, matching is case-insensitive, duplicates collapse, unknown tokens are **dropped**.

**201** → `{ status:true, data: { …row…, "code": "DD-007", "authority": "11, 14" } }`

**422 — duplicate name**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["A due-diligence document named \"Credit Rating Report\" already exists. Pick a different name."] } }
```

**422 — no authority resolved**
```json
{ "message": "The given data was invalid.",
  "errors": { "authority": ["Select at least one valid authority."] } }
```

**403 — no tenant** → `{ "status": false, "message": "No tenant context for this user" }`

---

## 5. PUT `/clm/dd-documents/{id}`

Same fields, all `sometimes|required`. `code` is immutable.

**200** → `{ status:true, data: { …fresh row… } }`

There is **no in-use edit lock** — renaming is safe because segment rules and uploads store the immutable `code`.

**422 — rename collides**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["Another due-diligence document named \"Audited Financials\" already exists. Pick a different name."] } }
```

**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — it was created by another Branch." }
```

---

## 6. DELETE `/clm/dd-documents/{id}`

**200** → `{ status: true, message: "Deleted" }` (hard delete)

**409 — referenced**
```json
{ "status": false,
  "message": "This due-diligence document is in use by Segment Rules, Segment Doc Uploads. Remove or reassign those records before deleting.",
  "used_in": ["Segment Rules", "Segment Doc Uploads"] }
```

| `used_in` label | Source |
|---|---|
| `Segment Rules` | the code appears in `clm_segment_rules.doc_selections` |
| `Segment Doc Uploads` | a party has uploaded evidence against this code |

> **Caveat:** the usage lookup is not scoped by `client_id`. Since `DD-NNN` codes restart per tenant, another tenant's reference to *their* `DD-001` can wrongly block your delete.

---

## 7. HOW DD ROWS APPEAR ELSEWHERE

### In the Document Control Panel bootstrap
```json
{ "data": { "dd": [
    { "id": 4, "code": "DD-002", "name": "Bank Reference Letter",
      "authority": "Scheduled Commercial Bank",
      "authority_list": ["Scheduled Commercial Bank"],
      "expiry": "Varies", "status": "active" } ] } }
```

### In the rule (only the code is stored)
```json
{ "doc_selections": { "dd": { "DD-002": "M", "DD-005": "O" } } }
```

### Read back for a party form
```json
{ "data": { "dd": [
    { "id": 4, "code": "DD-002", "name": "Bank Reference Letter",
      "authority": "Scheduled Commercial Bank",
      "authority_list": ["Scheduled Commercial Bank"],
      "expiry": "Varies", "status": "active",
      "requirement": "M" } ] } }
```

### In the Evidence Vault
```json
{ "category": "dd", "doc_code": "DD-002",
  "doc_name": "Bank Reference Letter", "requirement": "M",
  "attachment_name": "bank-ref-2026.pdf", "expiry_date": "2027-03-31" }
```

> Always consume **`authority_list`** when counting or iterating authorities — an authority name may itself contain commas.

---

## 8. QUICK REFERENCE

```
GET    /clm/authorities                       # 1. the issuing bodies must exist first
POST   /clm/dd-documents                      # 2. { name, authority, expiry?, status? }
GET    /clm/segment-rules/bootstrap           # 3. the DCP modal lists your DD docs
POST   /clm/segment-rules                     #    doc_selections.dd = { "DD-002": "M" }
GET    /clm/segment-rules/for-segment/{id}    # 4. party forms read the required list
POST   /segment-uploads/{type}/{id}           # 5. the party uploads the report
GET    /clm/buyer-profile                     # 6. dd progress ratio per party
DELETE /clm/dd-documents/{id}                 #    409 + used_in while referenced
```

---

## 9. NOTES (caveats)

1. `code` is immutable and branch-sequenced (`DD-NNN`); it is the only identifier downstream tables store.
2. Name uniqueness is scope-relative — two branches of one client may each own a "Bank Reference Letter".
3. `authority` accepts ids **or** names on write and always returns the canonical id list.
4. `expiry` here is a descriptor; the real per-file expiry lives on `segment_doc_uploads.expiry_date`.
5. The usage check is not client-scoped (unlike QC's) — see §6.
6. Deletes are hard; there is no restore.
7. There is no re-verification cadence field — periodic DD refresh is a manual process.
8. The endpoint shape is identical to `/clm/kyc-documents`; only the code prefix, messages and vault category differ.

---

*Related documents: DUE_DILIGENCE_FUNCTIONAL_DOCUMENTATION.md · DUE_DILIGENCE_TECHNICAL_DOCUMENTATION.md · DUE_DILIGENCE_CODE_WALKTHROUGH.md*
