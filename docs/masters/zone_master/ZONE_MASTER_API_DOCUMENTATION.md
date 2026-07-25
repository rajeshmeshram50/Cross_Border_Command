# ZONE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Zone Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/zone_master`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.zone_master`**; super admins bypass.
- Bare JSON responses; list = array `orderByDesc(id)`; rows flattened with `client_name`/`branch_name`/`creator_name`/`creator_user_type`.
- `?search=` → `ILIKE` on text/select fields; `?branch_id=` narrows for client roles.
- Validation errors → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/zone_master` |
| 2 | GET | `/master/zone_master/{id}` |
| 3 | POST | `/master/zone_master` |
| 4 | PUT | `/master/zone_master/{id}` |
| 5 | DELETE | `/master/zone_master/{id}` |
| 6 | GET | `/master/zone_master/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/zone_master?search=cold`

```json
[
  {
    "id": 8, "client_id": 12, "branch_id": 4,
    "zone_id": "ZN-002", "zone_name": "Zone B — Cold",
    "zone_type": "Cold Chain Zone",
    "warehouse": 12,
    "purpose": "Temperature-controlled storage",
    "cold_chain": "Yes", "hazardous": "No",
    "status": "Active",
    "created_by": 88, "client_name": "IGC GROUP", "branch_name": "Pune",
    "creator_name": "Asha R", "creator_user_type": "branch_user"
  }
]
```
`warehouse` is the raw Warehouse Master id; the frontend resolves it to `wh_name`.

## 4. CREATE / UPDATE

`POST /api/master/zone_master`

```json
{
  "zone_id": "ZN-010", "zone_name": "Zone E — QC Hold",
  "zone_type": "QC Hold Zone",
  "warehouse": 12,
  "purpose": "Inbound goods awaiting quality clearance",
  "cold_chain": "No", "hazardous": "No", "status": "Active"
}
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — missing parent / duplicate:**
```json
{ "message": "The warehouse field is required.", "errors": { "warehouse": ["The warehouse field is required."] } }
```
```json
{ "message": "The zone id has already been taken.", "errors": { "zone_id": ["The zone id has already been taken."] } }
```
`zone_id` and `zone_name` are each checked case-insensitively within the tenant scope.

## 5. DELETE

`DELETE /api/master/zone_master/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier rows → **403** with a denial message. No guard against dependent racks.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/zone_master?search=` |
| Create | `POST /master/zone_master` |
| Update | `PUT /master/zone_master/{id}` |
| Delete | `DELETE /master/zone_master/{id}` |

## 7. NOTES

- `warehouse` must be a valid Warehouse Master id — but the API only enforces `integer`, not existence.
- `cold_chain` / `hazardous` accept `Yes`/`No`; both optional (default effectively No).
- Every write bumps `MasterBundleCache`.

---

*Related documents: ZONE_MASTER_FUNCTIONAL_DOCUMENTATION.md · ZONE_MASTER_TECHNICAL_DOCUMENTATION.md · ZONE_MASTER_CODE_WALKTHROUGH.md*
