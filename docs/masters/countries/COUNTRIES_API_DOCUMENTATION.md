# COUNTRIES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Countries

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base: `/api`. All endpoints require `Authorization: Bearer <sanctum_token>` and pass `auth:sanctum` + `user.active`.
- Permission module `master.countries` (`can_view/add/edit/delete`); super_admin bypasses.
- Responses are **bare** (no `{data:...}` wrapper). Rows are flattened with `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- Lists are `orderByDesc(id)`. Validation failures return **422** with `errors` keyed by field.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/countries` |
| GET | `/api/master/countries/{id}` |
| GET | `/api/master/countries/next-code` |
| POST | `/api/master/countries` |
| PUT | `/api/master/countries/{id}` |
| DELETE | `/api/master/countries/{id}` |

---

## 3. LIST / READ

`GET /api/master/countries?search=ind`

```json
[
  {
    "id": 42,
    "client_id": 12,
    "branch_id": null,
    "name": "India",
    "iso_code": "IN",
    "status": "Active",
    "created_by": 3,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Rajesh",
    "creator_user_type": "client_admin"
  }
]
```

`search` runs ILIKE over the text/select fields (`name`, `iso_code`, `status`). `GET /{id}` returns one such object.

---

## 4. CREATE / UPDATE

`POST /api/master/countries`

```json
{ "name": "United Arab Emirates", "iso_code": "ae", "status": "Active" }
```

`iso_code` is uppercased to `AE` before save. Returns **201** with the flattened row. `PUT /{id}` accepts the same body.

**422 errors specific to this master:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate name (case-insensitive) | `name` | `This Name is already registered. Please use a different value.` |
| Duplicate ISO code (case-insensitive) | `iso_code` | `This ISO code is already registered. Please use a different value.` |
| Missing name/status | `name` / `status` | required |
| Bad status value | `status` | must be Active or Inactive |

---

## 5. DELETE

`DELETE /api/master/countries/{id}` → `{ "message": "Deleted" }` (soft delete).

Guards: `hierarchicalDenial` returns **403** if the row belongs to a higher tier than the caller (e.g. an employee deleting a client-level or global country). No system-seed or in-use guard on this master.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List countries | `GET /master/countries` |
| Search | `GET /master/countries?search=uae` |
| Create | `POST /master/countries` |
| Update | `PUT /master/countries/{id}` |
| Delete | `DELETE /master/countries/{id}` |

---

## 7. NOTES

- `next-code` returns `{ "code": null }` — Countries has no auto-code series.
- Every successful write bumps `MasterBundleCache` so dependent form dropdowns refresh.
- Empty `iso_code` is stored as `NULL`.

---

*Related documents: COUNTRIES_FUNCTIONAL_DOCUMENTATION.md, COUNTRIES_TECHNICAL_DOCUMENTATION.md, COUNTRIES_CODE_WALKTHROUGH.md*
