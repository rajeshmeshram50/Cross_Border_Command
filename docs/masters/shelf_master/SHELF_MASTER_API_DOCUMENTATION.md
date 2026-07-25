# SHELF / LEVEL MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Shelf / Level Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/shelf_master`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.shelf_master`**; super admins bypass.
- Bare JSON; list = array `orderByDesc(id)`; rows flattened with owner names.
- `?search=` → `ILIKE` on text/select fields; `?branch_id=` narrows for client roles.
- Validation → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/shelf_master` |
| 2 | GET | `/master/shelf_master/{id}` |
| 3 | POST | `/master/shelf_master` |
| 4 | PUT | `/master/shelf_master/{id}` |
| 5 | DELETE | `/master/shelf_master/{id}` |
| 6 | GET | `/master/shelf_master/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/shelf_master?search=A1`

```json
[
  {
    "id": 40, "client_id": 12, "branch_id": 4,
    "rack_ref": 20,
    "shelf_name": "Shelf A1-L1", "level_no": 1,
    "shelf_type": "Standard Shelf",
    "max_weight": 500, "status": "Available",
    "created_by": 88, "client_name": "IGC GROUP", "branch_name": "Pune",
    "creator_name": "Asha R", "creator_user_type": "branch_user"
  }
]
```
`rack_ref` is the raw Rack master id; the frontend resolves it to `rackName`.

## 4. CREATE / UPDATE

`POST /api/master/shelf_master`

```json
{
  "rack_ref": 20,
  "shelf_name": "Shelf A1-L2", "level_no": 2,
  "shelf_type": "Standard Shelf",
  "max_weight": 500, "status": "Available"
}
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — missing parent / duplicate name:**
```json
{ "message": "The rack ref field is required.", "errors": { "rack_ref": ["The rack ref field is required."] } }
```
```json
{ "message": "The shelf name has already been taken.", "errors": { "shelf_name": ["The shelf name has already been taken."] } }
```
`shelf_name` is unique case-insensitively per tenant.

## 5. DELETE

`DELETE /api/master/shelf_master/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier → **403**.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/shelf_master?search=` |
| Create | `POST /master/shelf_master` |
| Update | `PUT /master/shelf_master/{id}` |
| Delete | `DELETE /master/shelf_master/{id}` |

## 7. NOTES

- Required: `rack_ref`, `shelf_name`, `level_no`, `shelf_type`, `status`.
- `rack_ref` validated as `integer` only (no existence check).
- Every write bumps `MasterBundleCache`.

---

*Related documents: SHELF_MASTER_FUNCTIONAL_DOCUMENTATION.md · SHELF_MASTER_TECHNICAL_DOCUMENTATION.md · SHELF_MASTER_CODE_WALKTHROUGH.md*
