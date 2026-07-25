# WAREHOUSE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Warehouse Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/warehouse_master`; every call needs `Authorization: Bearer <sanctum_token>` and passes `auth:sanctum` + `user.active`.
- Permission module **`master.warehouse_master`** (`can_view/add/edit/delete`); super admins bypass.
- Responses are **bare** JSON — list = array (`orderByDesc(id)`), item = object. No `{data}` wrapper.
- Each row is flattened with `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- `?search=` runs `ILIKE %term%` across text/select fields; `?branch_id=` narrows (client roles only).
- Validation failures → **422** `{ message, errors: { field: [msg] } }`.

## 2. ENDPOINT INDEX

| # | Verb | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/master/warehouse_master` | List / search |
| 2 | GET | `/master/warehouse_master/{id}` | Single row |
| 3 | POST | `/master/warehouse_master` | Create |
| 4 | PUT | `/master/warehouse_master/{id}` | Update |
| 5 | DELETE | `/master/warehouse_master/{id}` | Delete |
| 6 | GET | `/master/warehouse_master/next-code` | `{ "code": null }` |

## 3. LIST / READ

`GET /api/master/warehouse_master?search=pune`

```json
[
  {
    "id": 12,
    "client_id": 12, "branch_id": 4,
    "wh_id": "WH-001", "wh_name": "Pune Main",
    "wh_type": "Own Warehouse",
    "city": "Pune", "state": "Maharashtra", "pincode": "411045",
    "contact_person": "Rajesh Kumar", "contact_phone": "+91 98100 00001",
    "area_sqft": 25000, "address": "Solitaire Hub, Balewadi, Pune",
    "status": "Active",
    "created_by": 88, "created_at": "2026-07-20T10:11:00.000000Z",
    "client_name": "IGC GROUP", "branch_name": "Pune", "creator_name": "Asha R", "creator_user_type": "branch_user"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/warehouse_master`

```json
{
  "wh_id": "WH-005", "wh_name": "Chennai Port",
  "wh_type": "Third Party Warehouse",
  "city": "Chennai", "state": "Tamil Nadu", "pincode": "600001",
  "contact_person": "K. Ramesh", "contact_phone": "+91 98400 00005",
  "area_sqft": 22000, "address": "Manali Industrial Area", "status": "Active"
}
```

`201 Created` returns the flattened row. `PUT /{id}` takes the same body.

**422 — duplicate (`uEach`):**
```json
{ "message": "The wh id has already been taken.", "errors": { "wh_id": ["The wh id has already been taken."] } }
```
`wh_id` and `wh_name` are checked separately, case-insensitively, within the tenant scope.

## 5. DELETE

`DELETE /api/master/warehouse_master/{id}` → `{ "message": "Deleted" }`. **Hard delete** (no `SoftDeletes` trait). Cross-tier rows return **403** with a `hierarchicalDenial` message. No in-use guard against dependent zones/racks/freezers.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/warehouse_master?search=` |
| Create | `POST /master/warehouse_master` |
| Update | `PUT /master/warehouse_master/{id}` |
| Delete | `DELETE /master/warehouse_master/{id}` |

## 7. NOTES

- `next-code` returns `{code:null}` — Warehouse IDs are entered manually, not auto-sequenced.
- `area_sqft` must be numeric; text/select fields are searchable, numeric fields are not.
- Every write bumps `MasterBundleCache` so warehouse dropdowns refresh across the app.

---

*Related documents: WAREHOUSE_MASTER_FUNCTIONAL_DOCUMENTATION.md · WAREHOUSE_MASTER_TECHNICAL_DOCUMENTATION.md · WAREHOUSE_MASTER_CODE_WALKTHROUGH.md*
