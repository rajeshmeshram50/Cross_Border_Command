# ADDRESS TYPES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Address Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.address_types`; super_admin bypasses the permission check but **not** the create lock.
- Bare responses; rows flattened with `client_name / branch_name / creator_name / creator_user_type`. `orderByDesc(id)`. Failures → **422**; locks → **403**.

---

## 2. ENDPOINT INDEX

| Verb | Path | Note |
|---|---|---|
| GET | `/api/master/address_types` | list |
| GET | `/api/master/address_types/{id}` | read |
| GET | `/api/master/address_types/next-code` | `{code:null}` |
| POST | `/api/master/address_types` | **always 403** |
| PUT | `/api/master/address_types/{id}` | 403 if `is_system` |
| DELETE | `/api/master/address_types/{id}` | 403 if `is_system` |

---

## 3. LIST / READ

`GET /api/master/address_types`

```json
[
  {
    "id": 1,
    "client_id": null,
    "branch_id": null,
    "name": "Registered Office",
    "status": "Active",
    "is_system": true,
    "created_by": 1,
    "client_name": null,
    "branch_name": null,
    "creator_name": "System",
    "creator_user_type": "super_admin"
  }
]
```

`?search=` runs ILIKE over `name`, `status`.

---

## 4. CREATE / UPDATE

### Create — always blocked

`POST /api/master/address_types` (any body) → **403**:

```json
{ "message": "Address Types is a fixed master. Only Registered Office, Warehouse, and Branch are allowed — no new types can be added." }
```

### Update

`PUT /api/master/address_types/{id}` with `{ "name": "Warehouse", "status": "Inactive" }`:

- If the row has `is_system = true` → **403** `{ "message": "This record is system-managed and cannot be edited. Create a custom entry if you need different values." }`
- Editing the `name` of a canonical row also trips the model guard (`RuntimeException`).
- **422** (only reachable on a non-system row): duplicate `name` → `This Name is already registered…`; or system-seed collision → `"<name>" is a system-managed Name and cannot be re-created.`

---

## 5. DELETE

`DELETE /api/master/address_types/{id}`:

- `is_system` row → **403** `{ "message": "This address type is system-managed and cannot be deleted." }`
- A `FIXED_NAMES` row (Warehouse / Registered Office / Billing Address) also trips the model's `deleting` guard.
- `hierarchicalDenial` applies first for any non-system row.

---

## 6. QUICK REFERENCE

| Need | Call | Result |
|---|---|---|
| List types | `GET /master/address_types` | rows |
| Add a type | `POST /master/address_types` | **403 (blocked)** |
| Edit system type | `PUT /master/address_types/{id}` | **403** |
| Delete system type | `DELETE /master/address_types/{id}` | **403** |

---

## 7. NOTES

- This is a read-only vocabulary in practice; there is no supported way to mutate it through the API.
- `next-code` ⇒ `{code:null}`.

---

*Related documents: ADDRESS_TYPES_FUNCTIONAL_DOCUMENTATION.md, ADDRESS_TYPES_TECHNICAL_DOCUMENTATION.md, ADDRESS_TYPES_CODE_WALKTHROUGH.md*
