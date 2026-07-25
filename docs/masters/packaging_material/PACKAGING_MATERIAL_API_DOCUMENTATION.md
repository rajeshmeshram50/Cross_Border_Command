# PACKAGING MATERIALS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Packaging Materials

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.packaging_material` (super admins bypass).
- Bare JSON; ownership names flattened; lists `orderByDesc(id)`.
- 422 on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/packaging_material` |
| POST | `/master/packaging_material` |
| GET | `/master/packaging_material/next-code` |
| GET | `/master/packaging_material/{id}` |
| PUT | `/master/packaging_material/{id}` |
| DELETE | `/master/packaging_material/{id}` |

---

## 3. LIST / READ

`GET /master/packaging_material?search=bag`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "title": "PP Bag",
    "material_type": "Bag",
    "status": "Active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Asha K"
  }
]
```

Search matches `title`, `material_type`, `status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/packaging_material`

```json
{ "title": "Corrugated Box", "material_type": "Box", "status": "Active" }
```

Returns `201`.

**422 examples**

```json
{ "message": "The title field is required.", "errors": { "title": ["The title field is required."] } }
```

```json
{ "message": "This Title is already registered. Please use a different value.",
  "errors": { "title": ["This Title is already registered. Please use a different value."] } }
```

`PUT /master/packaging_material/{id}` — same body.

---

## 5. DELETE

`DELETE /master/packaging_material/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard; a tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `title` | string | Yes | max 50, unique (case-insensitive) |
| `material_type` | string | No | Bag / Box / Crate / Drum / Pallet / Wrap / Other |
| `status` | string | Yes | Active / Inactive |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- `material_type` is optional but, when present, must match one of the fixed options.

---
*Related documents: PACKAGING_MATERIAL_FUNCTIONAL_DOCUMENTATION.md, PACKAGING_MATERIAL_TECHNICAL_DOCUMENTATION.md, PACKAGING_MATERIAL_CODE_WALKTHROUGH.md*
