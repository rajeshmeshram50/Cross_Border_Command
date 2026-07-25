# PORTS OF DISCHARGE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Ports of Discharge

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.port_of_discharge`; super_admin bypasses.
- Bare responses; rows flattened with `client_name / branch_name / creator_name / creator_user_type`. `orderByDesc(id)`. Failures → **422**.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/port_of_discharge` |
| GET | `/api/master/port_of_discharge/{id}` |
| GET | `/api/master/port_of_discharge/next-code` |
| POST | `/api/master/port_of_discharge` |
| PUT | `/api/master/port_of_discharge/{id}` |
| DELETE | `/api/master/port_of_discharge/{id}` |

---

## 3. LIST / READ

`GET /api/master/port_of_discharge?country_id=7&search=jebel`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "name": "Port Jebel Ali",
    "code": "AEJEA",
    "country_id": 7,
    "city": "Dubai",
    "status": "Active",
    "created_by": 3,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Rajesh",
    "creator_user_type": "client_admin"
  }
]
```

- `?country_id=` — returns only that country's discharge ports (this master has the column, so the filter works).
- `?search=` — ILIKE over `name`, `code`, `city`, `status`.

---

## 4. CREATE / UPDATE

`POST /api/master/port_of_discharge`

```json
{ "name": "Port Jebel Ali", "code": "AEJEA", "country_id": 7, "city": "Dubai", "status": "Active" }
```

Returns **201** with the flattened row. `PUT /{id}` accepts the same body.

**422 errors specific to this master:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate name (case-insensitive) | `name` | `This Name is already registered. Please use a different value.` |
| Duplicate code (case-insensitive) | `code` | `This Code is already registered. Please use a different value.` |
| Missing name/code/country/status | field | required |
| Bad status | `status` | must be Active or Inactive |

---

## 5. DELETE

`DELETE /api/master/port_of_discharge/{id}` → `{ "message": "Deleted" }` (soft delete). Guard: `hierarchicalDenial` → **403** when the row's tier exceeds the caller's. No in-use / system-seed guard.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| Ports of a country | `GET /master/port_of_discharge?country_id=7` |
| Create | `POST /master/port_of_discharge` |
| Update | `PUT /master/port_of_discharge/{id}` |
| Delete | `DELETE /master/port_of_discharge/{id}` |

---

## 7. NOTES

- `next-code` ⇒ `{code:null}` — `code` is user-entered.
- `country_id` is required; `city` is optional (empty → `NULL`).
- Writes bump `MasterBundleCache`.

---

*Related documents: PORT_OF_DISCHARGE_FUNCTIONAL_DOCUMENTATION.md, PORT_OF_DISCHARGE_TECHNICAL_DOCUMENTATION.md, PORT_OF_DISCHARGE_CODE_WALKTHROUGH.md*
