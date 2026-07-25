# PORTS OF LOADING MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Ports of Loading

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.port_of_loading`; super_admin bypasses.
- Bare responses; rows flattened with `client_name / branch_name / creator_name / creator_user_type`. `orderByDesc(id)`. Failures → **422**.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/port_of_loading` |
| GET | `/api/master/port_of_loading/{id}` |
| GET | `/api/master/port_of_loading/next-code` |
| POST | `/api/master/port_of_loading` |
| PUT | `/api/master/port_of_loading/{id}` |
| DELETE | `/api/master/port_of_loading/{id}` |

---

## 3. LIST / READ

`GET /api/master/port_of_loading?search=chennai`

```json
[
  {
    "id": 3,
    "client_id": 12,
    "branch_id": null,
    "name": "Chennai Port",
    "code": "INMAA",
    "address": "Chennai Port Trust, Chennai - 600001",
    "status": "Active",
    "created_by": 3,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Rajesh",
    "creator_user_type": "client_admin"
  }
]
```

`?search=` runs ILIKE over `name`, `code`, `address`, `status`.

---

## 4. CREATE / UPDATE

`POST /api/master/port_of_loading`

```json
{ "name": "Mundra Port", "code": "INMUN", "address": "Mundra, Kutch, Gujarat", "status": "Active" }
```

Returns **201** with the flattened row. `PUT /{id}` accepts the same body.

**422 errors specific to this master:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate name (case-insensitive) | `name` | `This Name is already registered. Please use a different value.` |
| Duplicate code (case-insensitive) | `code` | `This Code is already registered. Please use a different value.` |
| Missing name/code/status | field | required |
| Bad status | `status` | must be Active or Inactive |

---

## 5. DELETE

`DELETE /api/master/port_of_loading/{id}` → `{ "message": "Deleted" }` (soft delete). Guard: `hierarchicalDenial` → **403** when the row's tier exceeds the caller's. No in-use / system-seed guard.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List ports | `GET /master/port_of_loading` |
| Create | `POST /master/port_of_loading` |
| Update | `PUT /master/port_of_loading/{id}` |
| Delete | `DELETE /master/port_of_loading/{id}` |

---

## 7. NOTES

- `next-code` ⇒ `{code:null}` — the `code` field is user-entered, not auto-generated.
- `address` is optional; empty → `NULL`.
- Writes bump `MasterBundleCache`.

---

*Related documents: PORT_OF_LOADING_FUNCTIONAL_DOCUMENTATION.md, PORT_OF_LOADING_TECHNICAL_DOCUMENTATION.md, PORT_OF_LOADING_CODE_WALKTHROUGH.md*
