# CUSTOMER CLASSIFICATIONS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Customer Classifications

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

## 1. Conventions

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.customer_classifications`; super_admin bypasses.
- Bare responses; lists `orderByDesc(id)` with flattened `client_name` / `branch_name` / `creator_name` / `creator_user_type`.
- Validation errors: HTTP 422 `{ message, errors }`.

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | /master/customer_classifications |
| GET | /master/customer_classifications/{id} |
| POST | /master/customer_classifications |
| PUT | /master/customer_classifications/{id} |
| DELETE | /master/customer_classifications/{id} |
| GET | /master/customer_classifications/next-code |

## 3. List / Read

`GET /master/customer_classifications?search=vip`

```json
[
  {
    "id": 2,
    "client_id": null,
    "branch_id": null,
    "name": "VIP",
    "credit_limit": 10000000,
    "payment_terms": 60,
    "status": "Active",
    "is_system": true,
    "created_by": null,
    "client_name": null,
    "branch_name": null,
    "creator_name": null,
    "creator_user_type": null
  }
]
```

## 4. Create / Update

`POST /master/customer_classifications`

```json
{ "name": "Tier A", "credit_limit": 500000, "payment_terms": 30, "status": "Active" }
```

Returns `201`. `PUT /master/customer_classifications/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "errors": { "name": ["This Name is already registered. Please use a different value."] } }
```

**422 — system-seed collision** (creating "Standard"/"VIP"):
```json
{ "errors": { "name": ["\"VIP\" is a system-managed Name and cannot be re-created."] } }
```

**403 — editing a system row:**
```json
{ "message": "This record is system-managed and cannot be edited. Create a custom entry if you need different values." }
```

## 5. Delete

`DELETE /master/customer_classifications/{id}` → `{ "message": "Deleted" }`.

**403 — system-seeded row:**
```json
{ "message": "This customer classification is system-managed and cannot be deleted." }
```

## 6. Quick Reference

| Field | Type | Required | Values |
|---|---|---|---|
| name | string | Yes | unique (case-insensitive) |
| credit_limit | number | No | ₹ |
| payment_terms | number | No | days |
| status | string | Yes | `Active` / `Inactive` |

## 7. Notes

- `next-code` returns `{ "code": null }`.
- Empty numeric fields are stored as `NULL`.
- Non-super callers cannot set `client_id`/`branch_id`.

*Related documents: CUSTOMER_CLASSIFICATIONS_FUNCTIONAL_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_TECHNICAL_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_CODE_WALKTHROUGH.md*
