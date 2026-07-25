# STATE CODES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → State Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.state_codes`; super_admin bypasses.
- Bare responses; rows flattened with `client_name / branch_name / creator_name / creator_user_type`. `orderByDesc(id)`. Failures → **422**.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/state_codes` |
| GET | `/api/master/state_codes/{id}` |
| GET | `/api/master/state_codes/next-code` |
| POST | `/api/master/state_codes` |
| PUT | `/api/master/state_codes/{id}` |
| DELETE | `/api/master/state_codes/{id}` |

---

## 3. LIST / READ

`GET /api/master/state_codes?search=27`

```json
[
  {
    "id": 88,
    "client_id": null,
    "branch_id": null,
    "state_id": 501,
    "state_code": "27",
    "status": "Active",
    "created_by": 1,
    "state": { "id": 501, "name": "Maharashtra", "country_id": 1 },
    "client_name": null,
    "branch_name": null,
    "creator_name": "System",
    "creator_user_type": "super_admin"
  }
]
```

The nested `state` object (id, name, country_id) is eager-loaded so the grid can show the state name and cascade off country without extra calls. `?search=` runs ILIKE over `state_code`, `status` (and `state_id` as text).

---

## 4. CREATE / UPDATE

`POST /api/master/state_codes`

```json
{ "state_id": 501, "state_code": "27", "status": "Active" }
```

Returns **201** with the flattened row (plus nested `state` after reload). `PUT /{id}` accepts the same body.

**422 errors specific to this master:**

| Trigger | Field | Message |
|---|---|---|
| Same state + code (case-insensitive on code) | `state_id` | `A record with this combination of state_id + state_code already exists.` |
| Missing state/code/status | field | required |
| Bad status | `status` | must be Active or Inactive |

---

## 5. DELETE

`DELETE /api/master/state_codes/{id}` → `{ "message": "Deleted" }` (soft delete). Guard: `hierarchicalDenial` → **403** if the row's tier exceeds the caller's. No in-use / system-seed guard.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List codes (with state name) | `GET /master/state_codes` |
| Create | `POST /master/state_codes` |
| Update | `PUT /master/state_codes/{id}` |
| Delete | `DELETE /master/state_codes/{id}` |

---

## 7. NOTES

- `next-code` ⇒ `{code:null}`.
- The `?country_id=` filter does **not** narrow state codes (no such column); filter by country client-side using the eager-loaded `state.country_id`.
- Writes bump `MasterBundleCache`.

---

*Related documents: STATE_CODES_FUNCTIONAL_DOCUMENTATION.md, STATE_CODES_TECHNICAL_DOCUMENTATION.md, STATE_CODES_CODE_WALKTHROUGH.md*
