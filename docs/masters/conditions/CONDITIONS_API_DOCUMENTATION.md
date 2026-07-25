# PRODUCT CONDITIONS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Product Conditions

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.conditions` (super admins bypass).
- Bare JSON; ownership names flattened; lists `orderByDesc(id)`.
- 422 on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/conditions` |
| POST | `/master/conditions` |
| GET | `/master/conditions/next-code` |
| GET | `/master/conditions/{id}` |
| PUT | `/master/conditions/{id}` |
| DELETE | `/master/conditions/{id}` |

---

## 3. LIST / READ

`GET /master/conditions?search=cold`

```json
[
  {
    "id": 6,
    "client_id": 12,
    "branch_id": null,
    "title": "Cold Chain",
    "status": "Active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Asha K"
  }
]
```

Search matches `title`, `status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/conditions`

```json
{ "title": "Frozen", "status": "Active" }
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

`PUT /master/conditions/{id}` — same body.

---

## 5. DELETE

`DELETE /master/conditions/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard; a tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `title` | string | Yes | max 50, unique (case-insensitive) |
| `status` | string | Yes | Active / Inactive |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- The digit-only title guard is applied on the frontend only; the API accepts any string within the length cap.

---
*Related documents: CONDITIONS_FUNCTIONAL_DOCUMENTATION.md, CONDITIONS_TECHNICAL_DOCUMENTATION.md, CONDITIONS_CODE_WALKTHROUGH.md*
