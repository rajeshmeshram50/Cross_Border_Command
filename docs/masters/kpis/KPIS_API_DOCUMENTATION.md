# KPI MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → KPI Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `auth:sanctum` + `user.active`; `Authorization: Bearer <token>`.
- Bare responses (no `{data}`); rows flattened with `client_name/branch_name/creator_name/creator_user_type`.
- Errors: HTTP 422 `{ message, errors }`.

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/kpis` | List (?search=, ?branch_id=) |
| POST | `/master/kpis` | Create |
| GET | `/master/kpis/next-code` | `{ "code": null }` |
| GET | `/master/kpis/{id}` | Show |
| PUT | `/master/kpis/{id}` | Update |
| DELETE | `/master/kpis/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/kpis?search=revenue`

```json
[
  {
    "id": 2,
    "client_id": 12,
    "branch_id": null,
    "name": "Revenue Growth",
    "description": "Quarter-on-quarter revenue increase",
    "role_id": 8,
    "target_type": "Percentage",
    "priority": "Critical",
    "status": "Active",
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin",
    "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/kpis`

```json
{
  "name": "Revenue Growth",
  "description": "Quarter-on-quarter revenue increase",
  "role_id": 8,
  "target_type": "Percentage",
  "priority": "Critical",
  "status": "Active"
}
```

- Returns `201`. `PUT /api/master/kpis/{id}` uses the same body (name uniqueness ignores the current id).

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate KPI name (case-insensitive) | name | `This Name is already registered. Please use a different value.` |
| Missing required | name / role_id / target_type / priority / status | `The <field> field is required.` |
| Bad target_type | target_type | `The selected target type is invalid.` |
| Bad priority | priority | `The selected priority is invalid.` |

## 5. DELETE

`DELETE /api/master/kpis/{id}` → `{ "message": "Deleted" }` (soft). Tier gate via `hierarchicalDenial`. No in-use guard.

## 6. QUICK REFERENCE

```
GET    /api/master/kpis
POST   /api/master/kpis
GET    /api/master/kpis/{id}
PUT    /api/master/kpis/{id}
DELETE /api/master/kpis/{id}
```

## 7. NOTES

- `role_id` references the Roles master (assigns the KPI to a role).
- Only `name` is unique (case-insensitive).
- `next-code` returns `{code: null}` — no auto-numbering.

---
*Related documents: KPIS_FUNCTIONAL_DOCUMENTATION.md, KPIS_TECHNICAL_DOCUMENTATION.md, KPIS_CODE_WALKTHROUGH.md*
