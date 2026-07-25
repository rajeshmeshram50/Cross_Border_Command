# RISK LEVELS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Risk Levels

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>` + active user required.
- Slug `risk_levels`; permission module `master.risk_levels`.
- Bare responses (no envelope); lists ordered newest-id-first.
- `?search=` ILIKE across text/select fields; `?branch_id=` narrows for client admins.
- Validation errors → **HTTP 422**; permission/lock denials → **HTTP 403**.

---

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/risk_levels` | List |
| GET | `/master/risk_levels/{id}` | Single record |
| POST | `/master/risk_levels` | Create |
| PUT | `/master/risk_levels/{id}` | Update (403 on seeded row) |
| DELETE | `/master/risk_levels/{id}` | Soft delete (403 on seeded row) |
| GET | `/master/risk_levels/next-code` | `{ "code": null }` |

---

## 3. LIST / READ

`GET /master/risk_levels`

```json
[
  {
    "id": 2,
    "client_id": null,
    "branch_id": null,
    "name": "High",
    "description": "Severe compliance exposure",
    "action_required": "Escalate to compliance head",
    "status": "Active",
    "is_system": true,
    "created_by": null,
    "client_name": null,
    "branch_name": null,
    "creator_name": null
  }
]
```

---

## 4. CREATE / UPDATE

`POST /master/risk_levels`

```json
{
  "name": "Critical",
  "description": "Sanctioned / blacklisted party",
  "action_required": "Block onboarding",
  "status": "Active"
}
```

Returns `201`. `PUT /master/risk_levels/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "name": ["This Name is already registered. Please use a different value."] }
```

**422 — system-seed collision (trying to re-create Low/High):**
```json
{ "name": ["\"High\" is a system-managed Name and cannot be re-created."] }
```

**403 — editing a seeded row (`PUT` on Low/High):**
```json
{ "message": "This record is system-managed and cannot be edited. Create a custom entry if you need different values." }
```

---

## 5. DELETE

`DELETE /master/risk_levels/{id}`

- Custom row → `{ "message": "Deleted" }`.
- Seeded Low/High (`is_system=true`) → **403**:
```json
{ "message": "This risk level is system-managed and cannot be deleted." }
```

---

## 6. QUICK REFERENCE

| Field | Rule |
|---|---|
| name | required, string ≤50, unique (ci), not a system name |
| description | nullable, string ≤50 |
| action_required | nullable, string ≤50 |
| status | required, in: Active, Inactive |

---

## 7. NOTES

- Seeded rows: *Low*, *High* (global, `is_system=true`). *Medium*/*Critical* are UI suggestions, not seeded.
- `next-code` returns `{code:null}`.

---
*Related documents: RISK_LEVELS_FUNCTIONAL_DOCUMENTATION.md, RISK_LEVELS_TECHNICAL_DOCUMENTATION.md, RISK_LEVELS_CODE_WALKTHROUGH.md*
