# COMPANY DETAILS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Company Details

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base: `/api`. All routes require `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <token>`. GETs auto-carry `?branch_id=` from the branch switcher.
- Responses are **bare** (no `{data}` wrapper). Rows are flattened with `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- Validation failures return HTTP 422 `{ message, errors: { field: [msg] } }`.

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/company` | List (search / branch filter) |
| POST | `/master/company` | Create |
| GET | `/master/company/next-code` | Returns `{ "code": null }` |
| GET | `/master/company/{id}` | Show one |
| PUT | `/master/company/{id}` | Update |
| DELETE | `/master/company/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/company?search=inorbvict`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "company_name": "Inorbvict Healthcare India Pvt Ltd",
    "short_code": "IGC",
    "gstin": "27AADCI6120M1ZH",
    "pan": "AADCI6120M",
    "cin": "U85100PN2014PTC152252",
    "iec": "3114017398",
    "email": "info@inhpl.com",
    "mobile": "+91 98500 00000",
    "city": "Pune",
    "state": "Maharashtra",
    "address": "Solitaire Hub, Balewadi, Pune - 411045",
    "status": "Active",
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin",
    "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/company`

```json
{
  "company_name": "Inorbvict Healthcare India Pvt Ltd",
  "short_code": "IGC",
  "gstin": "27aadci6120m1zh",
  "pan": "aadci6120m",
  "cin": "u85100pn2014ptc152252",
  "iec": "3114017398",
  "email": "info@inhpl.com",
  "status": "Active"
}
```

- `gstin`, `pan`, `cin` are uppercased before validation/storage.
- Returns `201` with the flattened row. `PUT /api/master/company/{id}` uses the same body.

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate name (case-insensitive) | company_name | `This Company name is already registered. Please use a different value.` |
| Duplicate GSTIN | gstin | `This GSTIN is already registered. Please use a different value.` |
| Duplicate PAN | pan | `This PAN is already registered. Please use a different value.` |
| Missing required | company_name / short_code / gstin / pan / status | `The <field> field is required.` |
| Bad status enum | status | `The selected status is invalid.` |

## 5. DELETE

`DELETE /api/master/company/{id}` → `{ "message": "Deleted" }` (soft delete). Blocked with 403 if the caller's tier is below the row's tier (`hierarchicalDenial`). No in-use guard.

## 6. QUICK REFERENCE

```
GET    /api/master/company
POST   /api/master/company
GET    /api/master/company/{id}
PUT    /api/master/company/{id}
DELETE /api/master/company/{id}
```

## 7. NOTES

- `next-code` returns `{code: null}` — this master has no auto-numbering.
- `state` is free text; it is not resolved against the States master.
- Search matches text/email/textarea/select fields via ILIKE.

---
*Related documents: COMPANY_FUNCTIONAL_DOCUMENTATION.md, COMPANY_TECHNICAL_DOCUMENTATION.md, COMPANY_CODE_WALKTHROUGH.md*
