# HOLIDAY MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday
>
> All payloads below were captured against a live tenant, not written from the schema.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |
| 2.0 | 2026-09-08 | System | Opt-in pagination envelope + `years[]`, real captured responses, import error contract, per-row `group` column, name/duplicate validation errors, delete-guard responses, `HGRP-####` codes. |

---

## 1. CONVENTIONS

| Aspect | Value |
|---|---|
| Base path | `/api` |
| Auth | `Authorization: Bearer <sanctum_token>` on every route |
| Middleware | `auth:sanctum` → `user.active` |
| Branch | Axios injects `?branch_id=<active>` on **all GETs** (Branch Switcher) |
| Permission | `hr.holiday` — `can_view` / `can_add` / `can_edit` / `can_delete` |
| Content type | `application/json` throughout — **there are no multipart routes in this module** |
| Dates | Always `YYYY-MM-DD`; the `date` field never carries a time component |
| Errors | `422` with `{message, errors:{field:[…]}}`; `403` permission; `404` out of scope or missing |

> **Codes.** Holidays are `HOL-###` (3-digit). Groups are `HGRP-####` (4-digit). The two pad differently because groups use the shared `DocumentNumber` helper.

---

## 2. ENDPOINT INDEX

### 2.1 Holidays

| # | Method | Endpoint | Permission | Purpose |
|---|---|---|---|---|
| 1 | GET | `/holidays` | `can_view` | List — array by default, envelope when paged |
| 2 | POST | `/holidays` | `can_add` | Create one |
| 3 | GET | `/holidays/{id}` | `can_view` | Fetch one |
| 4 | PUT | `/holidays/{id}` | `can_edit` | Update |
| 5 | DELETE | `/holidays/{id}` | `can_delete` | Delete (guarded) |
| 6 | GET | `/holidays/my` | — | Logged-in user's own calendar |
| 7 | POST | `/holidays/import` | `can_add` | Bulk create from parsed sheet rows |

### 2.2 Holiday Groups

| # | Method | Endpoint | Permission | Purpose |
|---|---|---|---|---|
| 8 | GET | `/holiday-groups` | `can_view` | List (never paginated) |
| 9 | POST | `/holiday-groups` | `can_add` | Create |
| 10 | GET | `/holiday-groups/{id}` | `can_view` | Fetch one |
| 11 | PUT | `/holiday-groups/{id}` | `can_edit` | Update |
| 12 | DELETE | `/holiday-groups/{id}` | `can_delete` | Delete (guarded) |

### 2.3 Employee calendar

| # | Method | Endpoint | Permission | Purpose |
|---|---|---|---|---|
| 13 | GET | `/employees/{id}/holidays` | view-or-self | Calendar for the employee profile |

---

## 3. HOLIDAYS

### 3.1 GET `/holidays`

**This endpoint has two response shapes.** Which one you get depends on whether you ask for a page.

| Query param | Type | Notes |
|---|---|---|
| `page` | int | Presence switches on the envelope |
| `per_page` | int | Presence switches on the envelope. Clamped to **200**; junk or ≤ 0 falls back to **25** |
| `search` | string | `ilike` across `name`, `code`, `description` |
| `type` | string | One of Public / Restricted / Company / Regional / Optional |
| `year` | int | Filters on the stored year (**not** recurring projections) |
| `holiday_group_id` | int | Exact group match |
| `branch_id` | int | Branch Switcher; ignored if the branch is not the caller's client |

**Without `page`/`per_page` — a plain array.** This is what `HrLeave.tsx` relies on to mark its leave calendar; do not "fix" it into an envelope.

```json
[ { "id": 19, "code": "HOL-018", "name": "Casual", "date": "2026-09-02", … } ]
```

**With `page` or `per_page` — the Laravel paginator envelope plus `years`:**

```
GET /api/holidays?page=1&per_page=2&branch_id=6
```

