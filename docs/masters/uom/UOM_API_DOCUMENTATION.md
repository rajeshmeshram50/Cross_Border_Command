# UNITS OF MEASUREMENT MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Units of Measurement

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.uom` (super admins bypass).
- Bare JSON; ownership names flattened; lists `orderByDesc(id)`.
- 422 on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/uom` |
| POST | `/master/uom` |
| GET | `/master/uom/next-code` |
| GET | `/master/uom/{id}` |
| PUT | `/master/uom/{id}` |
| DELETE | `/master/uom/{id}` |

---

## 3. LIST / READ

`GET /master/uom?search=kg`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "title": "Kilogram",
    "short_code": "KG",
    "unit_type": "Weight",
    "status": "Active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Asha K"
  }
]
```

Search matches `title`, `short_code`, `unit_type`, `status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/uom`

```json
{ "title": "Metric Ton", "short_code": "MT", "unit_type": "Weight", "status": "Active" }
```

Returns `201`. `short_code` is required — supply it explicitly (the UI auto-derives it, but the API does not).

**422 examples**

```json
{ "message": "The short code field is required.", "errors": { "short_code": ["The short code field is required."] } }
```

```json
{ "message": "This Short code is already registered. Please use a different value.",
  "errors": { "short_code": ["This Short code is already registered. Please use a different value."] } }
```

A duplicate `title` produces the analogous "This Title is already registered" error.

`PUT /master/uom/{id}` — same body.

---

## 5. DELETE

`DELETE /master/uom/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard; a tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `title` | string | Yes | max 50, unique (case-insensitive) |
| `short_code` | string | Yes | max 50, unique (case-insensitive) |
| `unit_type` | string | No | Weight / Volume / Length / Area / Count / Other |
| `status` | string | Yes | Active / Inactive |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- The short-code auto-derive is a frontend behaviour; direct API callers must provide `short_code`.
- Both `title` and `short_code` are independently unique per tenant tuple.

---
*Related documents: UOM_FUNCTIONAL_DOCUMENTATION.md, UOM_TECHNICAL_DOCUMENTATION.md, UOM_CODE_WALKTHROUGH.md*
