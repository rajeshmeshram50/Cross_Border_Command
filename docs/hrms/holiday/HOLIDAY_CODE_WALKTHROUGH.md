# HOLIDAY MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday
>
> Follows a request from the screen to the database, method by method.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |
| 2.0 | 2026-09-08 | System | Rewritten against the current controllers: opt-in paging, `yearOptions`, `stripGroupCounts`, the import's per-row group resolution and future-date rule, duplicate guards, `assertGroupNotInUse`, group-delete ungrouping, payroll/attendance company-holiday resolution. |

---

## 0. HOW TO READ

Each section names the method, the file, and what the code actually does — including the reasons recorded in the source for choices that look odd from outside. Line references are approximate and drift with edits; the method names are stable.

Primary files:

```
app/Http/Controllers/Api/HolidayController.php        (581)
app/Http/Controllers/Api/HolidayGroupController.php   (209)
app/Http/Controllers/Api/ScopesHolidayTenant.php      (76)
app/Models/Holiday.php · HolidayGroup.php
```

---

## 1. LISTING HOLIDAYS

### `HolidayController::index()`

```php
$this->authorizeAction($request, 'can_view');
$q = Holiday::query()->with(['group:id,name']);
$this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
```

Four things are load-bearing here:

**1. `creator` is not eager-loaded.** No screen reads it off a holiday. Loading it cost a query plus a whole user object per row for nothing.

**2. Only `id,name` of the group is selected.** The list renders the group's name and nothing else.

**3. Filters** — `holiday_group_id` exact, `search` across `name`/`code`/`description` with Postgres `ilike`, `type` exact, `year` via `whereYear('date', …)`.

**4. Ordering is `date` then `id`.** The id is a tie-break, not decoration: same-date holidays would otherwise come back in whatever order the plan chose, and the SPA prints a continuous Sr. No. over the result.

### Pagination is opt-in

```php
if ($request->has('per_page') || $request->has('page')) { … }
$rows = $q->get();            // otherwise: a plain array
```

This is a compatibility contract, not a preference. `HrLeave.tsx` calls `GET /holidays` with no paging parameters and marks the dates on its leave calendar; returning a `{data, total, …}` envelope unconditionally would blank that calendar out.

`per_page` is clamped rather than trusted, because the Holiday list sizes its own page to the viewport (`autoFitRows`) — the value that arrives is whatever happened to fit, not one of the 10/25/50 the dropdown offers:

```php
$requested = $request->query('per_page');
$perPage = is_numeric($requested) && (int) $requested > 0
    ? min(self::MAX_PER_PAGE, (int) $requested)   // 200
    : self::DEFAULT_PER_PAGE;                     // 25
```

Note the fallback goes to the **default**, not to the floor. `max(1, (int) 'abc')` is 1, which would answer a mistyped parameter with 400 single-row pages instead of the sensible page the caller obviously meant.

### `yearOptions()` — the Year dropdown rides along

```php
$payload = $page->toArray();
$payload['years'] = $this->yearOptions($request);
```

The options cannot be derived from the rows on screen — one page only contains its own years. A second endpoint for a seven-element list meant a second Laravel boot on every visit (about a second on the dev server), so one extra ~2 ms query is the cheaper half of the trade, and the dropdown stays correct after an import or a delete without a separate refresh.

It **deliberately ignores the request's own filters**. Scoped to them, picking 2026 would collapse the dropdown to `[2026]` with no way back to another year.

Only the distinct `date` column is plucked — no models are hydrated — and the years are grouped in PHP so the query stays portable instead of depending on Postgres's or MySQL's own date functions.

### `stripGroupCounts()` — the N+1 that eager-loading created

```php
foreach ($rows as $row) { $row->group?->setAppends([]); }
```

`HolidayGroup` appends `holidays_count` and `employees_count`, and those accessors each fall back to their own `COUNT` when `withCount` has not run. Eager-loading the group therefore bought **two COUNTs per distinct group in the result** — 26 queries to render a 10-row page, and over 400 for the unpaginated list `HrLeave` asks for. Nothing reads either count off a holiday's group (the list only wants the name), so the appends are stripped before serialisation and the queries never fire.

---

## 2. CREATING AND EDITING A HOLIDAY

### `store()`

```php
$this->authorizeAction($request, 'can_add');
$data = $this->validatePayload($request);
return DB::transaction(function () use ($request, $data) {
    [$clientId, $branchId] = $this->resolveOwnership($request);
    $row = Holiday::create(array_merge($data, [
        'client_id' => $clientId, 'branch_id' => $branchId,
        'created_by' => $auth?->id, 'updated_by' => $auth?->id,
        'code' => $this->allocateCode($clientId, $branchId),
    ]));
    return response()->json($row, 201);
});
```

