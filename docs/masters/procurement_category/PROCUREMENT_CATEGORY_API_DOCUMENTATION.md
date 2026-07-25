# PROCUREMENT CATEGORY MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Procurement Category

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/procurement_category`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.procurement_category` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name`.
- `?search=` runs ILIKE across text/select fields; `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/procurement_category` |
| GET | `/api/master/procurement_category/{id}` |
| POST | `/api/master/procurement_category` |
| PUT | `/api/master/procurement_category/{id}` |
| DELETE | `/api/master/procurement_category/{id}` |
| GET | `/api/master/procurement_category/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/procurement_category?search=raw`

```json
[
  {
    "id": 7,
    "client_id": 12,
    "branch_id": 4,
    "cat_code": "RAW",
    "cat_name": "Raw Material",
    "match_logic": "3-Way Match (PO+VTI+GRN)",
    "grn_required": "Yes — Physical Receipt",
    "gst_applicable": "Yes",
    "status": "Active",
    "created_by": 88,
    "created_at": "2026-07-20T09:12:00.000000Z",
    "updated_at": "2026-07-20T09:12:00.000000Z",
    "client_name": "IGC GROUP",
    "branch_name": "Pune",
    "creator_name": "Rajesh",
    "creator_user_type": "branch_user"
  }
]
```

---

## 4. CREATE / UPDATE

`POST /api/master/procurement_category`

```json
{
  "cat_code": "SVC",
  "cat_name": "Services",
  "match_logic": "2-Way Match (PO+VTI)",
  "grn_required": "Yes — Service Confirmation",
  "gst_applicable": "Reverse Charge",
  "status": "Active"
}
```

`422` — duplicate code (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "cat_code": ["This Cat code is already registered. Please use a different value."] } }
```

`422` — invalid enum: `{ "errors": { "match_logic": ["The selected match logic is invalid."] } }`

`PUT /api/master/procurement_category/{id}` — same body; hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/procurement_category/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/procurement_category?search=` |
| Create | `POST /master/procurement_category` |
| Update | `PUT /master/procurement_category/{id}` |
| Delete | `DELETE /master/procurement_category/{id}` |

---

## 7. NOTES

- All four selects (`match_logic`, `grn_required`, `gst_applicable`, `status`) are enum-guarded server-side.
- Both `cat_code` and `cat_name` are unique (case-insensitive, tenant-scoped).

---
*Related documents: PROCUREMENT_CATEGORY_FUNCTIONAL_DOCUMENTATION.md, PROCUREMENT_CATEGORY_TECHNICAL_DOCUMENTATION.md, PROCUREMENT_CATEGORY_CODE_WALKTHROUGH.md*
