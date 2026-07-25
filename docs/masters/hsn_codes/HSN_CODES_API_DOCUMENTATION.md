# HSN CODES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → HSN Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.hsn_codes` (super admins bypass).
- Bare JSON responses; ownership names flattened; lists `orderByDesc(id)`.
- 422 on validation failure: `{ "message": ..., "errors": { field: [...] } }`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/hsn_codes` |
| POST | `/master/hsn_codes` |
| GET | `/master/hsn_codes/next-code` |
| GET | `/master/hsn_codes/{id}` |
| PUT | `/master/hsn_codes/{id}` |
| DELETE | `/master/hsn_codes/{id}` |

---

## 3. LIST / READ

`GET /master/hsn_codes?search=almond&branch_id=7`

```json
[
  {
    "id": 3,
    "client_id": 12,
    "branch_id": 7,
    "hsn_code": "08021200",
    "description": "Almonds — Shelled",
    "gst_rate_id": 2,
    "status": "Active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Asha K"
  }
]
```

Search matches `hsn_code`, `description`, `status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/hsn_codes`

```json
{ "hsn_code": "12074000", "description": "Sesame Seeds", "gst_rate_id": 2, "status": "Active" }
```

Returns `201` with the created row.

**422 — regex**

```json
{ "message": "HSN/SAC code must be 4 to 10 digits.",
  "errors": { "hsn_code": ["HSN/SAC code must be 4 to 10 digits."] } }
```

**422 — duplicate**

```json
{ "message": "This HSN/SAC code is already registered. Please use a different value.",
  "errors": { "hsn_code": ["This HSN/SAC code is already registered. Please use a different value."] } }
```

`PUT /master/hsn_codes/{id}` — same body.

---

## 5. DELETE

`DELETE /master/hsn_codes/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard on this master; a tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `hsn_code` | string | Yes | `^[0-9]{4,10}$`, unique (case-insensitive) |
| `description` | string | Yes | textarea |
| `gst_rate_id` | integer | No | ref → gst_percentage |
| `status` | string | Yes | Active / Inactive |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- The GST Rate dropdown is sourced from `/master/gst_percentage`; options render as `{percentage}%`.
- You cannot delete a GST rate that is referenced by any HSN code — that returns `409` on the GST Percentage endpoint.

---
*Related documents: HSN_CODES_FUNCTIONAL_DOCUMENTATION.md, HSN_CODES_TECHNICAL_DOCUMENTATION.md, HSN_CODES_CODE_WALKTHROUGH.md*
