# CUSTOMER CONSIGNEE TYPE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Customer Consignee Type

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

## 1. Conventions

- Base prefix `/api`. All routes require `Authorization: Bearer <token>` and pass `auth:sanctum` + `user.active`.
- Permission module `master.customer_types` (view/add/edit/delete); super_admin bypasses.
- Responses are **bare** (no `data` envelope). Lists are `orderByDesc(id)` and include flattened `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- Validation failures return HTTP 422 `{ message, errors:{field:[...]} }`.

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | /master/customer_types |
| GET | /master/customer_types/{id} |
| POST | /master/customer_types |
| PUT | /master/customer_types/{id} |
| DELETE | /master/customer_types/{id} |
| GET | /master/customer_types/next-code |

## 3. List / Read

`GET /master/customer_types?search=retail&branch_id=7` — `search` runs ILIKE across text/select fields.

```json
[
  {
    "id": 1,
    "client_id": null,
    "branch_id": null,
    "name": "Retailer",
    "gst_applicable": "Yes",
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

`POST /master/customer_types`

```json
{ "name": "Distributor", "gst_applicable": "Yes", "status": "Active" }
```

Returns `201` with the created row. `PUT /master/customer_types/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "message": "The given data was invalid.",
  "errors": { "name": ["This Name is already registered. Please use a different value."] } }
```

**422 — system-seed collision** (creating "Retailer"/"Wholesaler"):
```json
{ "errors": { "name": ["\"Retailer\" is a system-managed Name and cannot be re-created."] } }
```

**403 — editing a system row** (`PUT` on Retailer/Wholesaler):
```json
{ "message": "This record is system-managed and cannot be edited. Create a custom entry if you need different values." }
```

## 5. Delete

`DELETE /master/customer_types/{id}` → `{ "message": "Deleted" }` (soft delete).

**403 — system-seeded row:**
```json
{ "message": "This customer consignee type is system-managed and cannot be deleted." }
```

## 6. Quick Reference

| Field | Type | Required | Values |
|---|---|---|---|
| name | string | Yes | unique (case-insensitive) |
| gst_applicable | string | No | `Yes` / `No` |
| status | string | Yes | `Active` / `Inactive` |

## 7. Notes

- `next-code` returns `{ "code": null }` — this master has no auto-generated code.
- Non-super users cannot set `client_id`/`branch_id` in the body; they are derived from the token.

*Related documents: CUSTOMER_TYPES_FUNCTIONAL_DOCUMENTATION.md, CUSTOMER_TYPES_TECHNICAL_DOCUMENTATION.md, CUSTOMER_TYPES_CODE_WALKTHROUGH.md*