```json
{
  "current_page": 1,
  "data": [
    {
      "id": 19,
      "client_id": 2,
      "branch_id": 6,
      "created_by": 17,
      "updated_by": 17,
      "code": "HOL-018",
      "name": "Casual",
      "date": "2026-09-02",
      "type": "Public",
      "is_recurring": false,
      "description": "wdf",
      "created_at": "2026-09-01T11:46:51.000000Z",
      "updated_at": "2026-09-01T11:46:51.000000Z",
      "deleted_at": null,
      "holiday_group_id": 2,
      "group": { "id": 2, "name": "Indian Employees" }
    }
  ],
  "first_page_url": "…", "from": 1, "last_page": 93, "last_page_url": "…",
  "links": [ … ], "next_page_url": "…", "path": "…",
  "per_page": 2, "prev_page_url": null, "to": 2, "total": 185,
  "years": [2032, 2031, 2030, 2029, 2028, 2027, 2026]
}
```

Notes:

- `group` is `null` for a **company-wide** holiday (no group).
- `years` lists every year in the tenant's whole calendar, newest first. It **ignores the request's own filters** on purpose, so selecting a year never collapses the dropdown to that one value.
- Ordering is `date` ascending, `id` as tie-break.
- Only `group.id` and `group.name` are returned — the group's counts are stripped to avoid a COUNT per row.

### 3.2 POST `/holidays`

```json
{
  "name": "Republic Day",
  "date": "2027-01-26",
  "type": "Public",
  "is_recurring": true,
  "holiday_group_id": 2,
  "description": "National holiday"
}
```

| Field | Rules |
|---|---|
| `name` | required, ≤ 191, must match `/^(?=.*\pL)[\pL\pN .'\-]+$/u` — **at least one letter** |
| `date` | required, a valid date; normalised to `Y-m-d` |
| `type` | optional, one of the five; defaults to `Public` |
| `is_recurring` | optional boolean (`"true"`/`"1"` accepted) |
| `holiday_group_id` | optional int; **silently becomes `null` if it is not in the caller's tenant scope** |
| `description` | optional, ≤ 1000 |

**`201`** returns the created model, including the allocated `code`.

> The API itself does **not** reject a past date on create — that rule is enforced by the form's date picker and by the import. Only `/holidays/import` refuses past dates server-side.

### 3.3 GET / PUT / DELETE `/holidays/{id}`

`GET` returns the single model. `PUT` takes the same body as create and returns the fresh model; the duplicate check excludes the row being edited.

**Editing is never blocked** — the change propagates to everyone on that group automatically.

**`DELETE` is blocked** while the holiday's group is assigned to employees:

```json
{
  "message": "This holiday's group is assigned to 23 employees, so its holidays can't be removed. Reassign those employees to another group first.",
  "errors": { "holiday_group_id": ["…same text…"] }
}
```
`422`. A holiday with **no** group is exempt from this guard and always deletes.

Success: `{"message": "Holiday removed."}`

### 3.4 GET `/holidays/my`

The logged-in user's own calendar, resolved from their employee record's `holiday_group_id`.

| Query param | Default |
|---|---|
| `year` | current year |

```
GET /api/holidays/my?year=2026
```

Returns a **plain array**. Recurring holidays are re-projected onto the requested year before the year filter is applied, so a recurring holiday anchored in 2024 still appears for 2026.

Returns `[]` — never an error — when the user has no employee record or no group:

```json
[]
```

> **Caveat:** this returns only the assigned **group's** holidays. Company-wide holidays (no group) are credited by payroll and honoured by attendance but do **not** appear here.

### 3.5 POST `/holidays/import`

The sheet is parsed in the browser (SheetJS); the API receives rows, never a file.

```json
{
  "holiday_group_id": 2,
  "rows": [
    { "name": "Republic Day", "date": "2027-01-26", "type": "Public",
      "is_recurring": true, "group": "Indian Employees", "description": "National holiday" },
    { "name": "Holi", "date": "2027-03-04", "type": "Regional", "is_recurring": false, "group": "" }
  ]
}
```