Ownership always comes from `resolveOwnership()`, never from the request body — except for a super admin, who is explicitly allowed to name the target tenant.

### `validatePayload()` — three jobs

**1. The name rule.**

```php
'name' => ['required','string','max:191','regex:/^(?=.*\pL)[\pL\pN .\'\-]+$/u'],
```

The lookahead is the whole point. Digits are allowed *inside* a name — "Diwali 2026" is an ordinary thing to call a holiday — but a name made only of digits, spaces or punctuation is not a name. The custom message says what a valid name *is* rather than "invalid format", which would leave the user guessing which character to drop.

**2. Normalisation.** `date` is flattened to `Y-m-d` so the column never sees a datetime, `type` defaults to `Public`, `is_recurring` goes through `FILTER_VALIDATE_BOOLEAN` (so `"false"` from a form post is false), and `holiday_group_id` is passed through `resolveGroupId()`.

**3. The duplicate guard.**

```php
->when($data['holiday_group_id'] === null,
      fn ($q) => $q->whereNull('holiday_group_id'),
      fn ($q) => $q->where('holiday_group_id', $data['holiday_group_id']))
->whereDate('date', $data['date'])
->when($id !== null, fn ($q) => $q->where('id', '!=', $id))
```

Scoped to (client, branch, **group**, date). The same date may legitimately exist in another group's calendar, so the group is part of the key. On update the row being edited is excluded, so re-saving without changing the date is allowed. This mirrors the bulk import's de-dupe so single-create cannot bypass it.

### `resolveGroupId()` — never trust the body

```php
if (!$rawId) return null;
$q = HolidayGroup::query()->where('id', (int) $rawId);
$this->applyScope($q, $request->user(), null);
return $q->exists() ? (int) $rawId : null;
```

An id outside the caller's scope silently degrades to `null` — which means the holiday is created as company-wide rather than being attached to another tenant's group.

### `update()` — no lock

```php
// Editing is always allowed - the change just propagates to every
// employee on this holiday's group automatically.
```

This is a deliberate asymmetry with `destroy()`. An admin correcting a wrong date should not have to empty a group first; removing a paid day from a live calendar is a different matter.

---

## 3. DELETING

### `HolidayController::destroy()` → `assertGroupNotInUse()`

```php
if (!$row->holiday_group_id) return;                  // ungrouped: exempt
$assigned = Employee::where('holiday_group_id', $row->holiday_group_id)->count();
if ($assigned > 0) throw ValidationException::withMessages([...]);
```

Once a group is somebody's holiday list, its dates feed that employee's attendance and payroll, so removing one would silently rewrite a calendar people depend on. The message names the count and tells the admin what to do (reassign first).

`Employee` uses SoftDeletes, so its global scope excludes trashed employees — a deleted employee does not hold a group hostage.

Note the exemption: an **ungrouped** (company-wide) holiday can always be deleted, even though payroll credits it to everyone. That is an inconsistency in the guard, not a design decision.

### `HolidayGroupController::destroy()`

Same employee check, then:

```php
DB::transaction(function () use ($row) {
    DB::table('holidays')->where('holiday_group_id', $row->id)->update(['holiday_group_id' => null]);
    $row->delete();
});
```

The holidays are **kept and ungrouped** rather than cascaded away, so the dates are never lost. Side effect worth knowing: they silently become company-wide holidays for that tenant.

The `DB::table()` call bypasses Eloquent, so `updated_by` and `updated_at` on those rows are not touched.

---

## 4. BULK IMPORT

### `HolidayController::import()`

The frontend parses the `.xlsx` with SheetJS and posts `rows: [{name, date, type?, is_recurring?, group?, description?}, …]`. The API never sees a file.

```php
'rows' => 'required|array|min:1|max:1000',
```

**Two lookup maps are built up front** so the loop costs no per-row queries:

```php
// name(lowercased) => id, for THIS tenant's groups only
$groupMap = [...];
// "groupId|date" => true, for existing rows
$existing = Holiday::…->get(['holiday_group_id','date'])->mapWithKeys(...)->all();
```

Then each row is judged independently inside one transaction, accumulating `$created`, `$skipped` and `$errors`:

| Check | Outcome |
|---|---|
| `name` or `date` blank | error |
| name fails the letter regex | error, quoting the name |
| `parseImportDate()` returns null | error, quoting the raw value |
| `$date <= $today` | error — "today or in the past" |
| `group` column names an unknown group | **error** — the import never creates groups |
| `group` blank **and** no UI group selected | error |
| `(group, date)` seen in `$existing` or `$seenInBatch` | `$skipped++` |
| unrecognised `type` | silently coerced to `Public` |
| otherwise | `Holiday::create(...)`, `$created++` |

