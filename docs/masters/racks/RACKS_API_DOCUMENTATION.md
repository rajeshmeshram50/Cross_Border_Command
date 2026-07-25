# RACK & LOCATION MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Rack & Location Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/racks`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.racks`**; super admins bypass.
- Bare JSON; list = array `orderByDesc(id)`; rows flattened with owner names.
- `?search=` → `ILIKE` on text/select fields (`rackName`, `whType`, `rackStatus`); `?branch_id=` narrows for client roles.
- Validation → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/racks` |
| 2 | GET | `/master/racks/{id}` |
| 3 | POST | `/master/racks` |
| 4 | PUT | `/master/racks/{id}` |
| 5 | DELETE | `/master/racks/{id}` |
| 6 | GET | `/master/racks/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/racks?search=RC-001`

```json
[
  {
    "id": 20, "client_id": 12, "branch_id": 4,
    "whType": "Own Warehouse",
    "warehouse": 12, "zone": 8,
    "rackName": "RC-001",
    "rackType": 3, "rackStatus": "Partially Filled",
    "tempClass": 1,
    "shelves": 4, "maxWeight": 2000, "maxVolume": 12,
    "created_by": 88, "client_name": "IGC GROUP", "branch_name": "Pune",
    "creator_name": "Asha R", "creator_user_type": "branch_user"
  }
]
```
`warehouse`/`zone`/`rackType`/`tempClass` are raw master ids; the frontend resolves them to names.

## 4. CREATE / UPDATE

`POST /api/master/racks`

```json
{
  "whType": "Own Warehouse",
  "warehouse": 12, "zone": 8,
  "rackName": "RC-014",
  "rackType": 3, "rackStatus": "Empty",
  "tempClass": 1,
  "shelves": 4, "maxWeight": 2000, "maxVolume": 12
}
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — missing parent / duplicate name:**
```json
{ "message": "The zone field is required.", "errors": { "zone": ["The zone field is required."] } }
```
```json
{ "message": "The rack name has already been taken.", "errors": { "rackName": ["The rack name has already been taken."] } }
```
`rackName` is unique case-insensitively per tenant.

## 5. DELETE

`DELETE /api/master/racks/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier → **403**. No guard against shelves referencing the rack.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/racks?search=` |
| Create | `POST /master/racks` |
| Update | `PUT /master/racks/{id}` |
| Delete | `DELETE /master/racks/{id}` |

## 7. NOTES

- Required refs: `warehouse`, `zone`, `rackType`; `tempClass` optional. All validated as `integer` only (no existence check).
- There is **no `status` field** — use `rackStatus`. As a result the dashboard card for racks always shows 0/0.
- Every write bumps `MasterBundleCache` so the Shelf master's Rack dropdown refreshes.

---

*Related documents: RACKS_FUNCTIONAL_DOCUMENTATION.md · RACKS_TECHNICAL_DOCUMENTATION.md · RACKS_CODE_WALKTHROUGH.md*