| Field | Rules |
|---|---|
| `rows` | required array, **1–1000** |
| `holiday_group_id` | optional — the fallback group for rows whose `group` cell is blank |
| `rows[].group` | optional — must name an **existing** group of this tenant (case-insensitive). Import never creates groups |
| `rows[].date` | ISO, `DD-MM-YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, `D MMM YYYY`, or a 5-digit **Excel serial** |

**Always returns `200`, even when every row failed.** Check `created` and `errors`, not the status code:

```json
{
  "message": "Imported 0 holiday(s), skipped 0 duplicate(s).",
  "created": 0,
  "skipped": 0,
  "errors": [
    { "row": 1, "message": "Date \"2020-01-01\" is today or in the past — a holiday must be a future date." },
    { "row": 2, "message": "Invalid holiday name \"2026\" — a name must include at least one letter." },
    { "row": 3, "message": "Group \"No Such Group\" does not exist. Create it under Groups first, then re-import." }
  ]
}
```

`row` is **1-based against the posted array**, so it matches the sheet only if the header row is excluded.

| Outcome | Counter |
|---|---|
| Row imported | `created++` |
| `(group, date)` already exists in the DB **or earlier in the same batch** | `skipped++` |
| Anything invalid | appended to `errors[]` |

Rules applied per row: name must contain a letter · date must parse · **date must be in the future** (today and past refused, recurring rows included) · group must resolve · unrecognised `type` silently becomes `Public`.

---

## 4. HOLIDAY GROUPS

### 4.1 GET `/holiday-groups`

| Query param | Notes |
|---|---|
| `search` | `ilike` on `name`, `code` |
| `status` | `Active` / `Inactive` |
| `branch_id` | Branch Switcher |

**Never paginated** — always a plain array, ordered by `code`.

```json
[
  {
    "id": 2,
    "client_id": 2,
    "branch_id": 6,
    "created_by": 10,
    "updated_by": 10,
    "code": "HGRP-0001",
    "name": "Indian Employees",
    "description": null,
    "status": "Active",
    "created_at": "2026-08-31T10:21:51.000000Z",
    "updated_at": "2026-08-31T10:21:51.000000Z",
    "deleted_at": null,
    "holidays_count": 185,
    "employees_count": 23
  }
]
```

`employees_count` is the "in use" signal — when it is `> 0` the group and all of its holidays are delete-locked. Soft-deleted employees are not counted.

### 4.2 POST / PUT `/holiday-groups[/{id}]`

```json
{ "name": "UAE Office", "description": "Gulf calendar", "status": "Active" }
```

| Field | Rules |
|---|---|
| `name` | required, ≤ 191, `/^(?=.*\pL)[\pL\pN \-]+$/u` — letters, numbers, spaces and hyphens; **no apostrophes or dots** (narrower than the holiday name rule) |
| `description` | optional, ≤ 1000 |
| `status` | optional, `Active` \| `Inactive` (default `Active`) |

Names are unique per tenant, compared case-insensitively. `201` on create, `200` on update.

### 4.3 DELETE `/holiday-groups/{id}`

Refused while employees are assigned (`422`):

```json
{
  "message": "This holiday group is assigned to 23 employees. Reassign them to another group before deleting it.",
  "errors": { "group": ["…same text…"] }
}
```

When no employees are assigned, the group is soft-deleted and **its holidays are kept and ungrouped**:

```json
{ "message": "Holiday group removed. Its holidays were kept but ungrouped." }
```

> Those holidays become **company-wide** holidays for the tenant, so they now apply to every employee. The message understates this.

---

## 5. EMPLOYEE CALENDAR

### GET `/employees/{id}/holidays`

`{id}` accepts a numeric id, an employee code, or the encrypted profile token. Authorised by view-or-self: an employee may read their own, HR may read anyone's.

| Query param | Default |
|---|---|
| `year` | current year |

```json
{
  "group": { "id": 2, "name": "Indian Employees" },
  "year": 2026,
  "holidays": [
    {
      "id": 21,
      "client_id": 2, "branch_id": 6,
      "code": "HOL-020",
      "name": "New Year Day",
      "date": "2026-01-01",
      "type": "Public",
      "is_recurring": true,
      "description": "Gregorian new year. All offices and the warehouse remain closed.",
      "holiday_group_id": 2,
      "created_at": "2026-09-08T05:06:17.000000Z",
      "updated_at": "2026-09-08T05:06:17.000000Z",
      "deleted_at": null
    }
  ]
}
```

With no group assigned:

```json
{ "group": null, "year": 2026, "holidays": [] }
```

Same caveat as `/holidays/my` — group holidays only.

---

## 6. ERROR EXAMPLES

**Invalid holiday name — `422`**

```json
{
  "message": "Holiday name must include at least one letter — it can also contain numbers, spaces, dots, apostrophes and hyphens, but not numbers alone.",
  "errors": { "name": ["Holiday name must include at least one letter — …"] }
}
```

**Duplicate date in the same group — `422`**

```json
{ "message": "Holiday already exists for the selected date.",
  "errors": { "date": ["Holiday already exists for the selected date."] } }
