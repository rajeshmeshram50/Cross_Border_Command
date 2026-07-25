# SEGMENTS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Segments

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base prefix `/api`. All routes require `Authorization: Bearer <sanctum_token>` and pass `auth:sanctum` + `user.active`.
- Permission module `master.segments` (super admins bypass).
- Responses are **bare** JSON (no `{data:...}` wrapper); ownership names (`client_name`, `branch_name`, `creator_name`) are flattened onto each row. Lists are `orderByDesc(id)`.
- Validation failures return HTTP 422 `{ "message": ..., "errors": { field: [...] } }`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/master/segments` |
| POST | `/master/segments` |
| GET | `/master/segments/next-code` |
| GET | `/master/segments/{id}` |
| PUT | `/master/segments/{id}` |
| DELETE | `/master/segments/{id}` |

---

## 3. LIST / READ

`GET /master/segments?search=dry&branch_id=7`

```json
[
  {
    "id": 12,
    "client_id": 12,
    "branch_id": 7,
    "code": "S-004",
    "name": "Dry Fruits",
    "title": "Dry Fruits",
    "regulatory_status": "less",
    "buyer_consignee": "allowed",
    "status": "active",
    "created_by": 40,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Asha K"
  }
]
```

`title` mirrors `name`. Search matches `title`/`status` via `ILIKE`.

---

## 4. CREATE / UPDATE

`POST /master/segments`

```json
{ "title": "Oil Seeds", "status": "Active" }
```

Returns `201` with the created row (including generated `code` and appended `title`).

**422 examples**

```json
{ "message": "The title field is required.", "errors": { "title": ["The title field is required."] } }
```

```json
{ "message": "This Title is already registered. Please use a different value.",
  "errors": { "title": ["This Title is already registered. Please use a different value."] } }
```

`PUT /master/segments/{id}` takes the same body.

---

## 5. DELETE

`DELETE /master/segments/{id}` → `{ "message": "Deleted" }` (soft delete). No in-use guard. A tier/ownership violation returns `403`.

---

## 6. QUICK REFERENCE

| Field | Type | Req | Rule |
|---|---|---|---|
| `title` | string | Yes | max 50, unique (case-insensitive, tenant-scoped) |
| `status` | string | Yes | `Active` / `Inactive` |

`next-code` → `{ "code": null }`.

---

## 7. NOTES

- The write posts `title`, but it persists on `clm_segments.name`; both keys appear in responses.
- `code`, `regulatory_status`, `buyer_consignee` are server-managed — sending them from the master form has no guaranteed effect (edit them on the CLM Segment page).
- Employees on CLM tables see the whole branch's segments (branch-shared read).

---
*Related documents: SEGMENTS_FUNCTIONAL_DOCUMENTATION.md, SEGMENTS_TECHNICAL_DOCUMENTATION.md, SEGMENTS_CODE_WALKTHROUGH.md*
