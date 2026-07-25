# ASSETS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Assets

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. Conventions

- Base: `/api`. All routes require `Authorization: Bearer <sanctum>` + `user.active`.
- Permission module: `master.assets`.
- **Create/Update use `multipart/form-data`** because of the two file uploads. GETs auto-receive `?branch_id=` from the frontend Axios interceptor.
- Responses are bare (array for list, object for item). Ownership names are flattened onto each row.

## 2. Endpoint Index

| Verb | Path | Perm |
|---|---|---|
| GET | `/master/assets` | can_view |
| GET | `/master/assets/{id}` | can_view |
| GET | `/master/assets/next-code` | can_view |
| POST | `/master/assets` | can_add |
| PUT | `/master/assets/{id}` | can_edit |
| DELETE | `/master/assets/{id}` | can_delete |

## 3. List / Read

`GET /master/assets?search=laptop`

```json
[
  {
    "id": 7,
    "client_id": 12, "branch_id": 4,
    "asset_name": "HP Laptop 15s",
    "code": "AST-0007",
    "asset_number": null,
    "asset_type_id": 1,
    "description": "i5 / 16GB / 512 SSD",
    "vendor_id": 3,
    "purchase_date": "2026-03-28",
    "warranty_expiry_date": "2027-03-28",
    "invoice_file_path": "master/assets/9fK2...pdf",
    "warranty_card_file_path": null,
    "assign_date": null,
    "status": "Active",
    "created_by": 55,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Asha R"
  }
]
```

`search` matches `asset_name`, `code`, `description`, `status` (ilike). File paths resolve to URLs on the frontend via `resolveFileUrl`.

## 4. Create / Update

`POST /master/assets` — `multipart/form-data`:

```
asset_name           = HP Laptop 15s
asset_type_id        = 1
vendor_id            = 3
purchase_date        = 2026-03-28
warranty_expiry_date = 2027-03-28
status               = Active
invoice_file         = @invoice.pdf          (→ invoice_file_path)
warranty_card_file   = @warranty.jpg         (→ warranty_card_file_path)
```

- `code` omitted → server assigns `AST-####`.
- `next-code` for assets returns `{"code": null}` (auto-code is model-side, not via AUTO_CODES); the form previews the ID locally.
- `PUT /master/assets/{id}` accepts the same multipart body; sending a new `invoice_file` replaces + deletes the previous file.

**422 (duplicate name or code):**
```json
{ "message": "The asset name has already been taken.",
  "errors": { "asset_name": ["The asset name has already been taken."] } }
```

## 5. Delete

`DELETE /master/assets/{id}` → `{ "message": "Deleted" }` (soft delete). A 403 is returned if the hierarchical rule denies the caller (row owned by a higher tier).

## 6. Quick Reference

| Need | Call |
|---|---|
| List | `GET /master/assets` |
| Create w/ files | `POST /master/assets` (multipart) |
| Replace invoice | `PUT /master/assets/{id}` (multipart, `invoice_file`) |
| Delete | `DELETE /master/assets/{id}` |

## 7. Notes

- Sending `invoice_file` / `warranty_card_file` as JSON (non-multipart) will not upload; must be multipart.
- `client_id`/`branch_id` in the body are ignored for non-super users (stamped from the token).

---

*Related documents: ASSETS_FUNCTIONAL_DOCUMENTATION.md, ASSETS_TECHNICAL_DOCUMENTATION.md, ASSETS_CODE_WALKTHROUGH.md*
