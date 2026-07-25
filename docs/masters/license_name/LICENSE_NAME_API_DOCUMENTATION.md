# LICENSE TYPES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → License Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; all routes require `Authorization: Bearer <token>` + active user.
- Slug: `license_name`. Permission module: `master.license_name`.
- Responses are **bare** (no `{data:...}` envelope). Lists are arrays ordered by newest id first.
- `?search=` does an ILIKE across text/select fields. `?branch_id=` narrows for client admins.
- Validation failures return **HTTP 422** with `{ "<field>": ["message"] }`.

---

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/license_name` | List |
| GET | `/master/license_name/{id}` | Single record |
| POST | `/master/license_name` | Create |
| PUT | `/master/license_name/{id}` | Update |
| DELETE | `/master/license_name/{id}` | Soft delete |
| GET | `/master/license_name/next-code` | `{ "code": null }` |

---

## 3. LIST / READ

`GET /master/license_name`

```json
[
  {
    "id": 3,
    "client_id": 12,
    "branch_id": 4,
    "name": "IEC Code",
    "license_code": "IEC",
    "issuing_authority": "DGFT",
    "validity_months": 0,
    "status": "Active",
    "created_by": 51,
    "created_at": "2026-07-20T09:14:00.000000Z",
    "updated_at": "2026-07-20T09:14:00.000000Z",
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Priya Nair",
    "creator_user_type": "branch_user"
  }
]
```

---

## 4. CREATE / UPDATE

`POST /master/license_name`

```json
{
  "name": "FSSAI License",
  "license_code": "FSSAI",
  "issuing_authority": "FSSAI",
  "validity_months": 12,
  "status": "Active"
}
```

Returns `201` with the created row. `PUT /master/license_name/{id}` uses the same body.

**422 examples:**

```json
{ "name": ["This Name is already registered. Please use a different value."] }
```
```json
{ "license_code": ["This Code is already registered. Please use a different value."] }
```
```json
{ "status": ["The selected status is invalid."] }
```

---

## 5. DELETE

`DELETE /master/license_name/{id}` → `{ "message": "Deleted" }` (soft delete). A `403` is returned if the hierarchical gate denies (e.g. an employee deleting another user's row). No system-seed lock applies to this master.

---

## 6. QUICK REFERENCE

| Field | Rule |
|---|---|
| name | required, string ≤50, unique (ci) |
| license_code | nullable, string ≤50, unique (ci) |
| issuing_authority | nullable, string ≤50 |
| validity_months | nullable, numeric |
| status | required, in: Active, Inactive |

---

## 7. NOTES

- `next-code` returns `{code:null}` — this master has no auto-generated code.
- Every successful write bumps the master-bundle cache used by CLM/KYC dropdowns.

---
*Related documents: LICENSE_NAME_FUNCTIONAL_DOCUMENTATION.md, LICENSE_NAME_TECHNICAL_DOCUMENTATION.md, LICENSE_NAME_CODE_WALKTHROUGH.md*
