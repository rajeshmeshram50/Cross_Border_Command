# TEMPERATURE CLASS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Temperature Class Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/temp_class_master`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.temp_class_master`**; super admins bypass.
- Bare JSON; list = array `orderByDesc(id)`; rows flattened with owner names.
- `?search=` → `ILIKE` on text/select fields; `?branch_id=` narrows for client roles.
- Validation → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/temp_class_master` |
| 2 | GET | `/master/temp_class_master/{id}` |
| 3 | POST | `/master/temp_class_master` |
| 4 | PUT | `/master/temp_class_master/{id}` |
| 5 | DELETE | `/master/temp_class_master/{id}` |
| 6 | GET | `/master/temp_class_master/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/temp_class_master?search=frozen`

```json
[
  {
    "id": 4, "client_id": 12, "branch_id": null,
    "class_code": "FRZ", "class_name": "Frozen",
    "temp_range_min": -25, "temp_range_max": -18,
    "description": "Deep freeze storage for frozen goods",
    "requires_monitoring": "Yes", "alert_threshold": -15,
    "suitable_products": "Frozen Foods, Ice Cream, Meat",
    "status": "Active",
    "created_by": 5, "client_name": "IGC GROUP", "branch_name": null,
    "creator_name": "Ops Admin", "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/temp_class_master`

```json
{
  "class_code": "CLD", "class_name": "Cold Chain",
  "temp_range_min": 2, "temp_range_max": 8,
  "description": "Refrigerated storage for perishables",
  "requires_monitoring": "Yes", "alert_threshold": 10,
  "suitable_products": "Dairy, Fresh Produce, Vaccines", "status": "Active"
}
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — duplicate (`uEach`):**
```json
{ "message": "The class name has already been taken.", "errors": { "class_name": ["The class name has already been taken."] } }
```
`class_code` and `class_name` are checked separately, case-insensitively, per tenant.

## 5. DELETE

`DELETE /api/master/temp_class_master/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier → **403**. No guard against racks referencing the class.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/temp_class_master?search=` |
| Create | `POST /master/temp_class_master` |
| Update | `PUT /master/temp_class_master/{id}` |
| Delete | `DELETE /master/temp_class_master/{id}` |

## 7. NOTES

- `temp_range_min` may be negative; there is no `min ≤ max` cross-field validation.
- `requires_monitoring` accepts `Yes`/`No`; numeric temp fields are not searchable.
- Every write bumps `MasterBundleCache`.

---

*Related documents: TEMP_CLASS_MASTER_FUNCTIONAL_DOCUMENTATION.md · TEMP_CLASS_MASTER_TECHNICAL_DOCUMENTATION.md · TEMP_CLASS_MASTER_CODE_WALKTHROUGH.md*
