# CURRENCIES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Currencies

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.currencies` (super admins bypass).
- Bare JSON; ownership names flattened; lists `orderByDesc(id)`.
- 422 on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/currencies` |
| POST | `/master/currencies` |
| GET | `/master/currencies/next-code` |
| GET | `/master/currencies/{id}` |
| PUT | `/master/currencies/{id}` |
| DELETE | `/master/currencies/{id}` |

---

## 3. LIST / READ

`GET /master/currencies?search=dollar`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "name": "US Dollar",
    "code": "USD",
    "symbol": "$",
    "exchange_rate": "83.50",
    "status": "Active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Asha K"
  }
]
```

Search matches `name`, `code`, `symbol`, `status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/currencies`

```json
{ "name": "Euro", "code": "EUR", "symbol": "€", "exchange_rate": 90.20, "status": "Active" }
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

A duplicate `name` produces the analogous "This Name is already registered" error.

`PUT /master/currencies/{id}` — same body.

---

## 5. DELETE

`DELETE /master/currencies/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard; a tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `name` | string | Yes | max 50, unique (case-insensitive) |
| `code` | string | Yes | max 50, unique (case-insensitive) |
| `symbol` | string | Yes | max 50 |
| `exchange_rate` | number | No | numeric |
| `status` | string | Yes | Active / Inactive |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- Backend enforces uniqueness on both `name` and `code` even though the frontend hints only `code`.
- `exchange_rate` is manual — no live market feed.

---
*Related documents: CURRENCIES_FUNCTIONAL_DOCUMENTATION.md, CURRENCIES_TECHNICAL_DOCUMENTATION.md, CURRENCIES_CODE_WALKTHROUGH.md*
