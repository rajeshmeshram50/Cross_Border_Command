# RACK TYPE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Rack Type Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/rack_type_master`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.rack_type_master`**; super admins bypass.
- Bare JSON; list = array `orderByDesc(id)`; rows flattened with `client_name`/`branch_name`/`creator_name`/`creator_user_type`.
- `?search=` → `ILIKE` on text/select fields; `?branch_id=` narrows for client roles.
- Validation → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/rack_type_master` |
| 2 | GET | `/master/rack_type_master/{id}` |
| 3 | POST | `/master/rack_type_master` |
| 4 | PUT | `/master/rack_type_master/{id}` |
| 5 | DELETE | `/master/rack_type_master/{id}` |
| 6 | GET | `/master/rack_type_master/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/rack_type_master?search=pallet`

```json
[
  {
    "id": 3, "client_id": 12, "branch_id": null,
    "type_code": "PLT", "type_name": "Pallet Rack",
    "description": "Standard selective pallet racking for bulk storage",
    "suitable_for": "General Inventory",
    "max_load_per_shelf": 1000, "typical_shelves": 4,
    "status": "Active",
    "created_by": 5, "client_name": "IGC GROUP", "branch_name": null,
    "creator_name": "Ops Admin", "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/rack_type_master`

```json
{
  "type_code": "MEZ", "type_name": "Mezzanine Rack",
  "description": "Multi-tier mezzanine racking",
  "suitable_for": "Heavy Duty",
  "max_load_per_shelf": 1200, "typical_shelves": 3, "status": "Active"
}
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — duplicate (`uEach`):**
```json
{ "message": "The type code has already been taken.", "errors": { "type_code": ["The type code has already been taken."] } }
```
`type_code` and `type_name` are checked separately, case-insensitively, per tenant.

## 5. DELETE

`DELETE /api/master/rack_type_master/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier → **403**. No guard against racks using the type.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/rack_type_master?search=` |
| Create | `POST /master/rack_type_master` |
| Update | `PUT /master/rack_type_master/{id}` |
| Delete | `DELETE /master/rack_type_master/{id}` |

## 7. NOTES

- `suitable_for` is optional; if sent must be one of the seven options.
- Numeric fields (`max_load_per_shelf`, `typical_shelves`) are not searchable.
- Every write bumps `MasterBundleCache`.

---

*Related documents: RACK_TYPE_MASTER_FUNCTIONAL_DOCUMENTATION.md · RACK_TYPE_MASTER_TECHNICAL_DOCUMENTATION.md · RACK_TYPE_MASTER_CODE_WALKTHROUGH.md*
