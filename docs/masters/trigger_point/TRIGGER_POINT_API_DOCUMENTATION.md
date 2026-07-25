# TRIGGER POINT MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Trigger Point Master

## DOCUMENT CONTROL

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. Conventions

- **Base:** `/api` (Laravel prefix). **Auth:** `Authorization: Bearer <sanctum_token>`; middleware `auth:sanctum` + `user.active`.
- **Tenant:** `client_id` / `branch_id` derived from the token; body `client_id` ignored for non-super. `?branch_id=` narrows client-admin reads.
- **Responses:** bare JSON (no `{data}` wrapper); collections ordered `id` DESC.
- **Errors:** `422` with `{ message, errors: { field: [..] } }`; `403` on permission / tier denial; `404` unknown id.

---

## 2. Endpoint Index

| # | Method | Path |
|---|---|---|
| 1 | GET | `/master/trigger_point` |
| 2 | GET | `/master/trigger_point/{id}` |
| 3 | POST | `/master/trigger_point` |
| 4 | PUT | `/master/trigger_point/{id}` |
| 5 | DELETE | `/master/trigger_point/{id}` |
| 6 | GET | `/master/trigger_point/next-code` |
| 7 | GET | `/master-counts` |

---

## 3. List / Read

`GET /master/trigger_point?search=onboarding&branch_id=7`

```json
[
  {
    "id": 14,
    "client_id": 12,
    "branch_id": 7,
    "module_name": "Onboarding",
    "description": "Fires when a new employee accepts an offer; generates offer letter + NDA.",
    "status": "Active",
    "created_by": 33,
    "created_at": "2026-07-20T09:14:00.000000Z",
    "updated_at": "2026-07-20T09:14:00.000000Z",
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai HQ",
    "creator_name": "Asha Rao",
    "creator_user_type": "client_admin"
  }
]
```

`GET /master/trigger_point/{id}` returns a single object of the same shape.

---

## 4. Create / Update

`POST /master/trigger_point`

```json
{
  "module_name": "Offboarding",
  "description": "Triggers exit-clearance and experience-letter generation.",
  "status": "Active"
}
```

Returns `201` with the created row (bare object). `PUT /master/trigger_point/{id}` accepts the same body and returns the updated row.

**422 — duplicate module name (`uFields`):**

```json
{
  "message": "The module name has already been taken.",
  "errors": { "module_name": ["The module name has already been taken."] }
}
```

**422 — missing required / bad status:**

```json
{
  "message": "The status field is required.",
  "errors": {
    "module_name": ["The module name field is required."],
    "status": ["The selected status is invalid."]
  }
}
```

---

## 5. Delete

`DELETE /master/trigger_point/{id}` → soft delete (`deleted_at` set); returns success message. Subject to the tier gate — non-owned higher-tier rows return `403`.

---

## 6. Quick Reference

| Field | Type | Required | Rule |
|---|---|---|---|
| `module_name` | string | yes | unique per tenant (case-insensitive) |
| `description` | string | no | nullable → NULL if blank |
| `status` | enum | yes | `Active` \| `Inactive` |

---

## 7. Notes

- `next-code` returns `{ "code": null }` — this master has no sequential code field.
- Empty strings are normalised to `NULL` before persistence.
- Every successful write invalidates `MasterBundleCache`.
- `GET /master-counts` returns active/inactive tallies used by the Masters dashboard card.

---

*Related documents: TRIGGER_POINT_FUNCTIONAL_DOCUMENTATION.md, TRIGGER_POINT_TECHNICAL_DOCUMENTATION.md, TRIGGER_POINT_CODE_WALKTHROUGH.md*
