# SEGMENT — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Segment**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.segment` gates the UI; the API enforces **tenant + branch scope** and the **creator-hierarchy** rule.
- Axios auto-appends `?branch_id=<active>` on the GET (honoured only for `client_admin` / `client_user`).
- Success: `{ status: true, data: …, counts: … }` · Failure: `{ status: false, message, errors?, used_in? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · 409 · 422.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/segments` | List + tab counts + per-row usage flags |
| POST | `/clm/segments` | Create (code auto-allocated) |
| PUT | `/clm/segments/{id}` | Update (freeze guards apply) |
| DELETE | `/clm/segments/{id}` | Hard delete (blocked while referenced) |

---

## 3. GET `/clm/segments`

**Query:** `branch_id` (optional; injected automatically).

**200**
```json
{
  "status": true,
  "data": [
    {
      "id": 14,
      "client_id": 3,
      "branch_id": 2,
      "code": "SG-004",
      "name": "Food Grade Ethanol",
      "regulatory_status": "highly",
      "buyer_consignee": "not_allowed",
      "status": "active",
      "created_by": 55,
      "updated_by": 55,
      "created_at": "2026-07-14T09:22:11.000000Z",
      "updated_at": "2026-07-20T11:03:48.000000Z",
      "in_use": true,
      "used_in": ["Segment Rules", "Customers", "Products"]
    }
  ],
  "counts": { "all": 12, "highly": 5, "less": 7 }
}
```

| Field | Meaning |
|---|---|
| `regulatory_status` | `highly` \| `less` — matched against agreements / trade docs / T&C |
| `buyer_consignee` | `allowed` \| `not_allowed` — may the consignee differ from the buyer |
| `in_use` | true when referenced anywhere (delete will 409) |
| `used_in` | Human-readable list of referencing areas |

Ordering is `id DESC`. Rows are branch-scoped: a branch user never sees a sibling branch's segments.

---

## 4. POST `/clm/segments`

```json
{ "name": "Food Grade Ethanol",
  "regulatory_status": "highly",
  "buyer_consignee": "not_allowed",
  "status": "active" }
```

| Field | Rule |
|---|---|
| `name` | required · string · max 255 · unique (case-insensitive) **within your scope** |
| `regulatory_status` | required · `highly` \| `less` |
| `buyer_consignee` | required · `allowed` \| `not_allowed` |
| `status` | optional · `active` \| `inactive` (default `active`) |

**201** → `{ status:true, data: { …row…, "code": "SG-005" } }`

**422 — duplicate name**
```json
{ "status": false,
  "message": "A segment named \"Rice\" already exists. Pick a different name.",
  "errors": { "name": ["A segment named \"Rice\" already exists. Pick a different name."] } }
```

**403 — no tenant**
```json
{ "status": false, "message": "No tenant context for this user" }
```

> `code` is server-allocated (`SG-NNN`, restarting at 001 per branch) and can never be supplied or changed.

---

## 5. PUT `/clm/segments/{id}`

Same fields, all optional (`sometimes|required`). `code` is immutable.

**200** → `{ status:true, data: { …fresh row… } }`

**409 — name frozen (segment is referenced)**
```json
{ "status": false,
  "message": "This segment is in use by Customers, Segment Rules — its name can't be changed.",
  "errors": { "name": ["This segment is in use by Customers, Segment Rules — its name can't be changed."] } }
```

**422 — regulatory status frozen**
```json
{ "status": false,
  "message": "This segment is in use by Products — its regulatory status can't be changed.",
  "errors": { "regulatory_status": ["…"] } }
```

**422 — rename collides**
```json
{ "status": false,
  "message": "Another segment named \"Rice\" already exists. Pick a different name.",
  "errors": { "name": ["…"] } }
```

**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — it was created by another Branch." }
```

### Side effect
A successful **rename** rewrites the segment name inside the comma-joined `segment` column on `customers` and `consignees` (whole entries only, case-insensitive). Every write also invalidates the cached master bundle, so the Customer / Consignee / Vendor / Product segment dropdowns refresh on their next fetch instead of waiting out the 5-minute TTL.

---

## 6. DELETE `/clm/segments/{id}`

**200** → `{ status: true, message: "Deleted" }` (hard delete)

**409 — referenced**
```json
{ "status": false,
  "message": "This segment is in use by Segment Rules, Customers, Agreement Library. Remove or reassign those records before deleting.",
  "used_in": ["Segment Rules", "Customers", "Agreement Library"] }
```

Possible `used_in` labels: `Segment Rules` · `Vendors` · `Products` · `Customers` · `Vendor Directory` · `Consignees` · `T&C Library` · `Agreement Library`.

**403** — `hierarchicalDenial` (employees may only delete their own rows; a branch user cannot delete a client-level row).

---

## 7. QUICK REFERENCE

```
GET    /clm/segments                 # list + counts + in_use
POST   /clm/segments                 # { name, regulatory_status, buyer_consignee, status? }
PUT    /clm/segments/{id}            # freeze guards while referenced
DELETE /clm/segments/{id}            # 409 + used_in while referenced

# then
GET    /clm/segment-rules/bootstrap  # build the segment's DCP rule
GET    /clm/segment-rules/for-segment/{id}   # what the party forms read
```

---

## 8. NOTES (caveats)

1. `code` is immutable and branch-sequenced (`SG-NNN`); legacy `S-NNN` codes are still parsed by the allocator.
2. Name uniqueness is **scope-relative** — two branches of one client may each own a "Rice".
3. Name and regulatory status freeze only **while referenced**; an unused segment stays fully editable.
4. Delete is **hard**; there is no restore.
5. A segment does not appear in the party segment pickers until its DCP rule contains at least one document.
6. `/clm/segments` and the Masters screen `/master/segments` are the same data over the same endpoint.

---

*Related documents: SEGMENT_FUNCTIONAL_DOCUMENTATION.md · SEGMENT_TECHNICAL_DOCUMENTATION.md · SEGMENT_CODE_WALKTHROUGH.md*
