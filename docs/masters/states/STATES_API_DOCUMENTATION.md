# STATES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → States

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.states`; super_admin bypasses.
- Bare responses; rows flattened with `client_name / branch_name / creator_name / creator_user_type`. `orderByDesc(id)`. Failures → **422** with `errors`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/states` |
| GET | `/api/master/states/{id}` |
| GET | `/api/master/states/next-code` |
| POST | `/api/master/states` |
| PUT | `/api/master/states/{id}` |
| DELETE | `/api/master/states/{id}` |

---

## 3. LIST / READ

`GET /api/master/states?country_id=1&search=maha`

```json
[
  {
    "id": 501,
    "client_id": null,
    "branch_id": null,
    "country_id": 1,
    "name": "Maharashtra",
    "status": "Active",
    "created_by": 1,
    "client_name": null,
    "branch_name": null,
    "creator_name": "System",
    "creator_user_type": "super_admin"
  }
]
```

- `?country_id=` — returns only that country's states (recommended; the table is huge).
- `?search=` — ILIKE over `name`, `status` (and `country_id` is a select but numeric FK, matched as text via ILIKE too).

---

## 4. CREATE / UPDATE

`POST /api/master/states`

```json
{ "country_id": 1, "name": "Gujarat", "status": "Active" }
```

Returns **201** with the flattened row. `PUT /{id}` accepts the same body.

**422 errors specific to this master:**

| Trigger | Field | Message |
|---|---|---|
| Same name under same country (case-insensitive) | `name` | `A record with this combination of name + country_id already exists.` |
| Missing country/name/status | field | required |
| Bad status | `status` | must be Active or Inactive |

The same state name is allowed under a **different** `country_id`.

---

## 5. DELETE

`DELETE /api/master/states/{id}` → `{ "message": "Deleted" }` (soft delete). Guard: `hierarchicalDenial` → **403** when the row's tier exceeds the caller's. No in-use / system-seed guard.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| States of a country | `GET /master/states?country_id=1` |
| Create | `POST /master/states` |
| Update | `PUT /master/states/{id}` |
| Delete | `DELETE /master/states/{id}` |

---

## 7. NOTES

- `next-code` ⇒ `{code:null}`.
- Prefer `?country_id=` for lists; unfiltered pulls the whole large table.
- Writes bump `MasterBundleCache`.

---

*Related documents: STATES_FUNCTIONAL_DOCUMENTATION.md, STATES_TECHNICAL_DOCUMENTATION.md, STATES_CODE_WALKTHROUGH.md*
