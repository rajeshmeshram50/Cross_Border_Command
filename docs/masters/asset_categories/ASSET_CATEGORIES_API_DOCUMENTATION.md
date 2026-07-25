# ASSET CATEGORIES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Asset Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. Conventions

- Base `/api`, `Authorization: Bearer <sanctum>` + `user.active` on all routes.
- Permission module: `master.asset_categories`.
- JSON in/out (no file uploads). GETs auto-receive `?branch_id=` from the frontend.
- Bare responses; ownership names flattened onto each row.

## 2. Endpoint Index

| Verb | Path | Perm |
|---|---|---|
| GET | `/master/asset_categories` | can_view |
| GET | `/master/asset_categories/{id}` | can_view |
| POST | `/master/asset_categories` | can_add |
| PUT | `/master/asset_categories/{id}` | can_edit |
| DELETE | `/master/asset_categories/{id}` | can_delete |

## 3. List / Read

`GET /master/asset_categories?search=laptop`

```json
[
  {
    "id": 1,
    "client_id": 12, "branch_id": null,
    "name": "Laptop",
    "depreciation_rate": "33.00",
    "useful_life_years": 3,
    "status": "Active",
    "is_system": true,
    "created_by": null,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": null
  }
]
```

`search` matches `name`, `status` (ilike).

## 4. Create / Update

`POST /master/asset_categories`

```json
{ "name": "Machinery", "depreciation_rate": 15, "useful_life_years": 7, "status": "Active" }
```

**201** returns the created row. **422** on duplicate name:
```json
{ "message": "The name has already been taken.",
  "errors": { "name": ["The name has already been taken."] } }
```

`PUT /master/asset_categories/{id}` — same body. Editing a system-seeded row is blocked:
```json
{ "message": "This record is system-managed and cannot be edited. Create a custom entry if you need different values." }
```
(HTTP **403**.)

## 5. Delete

`DELETE /master/asset_categories/{id}` → `{ "message": "Deleted" }` (soft delete).

**System-seeded row → 403:**
```json
{ "message": "This category is system-managed and cannot be deleted." }
```

## 6. Quick Reference

| Need | Call |
|---|---|
| List | `GET /master/asset_categories` |
| Create | `POST /master/asset_categories` |
| Rename / retune | `PUT /master/asset_categories/{id}` |
| Delete (non-system) | `DELETE /master/asset_categories/{id}` |

## 7. Notes

- `next-code` for this slug returns `{code:null}` (no auto-code series).
- `depreciation_rate` may serialize as a decimal string when cast on the model layer; `useful_life_years` is an integer.
- Body `client_id`/`branch_id` ignored for non-super users.

---

*Related documents: ASSET_CATEGORIES_FUNCTIONAL_DOCUMENTATION.md, ASSET_CATEGORIES_TECHNICAL_DOCUMENTATION.md, ASSET_CATEGORIES_CODE_WALKTHROUGH.md*
