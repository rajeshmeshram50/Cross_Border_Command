# TRIGGER POINT MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Trigger Point Master
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Trigger points are managed by the **generic MasterController** at slug `trigger_point`.
- Auth: `auth:sanctum` + `user.active`. Permission slug **`master.trigger_point`** (view/add/edit/delete). Super-admin bypasses; tenant-scoped.
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / duplicate name).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/master/trigger_point` | List trigger points |
| 2 | POST | `/master/trigger_point` | Create |
| 3 | GET | `/master/trigger_point/{id}` | Show |
| 4 | PUT | `/master/trigger_point/{id}` | Update |
| 5 | DELETE | `/master/trigger_point/{id}` | Delete |
| 6 | GET | `/master-counts` | Master KPI counts (incl. trigger_point) |
| — | GET | `/hr-document-templates/match?trigger_keyword=` | Consumer: match templates by trigger |

---

## 3. ENDPOINT DETAIL

### GET `/master/trigger_point?search=&branch_id=`
```json
{ "data": [ { "id": 7, "module_name": "Onboarding", "description": "New-hire documents",
              "status": "Active", "client": {…}, "branch": null, "creator": {…} } ] }
```

### POST `/master/trigger_point`
```json
{ "module_name": "Promotion", "description": "Promotion letters", "status": "Active" }
```
`module_name` required, case-insensitive unique per tenant; `status` ∈ Active/Inactive.
**Response 201:** the trigger row.
**Errors:** 403 · 422 (duplicate name).

### PUT `/master/trigger_point/{id}` · DELETE `/master/trigger_point/{id}`
Update / hard-delete (hierarchy-guarded). No `is_system` lock — canonical rows are deletable.

### GET `/hr-document-templates/match?employee_id=N&trigger_keyword=onboarding`
Returns Active templates whose `trigger_point_id` matches any trigger whose `module_name` **contains** the keyword (also filtered by the employee's category + designation level).
```json
{ "templates": [ { "id": 12, "code": "TPL-003", "name": "Offer Letter",
                   "trigger_point": { "id": 7, "module_name": "Onboarding" } } ] }
```

---

## 4. ERROR EXAMPLES
**422 — duplicate name**
```json
{ "message": "…", "errors": { "module_name": ["Trigger Point already exists."] } }
```

---

## 5. QUICK REFERENCE
```
POST /master/trigger_point                       # define a lifecycle trigger
# bind a template: TemplateForm sends trigger_point_id
GET  /hr-document-templates/match?trigger_keyword=onboarding|exit   # runtime match
```

---

## 6. NOTES (caveats)
1. Managed via the generic Master engine (slug `trigger_point`); permission `master.trigger_point`.
2. Matching is substring on `module_name` (can over-match; two exit rows both match `exit`).
3. No FK / soft delete / is_system — deleting a used trigger orphans template links.
4. Case-insensitive unique per tenant; same name may exist globally and per branch.

---

*Related documents: TRIGGER_POINT_TECHNICAL_DOCUMENTATION.md · TRIGGER_POINT_FUNCTIONAL_DOCUMENTATION.md · TRIGGER_POINT_CODE_WALKTHROUGH.md*
