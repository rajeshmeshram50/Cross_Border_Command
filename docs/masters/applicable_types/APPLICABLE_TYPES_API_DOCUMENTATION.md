# APPLICABLE PARTIES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Applicable Parties

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

## 1. Conventions

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.applicable_types`; super_admin bypasses.
- Bare responses; lists `orderByDesc(id)` with flattened `client_name` / `branch_name` / `creator_name` / `creator_user_type`.
- Validation errors: HTTP 422 `{ message, errors }`.

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | /master/applicable_types |
| GET | /master/applicable_types/{id} |
| POST | /master/applicable_types |
| PUT | /master/applicable_types/{id} |
| DELETE | /master/applicable_types/{id} |
| GET | /master/applicable_types/next-code |

## 3. List / Read

`GET /master/applicable_types?search=notify`

```json
[
  {
    "id": 3,
    "client_id": 12,
    "branch_id": 7,
    "name": "Notify Party",
    "party_type": "Third Party",
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

`POST /master/applicable_types`

```json
{ "name": "Consignee", "party_type": "Customer", "status": "Active" }
```

Returns `201`. `PUT /master/applicable_types/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "errors": { "name": ["This Name is already registered. Please use a different value."] } }
```

**422 — invalid party_type** (e.g. posting `Supplier`, which is not a server enum value):
```json
{ "errors": { "party_type": ["The selected party type is invalid."] } }
```

Valid `party_type` values: `Customer`, `Vendor`, `Third Party`, `Carrier`, `Other`.

## 5. Delete

`DELETE /master/applicable_types/{id}` → `{ "message": "Deleted" }` (soft delete). Descendants mutating an ancestor-tier row get 403 from `hierarchicalDenial`.

## 6. Quick Reference

| Field | Type | Required | Values |
|---|---|---|---|
| name | string | Yes | unique (case-insensitive) |
| party_type | string | No | `Customer` / `Vendor` / `Third Party` / `Carrier` / `Other` |
| status | string | Yes | `Active` / `Inactive` |

## 7. Notes

- `next-code` returns `{ "code": null }`.
- No system-seed rows.
- Non-super callers cannot set `client_id`/`branch_id`.

*Related documents: APPLICABLE_TYPES_FUNCTIONAL_DOCUMENTATION.md, APPLICABLE_TYPES_TECHNICAL_DOCUMENTATION.md, APPLICABLE_TYPES_CODE_WALKTHROUGH.md*
