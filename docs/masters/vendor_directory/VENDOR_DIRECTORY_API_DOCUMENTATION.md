# SUPPLIER DIRECTORY MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Directory

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/vendor_directory`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.vendor_directory` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name` / `creator_user_type`.
- `?search=` runs ILIKE across text/email/textarea/select fields (vendor_company_name, contact_person, mobile_number, email_id, address, city, country, mapping_mode, status); `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/vendor_directory` |
| GET | `/api/master/vendor_directory/{id}` |
| POST | `/api/master/vendor_directory` |
| PUT | `/api/master/vendor_directory/{id}` |
| DELETE | `/api/master/vendor_directory/{id}` |
| GET | `/api/master/vendor_directory/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/vendor_directory?search=acme`

```json
[
  {
    "id": 7,
    "client_id": 12,
    "branch_id": 4,
    "vendor_company_name": "Acme Trading LLP",
    "contact_person": "Suresh Rao",
    "mobile_number": "9876543210",
    "email_id": "suresh@acmetrading.com",
    "segment_id": 3,
    "address": "12 Industrial Estate, Phase II",
    "country": "India",
    "state": 21,
    "city": "Pune",
    "mapping_mode": "Map New Vendor",
    "status": "Active",
    "created_by": 88,
    "created_at": "2026-07-20T09:12:00.000000Z",
    "updated_at": "2026-07-20T09:12:00.000000Z",
    "client_name": "IGC GROUP",
    "branch_name": "Pune",
    "creator_name": "Rajesh",
    "creator_user_type": "branch_user"
  }
]
```

`segment_id` (int) and `state` (int) are raw ids; `country` is a string enum. The frontend resolves segment/state labels from its cached master bundle.

---

## 4. CREATE / UPDATE

`POST /api/master/vendor_directory`

```json
{
  "vendor_company_name": "Acme Trading LLP",
  "contact_person": "Suresh Rao",
  "mobile_number": "9876543210",
  "email_id": "suresh@acmetrading.com",
  "segment_id": 3,
  "address": "12 Industrial Estate, Phase II",
  "country": "India",
  "state": 21,
  "city": "Pune",
  "mapping_mode": "Map New Vendor",
  "status": "Active"
}
```

`422` — duplicate (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "email_id": ["This Email id is already registered. Please use a different value."] } }
```
(Same shape for `vendor_company_name` → "This Vendor company name is already registered…" and `mobile_number` → "This Mobile number is already registered…".)

`422` — max length (`vendor_company_name` accepts up to **512** chars):
```json
{ "errors": { "vendor_company_name": ["The vendor company name may not be greater than 512 characters."] } }
```

`PUT /api/master/vendor_directory/{id}` — same body; hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/vendor_directory/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/vendor_directory?search=` |
| Create | `POST /master/vendor_directory` |
| Update | `PUT /master/vendor_directory/{id}` |
| Delete | `DELETE /master/vendor_directory/{id}` |

---

## 7. NOTES

- `segment_id` and `state` are integer references (to `segments` / `states` masters); they validate as integers but accept string-or-int from the UI.
- `country` is a fixed enum string, not a foreign key — the `country_id` cascade filter does not apply.
- `vendor_company_name`, `mobile_number` and `email_id` are each unique (case-insensitive, tenant-scoped).

---
*Related documents: VENDOR_DIRECTORY_FUNCTIONAL_DOCUMENTATION.md, VENDOR_DIRECTORY_TECHNICAL_DOCUMENTATION.md, VENDOR_DIRECTORY_CODE_WALKTHROUGH.md*
