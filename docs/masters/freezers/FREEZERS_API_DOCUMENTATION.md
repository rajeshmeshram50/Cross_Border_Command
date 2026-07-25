# FREEZER MANAGEMENT — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Freezer Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/freezers`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.freezers`**; super admins bypass.
- Bare JSON; list = array `orderByDesc(id)`; rows flattened with owner names.
- `?search=` → `ILIKE` on text/select fields; `?branch_id=` narrows for client roles.
- Validation → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/freezers` |
| 2 | GET | `/master/freezers/{id}` |
| 3 | POST | `/master/freezers` |
| 4 | PUT | `/master/freezers/{id}` |
| 5 | DELETE | `/master/freezers/{id}` |
| 6 | GET | `/master/freezers/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/freezers?search=alpha`

```json
[
  {
    "id": 5, "client_id": 12, "branch_id": 4,
    "name": "Freezer Alpha", "warehouse": 12,
    "capacity": 200, "status": "Active",
    "created_by": 88, "client_name": "IGC GROUP", "branch_name": "Pune",
    "creator_name": "Asha R", "creator_user_type": "branch_user"
  }
]
```
`warehouse` is the raw Warehouse Master id; the frontend resolves it to `wh_name` (and derives an `occupancy` display value).

## 4. CREATE / UPDATE

`POST /api/master/freezers`

```json
{ "name": "Freezer Beta", "warehouse": 12, "capacity": 150, "status": "Active" }
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — composite duplicate (`name` + `warehouse`):**
```json
{
  "message": "The name has already been taken.",
  "errors": { "name": ["The name has already been taken."] }
}
```
The clash is on the **combination** — the same `name` under a different `warehouse` is accepted; the same `name`+`warehouse` pair (name compared case-insensitively, warehouse exact) is rejected.

**422 — missing parent:**
```json
{ "message": "The warehouse field is required.", "errors": { "warehouse": ["The warehouse field is required."] } }
```

## 5. DELETE

`DELETE /api/master/freezers/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier → **403**.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/freezers?search=` |
| Create | `POST /master/freezers` |
| Update | `PUT /master/freezers/{id}` |
| Delete | `DELETE /master/freezers/{id}` |

## 7. NOTES

- Required: `name`, `warehouse`, `capacity`, `status`.
- `warehouse` validated as `integer` only (no existence check).
- Every write bumps `MasterBundleCache`.

---

*Related documents: FREEZERS_FUNCTIONAL_DOCUMENTATION.md · FREEZERS_TECHNICAL_DOCUMENTATION.md · FREEZERS_CODE_WALKTHROUGH.md*
