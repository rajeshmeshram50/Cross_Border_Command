# HAZARD CLASSIFICATIONS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Hazard Classifications

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`; `Authorization: Bearer <token>` + active user required.
- Slug `haz_class`; permission module `master.haz_class`.
- Bare responses; lists ordered newest-id-first.
- `?search=` ILIKE across text/select fields; `?branch_id=` narrows for client admins.
- Validation → **HTTP 422**; permission denial → **HTTP 403**.

---

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/haz_class` | List |
| GET | `/master/haz_class/{id}` | Single record |
| POST | `/master/haz_class` | Create |
| PUT | `/master/haz_class/{id}` | Update |
| DELETE | `/master/haz_class/{id}` | Soft delete |
| GET | `/master/haz_class/next-code` | `{ "code": null }` |

---

## 3. LIST / READ

`GET /master/haz_class`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": 4,
    "name": "Flammable Liquid",
    "status": "Active",
    "created_by": 51,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Priya Nair",
    "creator_user_type": "branch_user"
  }
]
```

---

## 4. CREATE / UPDATE

`POST /master/haz_class`

```json
{
  "name": "Toxic Substance",
  "status": "Active"
}
```

Returns `201`. `PUT /master/haz_class/{id}` uses the same body.

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

`DELETE /master/haz_class/{id}` → `{ "message": "Deleted" }` (soft). Returns `403` if the hierarchical gate denies. No system-seed lock on this master.

---

## 6. QUICK REFERENCE

| Field | Rule |
|---|---|
| name | required, string ≤50, unique (ci) |
| status | required, in: Active, Inactive |

---

## 7. NOTES

- `next-code` returns `{code:null}`.
- Every successful write bumps the master-bundle cache used by product/compliance dropdowns.

---
*Related documents: HAZ_CLASS_FUNCTIONAL_DOCUMENTATION.md, HAZ_CLASS_TECHNICAL_DOCUMENTATION.md, HAZ_CLASS_CODE_WALKTHROUGH.md*