Two details are easy to miss:

- **`$seenInBatch`** de-dupes within the uploaded sheet itself, not just against the database — the same date twice in one file imports once.
- The **future-date rule applies to recurring rows too**, so a past anchor date is rejected even though the holiday would only ever be projected forward.

### `parseImportDate()`

Tries, in order: a 5-digit **Excel serial** (days since 1899-12-30), then eight explicit formats (`Y-m-d`, `d-m-Y`, `d/m/Y`, `m/d/Y`, `d.m.Y`, `d M Y`, `d-M-Y`, `j M Y`), then `Carbon::parse()` as a last resort — which is what handles `2026-01-26T00:00:00.000Z` coming out of SheetJS.

Ambiguity is resolved by order: `03/04/2026` matches `d/m/Y` first and reads as **3 April**, not 4 March.

---

## 5. EMPLOYEE-FACING READS

### `HolidayController::my()`

```php
$employee = Employee::where('user_id', $user->id)->first();
$groupId = $employee?->holiday_group_id;
if (!$groupId) return response()->json([]);
```

No employee row or no group returns an empty list rather than an error — the endpoint is for a self-service widget, and an error would be noise.

Recurring rows are re-projected onto the requested year, then everything outside that year is filtered out:

```php
if ($h->is_recurring && $h->date) {
    $d = Carbon::parse($h->date);
    $arr['date'] = Carbon::create($year, $d->month, $d->day)->toDateString();
}
…
->filter(fn ($h) => (int) substr((string) $h['date'], 0, 4) === $year)
```

The order matters: projection happens first, so a recurring holiday anchored in 2024 still surfaces for 2027; a one-off holiday in another year is dropped by the filter.

### `EmployeeController::holidays()`

The same projection and filter, wrapped for the profile panel:

```php
return response()->json([
    'group'    => ['id' => $groupId, 'name' => $emp->holidayGroup?->name],
    'year'     => $year,
    'holidays' => $holidays,
]);
```

Guarded by `authorizeViewOrSelf()` — an employee reads their own, HR reads anyone's. `resolveIdParam()` accepts a numeric id, an employee code, or the encrypted profile token.

> **Both of these resolve only `holiday_group_id`.** Neither picks up ungrouped company-wide holidays, which payroll and attendance *do* credit. See §7.

---

## 6. TENANT SCOPING (`ScopesHolidayTenant`)

One trait, used by both controllers, so the two can never drift apart.

```php
protected function resolveOwnership(Request $request): array
```

| Caller | Returns |
|---|---|
| `super_admin` | `[$request->input('client_id'), $request->input('branch_id')]` — may target any tenant |
| `client_admin`, `client_user` | `[$user->client_id, null]` — client-level rows, no branch |
| `branch_user`, `employee` | `[$user->client_id, $user->branch_id]` |
| anything else | `[null, null]` |

```php
protected function applyScope($q, $user, ?int $branchFilter = null): void
```

- **super_admin** — unrestricted; honours `branch_id` when the switcher sends one.
- **client tier** — `client_id IS NULL OR client_id = own`, then the switcher filter.
- **branch tier** — globals, plus their client's rows whose `branch_id` is null or their own. Every branch is an isolated peer.
- **anything else** — `whereRaw('1 = 0')`. Fail closed.

```php
protected function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
```

The branch id is only applied after confirming it belongs to the caller's client. A forged id is **ignored**, not honoured and not rejected — the caller simply gets their unfiltered scope.

---

## 7. INTEGRATIONS — where holidays are actually consumed

None of these go through the API. All three query the table directly, so a change to the resolution rules has to be made in all of them.

### `PayrollService::holidayDateSet()`

```php
$q->where(function ($w) use ($clientId, $branchId) {
        $w->whereNull('holiday_group_id')
          ->where('client_id', $clientId);                    // MATCH, not "or null"
        if ($branchId) {
            $w->where(fn ($b) => $b->whereNull('branch_id')->orWhere('branch_id', $branchId));
        }
  });
if ($groupId) { $q->orWhere('holiday_group_id', $groupId); }
```

The asymmetry between the two columns is intentional and documented in the source:

- **`client_id` must match exactly.** A null `client_id` is an *unscoped* row, not a global one; treating it as global would hand one tenant's calendar to every tenant. Every employee has a client, so nothing is shut out.
- **`branch_id` is "match or null"**, because a company holiday entered without a branch is meant to cover every office of that client.

There is no early return when the employee has no group — that was the QA #93 bug. Company holidays carry no group, so bailing out credited **zero** holiday days to every employee not placed in a group, which was most of them.

### `PayrollService::holidayAggregates()`

