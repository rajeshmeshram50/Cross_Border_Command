# DOCUMENT TYPES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Document Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>` + active user required.
- Slug `document_type`; permission module `master.document_type`.
- Bare responses; lists ordered newest-id-first.
- `?search=` ILIKE across text/select fields; `?branch_id=` narrows for client admins.
- Validation → **HTTP 422**; permission denial → **HTTP 403**.

---

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/document_type` | List |
| GET | `/master/document_type/{id}` | Single record |
| POST | `/master/document_type` | Create |
| PUT | `/master/document_type/{id}` | Update |
| DELETE | `/master/document_type/{id}` | Soft delete |
| GET | `/master/document_type/next-code` | `{ "code": null }` |

---

## 3. LIST / READ

`GET /master/document_type`

```json
[
  {
    "id": 5,
    "client_id": 12,
    "branch_id": null,
    "title": "Certificate of Analysis",
    "applicable_to": "Supplier",
    "is_mandatory": "Yes",
    "status": "Active",
    "created_by": 3,
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin User",
    "creator_user_type": "client_admin"
  }
]
```

---

## 4. CREATE / UPDATE

`POST /master/document_type`

```json
{
  "title": "GST Registration Certificate",
  "applicable_to": "Both",
  "is_mandatory": "Yes",
  "status": "Active"
}
```

Returns `201`. `PUT /master/document_type/{id}` uses the same body.

**422 — duplicate title:**
```json
{ "title": ["This Title is already registered. Please use a different value."] }
```

**422 — bad enum:**
```json
{ "applicable_to": ["The selected applicable to is invalid."] }
```

---

## 5. DELETE

`DELETE /master/document_type/{id}` → `{ "message": "Deleted" }` (soft). Returns `403` if the hierarchical gate denies. No system-seed lock on this master.

---

## 6. QUICK REFERENCE

| Field | Rule |
|---|---|
| title | required, string ≤50, unique (ci) |
| applicable_to | nullable, in: Customer, Vendor, Supplier, Both, Internal |
| is_mandatory | nullable, in: Yes, No |
| status | required, in: Active, Inactive |

---

## 7. NOTES

- `applicable_to` accepts **Vendor** server-side even though the React dropdown omits it.
- `next-code` returns `{code:null}`.

---
*Related documents: DOCUMENT_TYPE_FUNCTIONAL_DOCUMENTATION.md, DOCUMENT_TYPE_TECHNICAL_DOCUMENTATION.md, DOCUMENT_TYPE_CODE_WALKTHROUGH.md*
