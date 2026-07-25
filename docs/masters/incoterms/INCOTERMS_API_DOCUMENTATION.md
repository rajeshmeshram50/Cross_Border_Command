# INCOTERMS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Incoterms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.incoterms` (super admins bypass).
- Bare JSON; ownership names flattened; lists `orderByDesc(id)`.
- 422 on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/incoterms` |
| POST | `/master/incoterms` |
| GET | `/master/incoterms/next-code` |
| GET | `/master/incoterms/{id}` |
| PUT | `/master/incoterms/{id}` |
| DELETE | `/master/incoterms/{id}` |

---

## 3. LIST / READ

`GET /master/incoterms?search=fob`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "code": "FOB",
    "full_name": "Free On Board",
    "transport_mode": "Sea/Inland Waterway",
    "status": "Active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Asha K"
  }
]
```

Search matches `code`, `full_name`, `transport_mode`, `status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/incoterms`

```json
{ "code": "CIF", "full_name": "Cost Insurance Freight", "transport_mode": "Sea/Inland Waterway", "status": "Active" }
```

Returns `201`.

**422 examples**

```json
{ "message": "The code field is required.", "errors": { "code": ["The code field is required."] } }
```

```json
{ "message": "This Code is already registered. Please use a different value.",
  "errors": { "code": ["This Code is already registered. Please use a different value."] } }
```

A duplicate `full_name` produces the analogous "This Full name is already registered" error.

`PUT /master/incoterms/{id}` — same body.

---

## 5. DELETE

`DELETE /master/incoterms/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard; a tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `code` | string | Yes | max 50, unique (case-insensitive) |
| `full_name` | string | Yes | max 50, unique (case-insensitive) |
| `transport_mode` | string | No | Sea/Inland Waterway / Any Mode / Air / Road / Rail |
| `status` | string | Yes | Active / Inactive |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- Backend enforces uniqueness on both `code` and `full_name` even though the frontend hints only `code`.

---
*Related documents: INCOTERMS_FUNCTIONAL_DOCUMENTATION.md, INCOTERMS_TECHNICAL_DOCUMENTATION.md, INCOTERMS_CODE_WALKTHROUGH.md*
