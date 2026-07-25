# SUPPLIER BEHAVIOUR MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Behaviour

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

## 1. Conventions

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.vendor_behaviour`; super_admin bypasses.
- Bare responses; lists `orderByDesc(id)` with flattened `client_name` / `branch_name` / `creator_name` / `creator_user_type`.
- Validation errors: HTTP 422 `{ message, errors }`.

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | /master/vendor_behaviour |
| GET | /master/vendor_behaviour/{id} |
| POST | /master/vendor_behaviour |
| PUT | /master/vendor_behaviour/{id} |
| DELETE | /master/vendor_behaviour/{id} |
| GET | /master/vendor_behaviour/next-code |

## 3. List / Read

`GET /master/vendor_behaviour?search=excellent`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": 7,
    "name": "Excellent",
    "description": "Consistently exceeds expectations",
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

`POST /master/vendor_behaviour`

```json
{ "name": "Good", "description": "Meets expectations reliably", "status": "Active" }
```

Returns `201`. `PUT /master/vendor_behaviour/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "errors": { "name": ["This Name is already registered. Please use a different value."] } }
```

**422 — invalid status enum:**
```json
{ "errors": { "status": ["The selected status is invalid."] } }
```

## 5. Delete

`DELETE /master/vendor_behaviour/{id}` → `{ "message": "Deleted" }` (soft delete). Descendants editing/deleting an ancestor-tier row get 403 from `hierarchicalDenial`.

## 6. Quick Reference

| Field | Type | Required | Values |
|---|---|---|---|
| name | string | Yes | unique (case-insensitive) |
| description | string | No | free text |
| status | string | Yes | `Active` / `Inactive` |

## 7. Notes

- `next-code` returns `{ "code": null }`.
- No system-seed rows.
- Non-super callers cannot set `client_id`/`branch_id`.

*Related documents: VENDOR_BEHAVIOUR_FUNCTIONAL_DOCUMENTATION.md, VENDOR_BEHAVIOUR_TECHNICAL_DOCUMENTATION.md, VENDOR_BEHAVIOUR_CODE_WALKTHROUGH.md*
