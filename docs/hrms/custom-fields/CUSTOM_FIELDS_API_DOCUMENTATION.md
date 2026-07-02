# CUSTOM FIELDS MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Custom Fields
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Permission slug **`hr.custom_fields`** (view/add/edit/delete). Super-admin bypasses; branch-scoped.
- Definition-only: no values are stored; `used_in`/`used_count` are computed on read.
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / in-use delete).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/hr-custom-fields` | List fields (+ usage) |
| 2 | GET | `/hr-custom-fields/stats` | KPI counts by type |
| 3 | GET | `/hr-custom-fields/known-tokens` | Token catalogue (employee + custom) |
| 4 | POST | `/hr-custom-fields/validate-tokens` | Split `{{Token}}` known vs unknown |
| 5 | POST | `/hr-custom-fields` | Create a field |
| 6 | GET | `/hr-custom-fields/{id}` | Field + usage |
| 7 | PUT | `/hr-custom-fields/{id}` | Update |
| 8 | DELETE | `/hr-custom-fields/{id}` | Delete (guarded) |

---

## 3. ENDPOINT DETAIL

### GET `/hr-custom-fields?search=&type=`
```json
[ { "id": 5, "name": "LastWorkingDate", "type": "date", "description": "…",
    "used_in": [ { "id": 12, "code": "TPL-003", "name": "Relieving Letter" } ], "used_count": 1,
    "used_in_hint": "Relieving letter", "creator": { "id": 1, "name": "Admin" } } ]
```

### GET `/hr-custom-fields/stats`
```json
{ "total": 8, "text": 4, "date": 2, "number": 1, "textarea": 1, "other": 2 }
```

### GET `/hr-custom-fields/known-tokens`
```json
{ "employee": ["FirstName","FullName","Email","JobTitle","CTC","CompanyName", "…"],
  "custom_fields": [ { "id": 5, "name": "LastWorkingDate", "token": "{{LastWorkingDate}}", "type": "date", "description": "…" } ] }
```

### POST `/hr-custom-fields/validate-tokens`
`{ "content_html": "<p>{{FirstName}} {{Bonus}}</p>" }` → `{ "found": ["FirstName","Bonus"], "known": ["FirstName"], "unknown": ["Bonus"] }`

### POST `/hr-custom-fields`
```json
{ "name": "LastWorkingDate", "type": "date", "description": "Relieving date", "used_in_hint": "Relieving letter" }
```
`name` PascalCase (`^[A-Za-z_][A-Za-z0-9_]*$`, ≤100, unique per scope); `type` ∈ text/date/number/textarea; `description`/`used_in_hint` ≤500.
**Response 201:** the field row (+ empty usage).
**Errors:** 403 · 422 (duplicate name / invalid name).

### PUT `/hr-custom-fields/{id}`
Update (hierarchy-guarded). → field + usage.

### DELETE `/hr-custom-fields/{id}`
**422** if referenced by any template:
```json
{ "message": "Cannot delete — {{LastWorkingDate}} is used in 2 template(s): TPL-003, TPL-009." }
```
Else → `{ "message": "…" }`.

---

## 4. QUICK REFERENCE
```
GET  /hr-custom-fields/known-tokens     # editor catalogue
POST /hr-custom-fields                   # define {{Field}}
GET  /hr-custom-fields                    # list + usage
DELETE /hr-custom-fields/{id}            # blocked if used by a template
# values are typed at document generation (transient), not via this API
```

---

## 5. NOTES (caveats)
1. Definition-only — no value endpoints; values entered at generation time.
2. Types: text/date/number/textarea only (no options/select).
3. No DB FKs / soft deletes; delete guarded when referenced.
4. Names PascalCase, unique per (client, branch).

---

*Related documents: CUSTOM_FIELDS_TECHNICAL_DOCUMENTATION.md · CUSTOM_FIELDS_FUNCTIONAL_DOCUMENTATION.md · CUSTOM_FIELDS_CODE_WALKTHROUGH.md*
