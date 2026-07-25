# DIGITAL TWIN — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Digital Twin

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/digital_twin`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module **`master.digital_twin`**; super admins bypass.
- Bare JSON; list = array `orderByDesc(id)`; rows flattened with owner names.
- `?search=` → `ILIKE` on `name`/`status`; `?branch_id=` narrows for client roles.
- Validation → **422** `{ message, errors }`.

## 2. ENDPOINT INDEX

| # | Verb | Path |
|---|---|---|
| 1 | GET | `/master/digital_twin` |
| 2 | GET | `/master/digital_twin/{id}` |
| 3 | POST | `/master/digital_twin` |
| 4 | PUT | `/master/digital_twin/{id}` |
| 5 | DELETE | `/master/digital_twin/{id}` |
| 6 | GET | `/master/digital_twin/next-code` → `{code:null}` |

## 3. LIST / READ

`GET /api/master/digital_twin?search=pune`

```json
[
  {
    "id": 2, "client_id": 12, "branch_id": 4,
    "name": "Pune Main 3D View", "status": "Active",
    "created_by": 88, "client_name": "IGC GROUP", "branch_name": "Pune",
    "creator_name": "Asha R", "creator_user_type": "branch_user"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/digital_twin`

```json
{ "name": "Mumbai Hub 3D View", "status": "Active" }
```
`201 Created` returns the flattened row. `PUT /{id}` uses the same body.

**422 — duplicate name (`uFields`):**
```json
{ "message": "The name has already been taken.", "errors": { "name": ["The name has already been taken."] } }
```
`name` is unique case-insensitively per tenant.

## 5. DELETE

`DELETE /api/master/digital_twin/{id}` → `{ "message": "Deleted" }` (hard delete). Cross-tier → **403**.

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List/search | `GET /master/digital_twin?search=` |
| Create | `POST /master/digital_twin` |
| Update | `PUT /master/digital_twin/{id}` |
| Delete | `DELETE /master/digital_twin/{id}` |

## 7. NOTES

- Only `name` and `status` are persisted; the visual map is rendered client-side.
- Every write bumps `MasterBundleCache`.

---

*Related documents: DIGITAL_TWIN_FUNCTIONAL_DOCUMENTATION.md · DIGITAL_TWIN_TECHNICAL_DOCUMENTATION.md · DIGITAL_TWIN_CODE_WALKTHROUGH.md*