```

**Duplicate group name — `422`**

```json
{ "message": "Holiday Group already exists.",
  "errors": { "name": ["Holiday Group already exists."] } }
```

**Missing permission — `403`**

```json
{ "message": "Missing can_delete on hr.holiday" }
```

**Module not seeded and caller is not a client/branch admin — `403`**

```json
{ "message": "Holiday module not enabled." }
```

**Cross-tenant or missing id — `404`** (no distinction, by design)

---

## 7. QUICK REFERENCE

```bash
# 1. Create a group
POST /api/holiday-groups            {"name":"Indian Employees"}          -> HGRP-0001

# 2. Add holidays to it
POST /api/holidays                  {"name":"Republic Day","date":"2027-01-26",
                                     "type":"Public","is_recurring":true,
                                     "holiday_group_id":2}                -> HOL-001

# 2b. Or a COMPANY-WIDE holiday (applies to everyone — omit the group)
POST /api/holidays                  {"name":"Founders Day","date":"2027-08-12"}

# 3. Bulk import a year (rows parsed client-side from .xlsx)
POST /api/holidays/import           {"holiday_group_id":2,"rows":[…]}     -> 200 + errors[]

# 4. Assign the group to employees (Employee module)
PUT  /api/employees/{id}            {"holiday_group_id":2}

# 5. Read it back
GET  /api/holidays?page=1&per_page=25          # admin list + years[]
GET  /api/holidays/my?year=2026                # logged-in user
GET  /api/employees/{id}/holidays?year=2026    # profile panel
```

---

## 8. NOTES & CAVEATS

| # | Note |
|---|---|
| 1 | `GET /holidays` returns **an array or an envelope** depending on `page`/`per_page`. Callers must handle the shape they asked for |
| 2 | `POST /holidays/import` returns `200` even when every row failed — read `created` / `errors[]`, not the status |
| 3 | Past dates are rejected **only by the import**; `POST /holidays` accepts them (the UI's date picker is the guard) |
| 4 | The past-date check compares against server time in **UTC**, not the tenant's timezone |
| 5 | `holiday_group_id` outside the caller's scope is silently coerced to `null`, which creates a company-wide holiday rather than erroring |
| 6 | `/holidays/my` and `/employees/{id}/holidays` return **group holidays only** — company-wide holidays never appear, and an employee with no group gets an empty calendar despite being paid for them |
| 7 | The `year` filter on `GET /holidays` matches the **stored** year; recurring holidays are only projected on the two employee-facing endpoints |
| 8 | Group names allow no apostrophes or dots; holiday names do. The two regexes differ |
| 9 | `status` on a group is accepted and returned but never affects any query |
| 10 | `search` uses Postgres `ilike` — the module is not portable to MySQL as written |
| 11 | `GET /holiday-groups` is never paginated; every group is returned |

---

*Related documents: HOLIDAY_FUNCTIONAL_DOCUMENTATION.md · HOLIDAY_TECHNICAL_DOCUMENTATION.md · HOLIDAY_CODE_WALKTHROUGH.md*
