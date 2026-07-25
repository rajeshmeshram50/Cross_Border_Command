# SUPPLIER TYPES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Types

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

## 1. Conventions

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.vendor_types`; super_admin bypasses.
- Bare responses; lists `orderByDesc(id)` with flattened `client_name` / `branch_name` / `creator_name` / `creator_user_type`.
- Validation errors: HTTP 422 `{ message, errors }`.

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | /master/vendor_types |
| GET | /master/vendor_types/{id} |
| POST | /master/vendor_types |
| PUT | /master/vendor_types/{id} |
| DELETE | /master/vendor_types/{id} |
| GET | /master/vendor_types/next-code |

## 3. List / Read

`GET /master/vendor_types?search=farmer&branch_id=7`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": 7,
    "name": "Farmer",
    "description": "Direct farm sourcing",
    "status": "Active",
    "created_by": 88,
    "client_name": "IGC GROUP",
    "branch_name": "Nagpur",
    "creator_name": "Asha R",
    "creator_user_type": "branch_user"
  }
]
```

## 4. Create / Update

`POST /master/vendor_types`

```json
{ "name": "Manufacturer", "description": "Processed goods manufacturer", "status": "Active" }
```

Returns `201`. `PUT /master/vendor_types/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["This Name is already registered. Please use a different value."] } }
```

**422 — missing required field:**
```json
{ "errors": { "name": ["The name field is required."] } }
```

## 5. Delete

`DELETE /master/vendor_types/{id}` → `{ "message": "Deleted" }` (soft delete). A descendant attempting to delete an ancestor-tier row gets 403 from `hierarchicalDenial`.

## 6. Quick Reference

| Field | Type | Required | Values |
|---|---|---|---|
| name | string | Yes | unique (case-insensitive) |
| description | string | No | free text |
| status | string | Yes | `Active` / `Inactive` |

## 7. Notes

- `next-code` returns `{ "code": null }`.
- No system-seed rows — no create/edit/delete lock beyond the tenant hierarchy.
- Non-super callers cannot set `client_id`/`branch_id`.

*Related documents: VENDOR_TYPES_FUNCTIONAL_DOCUMENTATION.md, VENDOR_TYPES_TECHNICAL_DOCUMENTATION.md, VENDOR_TYPES_CODE_WALKTHROUGH.md*
