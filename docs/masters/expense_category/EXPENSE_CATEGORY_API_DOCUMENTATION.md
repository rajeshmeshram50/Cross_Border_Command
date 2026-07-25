# EXPENSE CATEGORIES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Expense Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. Conventions

- Base `/api`, `Authorization: Bearer <sanctum>` + `user.active` on all routes.
- Permission module: `master.expense_category`.
- JSON in/out (no uploads). GETs auto-receive `?branch_id=` from the frontend.
- Bare responses; ownership names flattened onto each row.

## 2. Endpoint Index

| Verb | Path | Perm |
|---|---|---|
| GET | `/master/expense_category` | can_view |
| GET | `/master/expense_category/{id}` | can_view |
| GET | `/master/expense_category/next-code` | can_view |
| POST | `/master/expense_category` | can_add |
| PUT | `/master/expense_category/{id}` | can_edit |
| DELETE | `/master/expense_category/{id}` | can_delete |

## 3. List / Read

`GET /master/expense_category?search=travel`

```json
[
  {
    "id": 4,
    "client_id": 12, "branch_id": 4,
    "code": "EXC-03",
    "name": "Travel",
    "monthly_limit": "20000.00",
    "yearly_limit": "200000.00",
    "description": "Air/rail/cab for approved business trips",
    "status": "Active",
    "created_by": 55,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Asha R"
  }
]
```

`search` matches `code`, `name`, `description`, `status` (ilike).

## 4. Create / Update

**Step 1 — fetch the next code (form open):**

`GET /master/expense_category/next-code`
```json
{ "code": "EXC-04", "prefix": "EXC-" }
```

**Step 2 — create:**

`POST /master/expense_category`
```json
{
  "code": "EXC-04",
  "name": "Meals",
  "monthly_limit": 5000,
  "yearly_limit": 60000,
  "description": "Per-diem meals during travel",
  "status": "Active"
}
```
→ **201** with the created row.

**422 (duplicate code or name):**
```json
{ "message": "The code has already been taken.",
  "errors": { "code": ["The code has already been taken."] } }
```

`PUT /master/expense_category/{id}` — same body shape (unique check excludes the current row).

## 5. Delete

`DELETE /master/expense_category/{id}` → `{ "message": "Deleted" }` (soft delete). A 403 is returned only if the hierarchical rule denies the caller.

## 6. Quick Reference

| Need | Call |
|---|---|
| Next code | `GET /master/expense_category/next-code` |
| List | `GET /master/expense_category` |
| Create | `POST /master/expense_category` |
| Edit | `PUT /master/expense_category/{id}` |
| Delete | `DELETE /master/expense_category/{id}` |

## 7. Notes

- The `next-code` value is a preview; the code field is still submitted and re-validated — concurrent opens can collide and 422 the second save.
- Limits serialize as decimal strings (decimal:2 cast).
- Body `client_id`/`branch_id` ignored for non-super users; the `EXC-` series is tenant-isolated.

---

*Related documents: EXPENSE_CATEGORY_FUNCTIONAL_DOCUMENTATION.md, EXPENSE_CATEGORY_TECHNICAL_DOCUMENTATION.md, EXPENSE_CATEGORY_CODE_WALKTHROUGH.md*
