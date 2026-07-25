# LEGAL ENTITIES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Legal Entities

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `auth:sanctum` + `user.active`; `Authorization: Bearer <token>`.
- Responses bare (no `{data}`), rows flattened with `client_name/branch_name/creator_name/creator_user_type`; Legal Entities rows also carry an inline `banks[]` array.
- Create/update with a logo must be sent as `multipart/form-data`; `banks[]` posted as array fields.
- Errors: HTTP 422 `{ message, errors }`.

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/legal_entities` | List (?search=, ?country_id=, ?branch_id=) |
| POST | `/master/legal_entities` | Create |
| GET | `/master/legal_entities/next-code` | `{ "code": null }` |
| GET | `/master/legal_entities/{id}` | Show (incl. banks[]) |
| PUT | `/master/legal_entities/{id}` | Update |
| DELETE | `/master/legal_entities/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/legal_entities/1`

```json
{
  "id": 1,
  "entity_code": "LE-0001",
  "entity_name": "Inorbvict Healthcare India Pvt Ltd",
  "legal_name": "Inorbvict Healthcare India Private Limited",
  "cin": "U85100PN2014PTC152252",
  "date_of_incorporation": "2014-03-11T00:00:00.000000Z",
  "type_of_business": "Manufacturing",
  "sector": "Healthcare",
  "nature_of_business": "Private Limited",
  "country_id": 1,
  "address_line1": "Solitaire Hub",
  "city": "Pune",
  "state_id": 1,
  "zip_code": "411045",
  "currency_id": 1,
  "financial_year": "April - March",
  "logo_path": "master/legal_entities/abc123.png",
  "status": "Active",
  "client_name": "IGC GROUP",
  "branch_name": null,
  "creator_name": "Admin",
  "banks": [
    { "id": 5, "legal_entity_id": 1, "bank_name": "HDFC Bank", "branch_name": "Baner",
      "account_number": "501000123456", "ifsc_code": "HDFC0000001", "account_type": "Current", "is_primary": true }
  ]
}
```

## 4. CREATE / UPDATE

`POST /api/master/legal_entities` (multipart)

```
entity_name       = Inorbvict Healthcare India Pvt Ltd
legal_name        = Inorbvict Healthcare India Private Limited
cin               = U85100PN2014PTC152252
date_of_incorporation = 2014-03-11
type_of_business  = Manufacturing
sector            = Healthcare
country_id        = 1
address_line1     = Solitaire Hub
city              = Pune
state_id          = 1
zip_code          = 411045
status            = Active
logo_path         = <file: logo.png>
banks[0][bank_name]      = HDFC Bank
banks[0][branch_name]    = Baner
banks[0][account_number] = 501000123456
banks[0][ifsc_code]      = HDFC0000001
banks[0][is_primary]     = Yes
```

- `entity_code` is auto-assigned server-side (`LE-####`) — do not send it.
- Returns `201` with the flattened row (incl. `banks[]`).

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate entity name / legal name / CIN | that field | `This <label> is already registered. Please use a different value.` |
| No bank supplied | banks | `Please add at least one bank account.` |
| Bad bank fields | banks | e.g. `Account Number must be 9 to 18 digits. IFSC Code is invalid (e.g. HDFC0000001).` |
| Missing required | entity_name / cin / country_id / … | `The <field> field is required.` |

## 5. DELETE

`DELETE /api/master/legal_entities/{id}` → `{ "message": "Deleted" }` (soft). Child bank rows are not auto-purged by delete. Tier gate via `hierarchicalDenial`.

## 6. QUICK REFERENCE

```
GET    /api/master/legal_entities?country_id=1
POST   /api/master/legal_entities        (multipart, banks[])
GET    /api/master/legal_entities/{id}
PUT    /api/master/legal_entities/{id}
DELETE /api/master/legal_entities/{id}
```

## 7. NOTES

- Sending `banks[]` on update replaces the set (true-sync): omit an existing bank id to delete it; include `id` to update it.
- `?country_id=` filters entities by country (schema has a `country_id` field).
- Logo replace deletes the previous file from disk.

---
*Related documents: LEGAL_ENTITIES_FUNCTIONAL_DOCUMENTATION.md, LEGAL_ENTITIES_TECHNICAL_DOCUMENTATION.md, LEGAL_ENTITIES_CODE_WALKTHROUGH.md*