```php
foreach (array_keys($this->holidayDateSet($employee, $start, $end)) as $ds) {
    if (\App\Support\WeekOff::isOff($label, Carbon::parse($ds))) continue;
    $count++;
}
```

A holiday landing on the employee's **own** weekly off is already a non-working day; crediting it would pay the same day twice. This was previously hardcoded to Sunday, which double-counted for anyone whose Saturday is off.

### `AttendanceController::holidayDatesForGroups()`

```php
private function holidayDatesForGroups(
    array $groupIds, Carbon $start, Carbon $end,
    ?int $clientId = null, ?int $branchId = null,
): array
```

`whereIn('holiday_group_id', $groupIds)` never matches NULL, so every ungrouped holiday was invisible here: the Log showed the day as **Absent** for anyone without punches while payroll was crediting it as a paid holiday — the two modules disagreeing about what a holiday is (#85). The client/branch parameters and the removal of the empty-`$groupIds` early return are the fix.

### `LeaveRequestController`

Weekly-offs and holidays inside a requested range are never counted as leave days. The holiday lookup is unconditional rather than gated on the employee having a group, for the same QA #93 reason.

---

## 8. CODE ALLOCATION — two different mechanisms

### `HolidayController::allocateCode()` — local

```php
$q = Holiday::query()->withTrashed()->lockForUpdate();
foreach ($q->pluck('code') as $c) {
    if (preg_match('/^HOL-(\d+)$/i', (string) $c, $m)) { … }
}
return 'HOL-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
```

`withTrashed()` means a soft-deleted holiday's number is never reissued. The row lock is what makes two concurrent inserts safe. The cost is O(n): every code for the tenant is pulled and scanned on every insert — including 1,000 times inside one bulk import.

### `HolidayGroupController::allocateCode()` — shared helper

```php
return \App\Support\DocumentNumber::next(
    HolidayGroup::class, 'code', 'HGRP', $clientId, $branchId, withTrashed: true,
);
```

`DocumentNumber::next()` throws if called outside a transaction (a `lockForUpdate()` outside one releases immediately), which is why `store()` wraps it. Its `$pad` defaults to **4** — the reason group codes read `HGRP-0001` while holiday codes read `HOL-001`.

---

## 9. PERMISSIONS

Both controllers carry an identical `authorizeAction()`:

```php
if ($user->isSuperAdmin()) return;
$moduleId = Module::where('slug', 'hr.holiday')->value('id');
if (!$moduleId) {
    if (in_array($user->user_type, ['client_admin','branch_user'], true)) return;
    abort(403, 'Holiday module not enabled.');
}
$allowed = Permission::where('user_id', $user->id)
    ->where('module_id', $moduleId)->where($perm, true)->exists();
```

The `!$moduleId` branch is a fresh-install fallback — until `ModuleSeeder` has run, any client admin or branch user is allowed through unchecked.

The seeding migration backfills by **cloning each user's `hr.leave` flags** onto a new `hr.holiday` row, on the reasoning that anyone who can see Leave should see the holiday calendar. It skips users who already have a row, so it is idempotent.

---

## 10. NOTES & CAVEATS

| # | Note |
|---|---|
| 1 | `DISPLAY_TZ = 'Asia/Kolkata'` is declared in `HolidayController` but **never referenced**. `config/app.timezone` is `UTC`, so the import's `date <= today` check compares against UTC |
| 2 | `my()` and `EmployeeController::holidays()` resolve only the employee's group — ungrouped company holidays are credited by payroll but never shown on the employee's calendar |
| 3 | `assertGroupNotInUse()` exempts ungrouped holidays, so a company-wide holiday can be deleted with no in-use check at all |
| 4 | Deleting a group turns its holidays into company-wide holidays for that tenant — the message says "ungrouped", which understates the effect |
| 5 | `DB::table('holidays')->update(...)` in the group delete bypasses Eloquent: no `updated_by`, no `updated_at`, no model events |
| 6 | `allocateCode()` is O(n) per insert and runs once per row during a bulk import |
| 7 | `HolidayGroup`'s appended counts fire a COUNT each whenever a group is serialised without `withCount` — `stripGroupCounts()` exists solely to stop that |
| 8 | Group `status` (Active/Inactive) is written and displayed but never read by any query |
| 9 | Holiday `type` is stored and filtered on but has no behavioural effect in payroll or attendance |
| 10 | `search` uses `ilike`, which is **Postgres-only** — the module would need `LOWER(...) LIKE` to run on MySQL |

---

*Related documents: HOLIDAY_FUNCTIONAL_DOCUMENTATION.md · HOLIDAY_TECHNICAL_DOCUMENTATION.md · HOLIDAY_API_DOCUMENTATION.md*
