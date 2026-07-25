# GST PERCENTAGES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → GST Percentages

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>`; `auth:sanctum` + `user.active`.
- Permission module `master.gst_percentage` (super admins bypass).
- Bare JSON; ownership names flattened; lists `orderByDesc(id)`. Each row includes the computed `in_use` boolean.
- 422 on validation failure; **409** on the in-use delete guard.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/gst_percentage` |
| POST | `/master/gst_percentage` |
| GET | `/master/gst_percentage/next-code` |
| GET | `/master/gst_percentage/{id}` |
| PUT | `/master/gst_percentage/{id}` |
| DELETE | `/master/gst_percentage/{id}` |

---

## 3. LIST / READ

`GET /master/gst_percentage`

```json
[
  {
    "id": 4,
    "client_id": 12,
    "branch_id": null,
    "percentage": "18.00",
    "status": "Active",
    "created_by": 40,
    "in_use": true,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Asha K"
  }
]
```

`in_use` is `true` when any product (`gst_id`) or HSN code (`gst_rate_id`) references the row.

---

## 4. CREATE / UPDATE

`POST /master/gst_percentage`

```json
{ "percentage": 12, "status": "Active" }
```

Returns `201`.

**422 examples**

```json
{ "message": "The percentage field is required.", "errors": { "percentage": ["The percentage field is required."] } }
```

```json
{ "message": "The percentage must be a number.", "errors": { "percentage": ["The percentage must be a number."] } }
```

Duplicate value → 422 (`percentage` already exists in the tenant scope).

`PUT /master/gst_percentage/{id}` — same body.

---

## 5. DELETE

`DELETE /master/gst_percentage/{id}`

Success → `{ "message": "Deleted" }`.

**409 — in use**

```json
{
  "message": "This GST rate is in use by 3 products and 1 HSN code and cannot be deleted. Reassign those records to another GST rate first."
}
```

A tier/ownership violation returns `403` (checked before the 409 guard).

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `percentage` | number | Yes | numeric, unique (exact, tenant-scoped) |
| `status` | string | Yes | Active / Inactive |

Response adds `in_use` (bool). `next-code` → `{ "code": null }`.

---

## 7. NOTES

- The 0–100 cap is a frontend guard; the master API only enforces `numeric`. The DB column is `DECIMAL(5,2)` — very large values overflow.
- To delete a rate in use, first reassign the dependent products/HSN codes to another rate.

---
*Related documents: GST_PERCENTAGE_FUNCTIONAL_DOCUMENTATION.md, GST_PERCENTAGE_TECHNICAL_DOCUMENTATION.md, GST_PERCENTAGE_CODE_WALKTHROUGH.md*
