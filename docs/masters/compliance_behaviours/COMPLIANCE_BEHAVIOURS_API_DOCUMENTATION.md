# COMPLIANCE BEHAVIOURS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Compliance Behaviours

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>` + active user required.
- Slug `compliance_behaviours`; permission module `master.compliance_behaviours`.
- Bare responses; lists ordered newest-id-first.
- `?search=` ILIKE across text/select fields; `?branch_id=` narrows for client admins.
- Validation → **HTTP 422**; permission denial → **HTTP 403**.

---

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/compliance_behaviours` | List |
| GET | `/master/compliance_behaviours/{id}` | Single record |
| POST | `/master/compliance_behaviours` | Create |
| PUT | `/master/compliance_behaviours/{id}` | Update |
| DELETE | `/master/compliance_behaviours/{id}` | Soft delete |
| GET | `/master/compliance_behaviours/next-code` | `{ "code": null }` |

---

## 3. LIST / READ

`GET /master/compliance_behaviours`

```json
[
  {
    "id": 2,
    "client_id": 12,
    "branch_id": null,
    "name": "Non-Compliant",
    "action_required": "Issue correction notice",
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

`POST /master/compliance_behaviours`

```json
{
  "name": "Under Review",
  "action_required": "Await audit",
  "status": "Active"
}
```

Returns `201`. `PUT /master/compliance_behaviours/{id}` uses the same body.

**422 — duplicate name:**
```json
{ "name": ["This Name is already registered. Please use a different value."] }
```

**422 — bad status enum:**
```json
{ "status": ["The selected status is invalid."] }
```

---

## 5. DELETE

`DELETE /master/compliance_behaviours/{id}` → `{ "message": "Deleted" }` (soft). Returns `403` if the hierarchical gate denies. No system-seed lock on this master.

---

## 6. QUICK REFERENCE

| Field | Rule |
|---|---|
| name | required, string ≤50, unique (ci) |
| action_required | nullable, string ≤50 |
| status | required, in: Active, Inactive |

---

## 7. NOTES

- `next-code` returns `{code:null}`.
- Every successful write bumps the master-bundle cache used by CLM/KYC dropdowns.

---
*Related documents: COMPLIANCE_BEHAVIOURS_FUNCTIONAL_DOCUMENTATION.md, COMPLIANCE_BEHAVIOURS_TECHNICAL_DOCUMENTATION.md, COMPLIANCE_BEHAVIOURS_CODE_WALKTHROUGH.md*
