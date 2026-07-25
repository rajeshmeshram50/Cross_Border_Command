# ORGANIZATION TYPES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Organization Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; all routes require `auth:sanctum` + `user.active`.
- This master uses its **own controller** at `/organization-types` (an `apiResource`), **not** the generic `/master/{slug}` engine.
- Reads (`index`, `show`) are open to any authenticated user; **writes are super-admin only** (403 otherwise).
- Responses are bare model JSON (no `{data}` wrapper, no ownership flattening).
- Validation errors: HTTP 422 `{ message, errors }`.

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/organization-types` | List (?active_only=1, ?search=) |
| POST | `/organization-types` | Create (super admin) |
| GET | `/organization-types/{id}` | Show one |
| PUT | `/organization-types/{id}` | Update (super admin) |
| DELETE | `/organization-types/{id}` | Delete (super admin, in-use guarded) |

## 3. LIST / READ

`GET /api/organization-types?active_only=1`

```json
[
  { "id": 1, "name": "Manufacturing", "slug": "manufacturing", "icon": "ri-building-line",
    "description": "Producers of physical goods", "status": "active", "sort_order": 1 },
  { "id": 2, "name": "Logistics", "slug": "logistics", "icon": "ri-truck-line",
    "description": "Freight & supply chain", "status": "active", "sort_order": 2 }
]
```

Ordered by `sort_order` then `name`. `active_only=1` filters to `status = active`; `search=` runs ILIKE on `name`.

## 4. CREATE / UPDATE

`POST /api/organization-types`

```json
{
  "name": "Healthcare",
  "icon": "ri-hospital-line",
  "description": "Hospitals, clinics, pharma",
  "status": "active",
  "sort_order": 3
}
```

- `slug` is auto-derived from `name` (do not send it). `sort_order` defaults to `max+1` when omitted.
- Returns `201` with the created model. `PUT /organization-types/{id}` uses the same body; `slug` regenerates only if `name` changes.

**Master-specific errors:**

| Trigger | Status | Message |
|---|---|---|
| Non-super-admin write | 403 | `Only super admin can manage organization types.` |
| Duplicate name | 422 | `The name has already been taken.` |
| Missing name/status | 422 | `The <field> field is required.` |
| Bad status value | 422 | `The selected status is invalid.` (only `active`/`inactive`) |

## 5. DELETE

`DELETE /api/organization-types/{id}`

- If any client uses this type (`clients.org_type == name`) → **422** `Cannot delete — this organization type is used by existing clients.`
- Otherwise → `{ "message": "Organization type deleted" }` (hard delete on this model).

## 6. QUICK REFERENCE

```
GET    /api/organization-types?active_only=1
POST   /api/organization-types           (super admin)
GET    /api/organization-types/{id}
PUT    /api/organization-types/{id}      (super admin)
DELETE /api/organization-types/{id}      (super admin, in-use guarded)
```

## 7. NOTES

- Status values are lowercase `active` / `inactive`.
- No `next-code`, no `?branch_id=`/`?client_id=` scoping — this master is platform-global.
- The `/master-counts` dashboard card for this slug is produced by `MasterController::counts`, not this controller.

---
*Related documents: ORGANIZATION_TYPES_FUNCTIONAL_DOCUMENTATION.md, ORGANIZATION_TYPES_TECHNICAL_DOCUMENTATION.md, ORGANIZATION_TYPES_CODE_WALKTHROUGH.md*
