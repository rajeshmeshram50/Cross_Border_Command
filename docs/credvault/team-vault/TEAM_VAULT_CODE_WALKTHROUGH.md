# CredVault Team Vault — Code Walkthrough

| | |
|---|---|
| **Jira** | GT-106 (parent GT-76 — CredVault Team Vault Documentation) |
| **Module** | CredVault → Vault Management → Team Vault |
| **Audience** | Developers joining the module, code reviewers, tech leads |
| **Companion documents** | Functional Documentation · Technical Documentation · API Documentation |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document walks through the Team Vault **code**, in the order it runs: from the moment the page opens, to the list, the left pane, the actions on a row and the export. Each section names the function, says what it does and quotes the lines that matter. Read it next to the source. For what the user sees, read the Functional Documentation. For the request and response shapes, read the API Documentation.

### 1.2 The walkthrough in one paragraph

The page is `TeamVault.tsx`. It asks `tvData.list()` for the credentials, which calls `GET /normal-vault/credentials?tab=team`. On the server, `listCredentials()` builds a query from `visibleQuery()` (which rows may be listed), cuts it into tabs, and runs `accessMap()` on the page of rows (how much the viewer may do on each). In parallel, `TeamDetails.tsx` loads the departments and the hierarchy from the **HR tables**, and a click on a person sends `member_employee_id` back into the list. View and Copy go to **shared CredVault endpoints** that call `findCredential()`, which runs `accessMap()` again for that one credential. Edit and Bin go to Normal Vault routes that call `findInVault()`. Share (from the View drawer — the row has no Share button) calls `findCredential()` at Full. Export is a page-level action that works on `exportSet()`.

### 1.3 How to read this document

Line numbers drift as the code changes; **function names are stable**, so search for the name.

| Callout | Meaning |
|---|---|
| **Explanation** | Why the code is written this way, usually from a comment in the source |
| **Common misunderstanding** | Something a reader of the code often gets wrong |
| **Known problem** | Behaviour that does not match the rest of the module (also listed in section 11) |
| **Worth testing** | A path that is easy to break when the code is changed |

### 1.4 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| rank | `RANK_USE` 0 < `RANK_VIEW` 1 < `RANK_COPY` 2 < `RANK_FULL` 3 |
| via | Why the viewer has that rank: `owner`, `branch`, `manager`, `hod`, `team`, `share` |
| Vault Admin | The **Branch User** (`user_type = branch_user`), for **their own branch only**. In the code their branch is `adminBranchOf($u)` and their access comes back as `via = branch`. |
| `[rank, via]` | The pair `accessMap()` returns per credential; `row()` turns it into `access` and `can` |
| Overseen users | The people a viewer is above: their downline, their branch (Vault Admin) and their headed departments (HOD) — `overseenUserIds()` |
| Memo | `$this->memo(key, fn)` caches a value for one request, so helpers like `downlineIds()` run once |

---

## 2. Where the Code Lives

### 2.1 Files

| File | Lines | What it holds |
|---|---|---|
| `resources/js/pages/credvault/team-vault/TeamVault.tsx` | 262 | The page: state, list effect, overlays |
| `resources/js/pages/credvault/team-vault/TeamDetails.tsx` | 319 | The left pane: department cards, hierarchy tree, person pick |
| `resources/js/pages/credvault/team-vault/ExportModal.tsx` | 263 | The Export Credentials popup |
| `resources/js/pages/credvault/team-vault/tvData.ts` | 247 | The data source (live API or dummy, `TV_DUMMY`) |
| `resources/js/pages/credvault/team-vault/tvShared.ts` | 162 | Levels, icons, `buildHierarchy`, `buildBranch`, `ownBranch` |
| `resources/js/pages/credvault/cvApi.ts` | 419 | The typed API client and `CvApiError` |
| `resources/js/pages/credvault/shared.tsx` | 663 | Shared table, tabs, drawer pieces used by every vault page |
| `app/Http/Controllers/Api/CredVault/NormalVault/NormalVaultController.php` | 79 | `index`, `nextCredentialCode`, `store`, `update`, `destroy` for the Normal Vault |
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | — | Every shared endpoint and the access helpers |

### 2.2 What runs when the page opens

| Order | Component | Call | Endpoint | Server function |
|---|---|---|---|---|
| 1 | `TeamVault` (list effect) | `tvData.list()` → `cvApi.vaultList(false)` | `GET /normal-vault/credentials?tab=team` | `NormalVaultController::index()` → `listCredentials()` |
| 2 | `TeamDetails` (every viewer) | `tvData.departments()` | `GET /team/departments` | `teamDepartments()` |
| 3 | `TeamDetails` (scoped viewer only) | `tvData.organisation()` | `GET /team/organisation` | `teamOrganisation()` → `hierarchy()` |
| 4 | `shared.tsx` | meta loader | `GET /meta` | `meta()` |

Calls 1–3 start at the same time; the page does not wait for one before the next.

---

## 3. The Data Source — `tvData.ts` and `cvApi.ts`

### 3.1 `TV_DUMMY` and the `live` / `dummy` objects

```ts
export const TV_DUMMY = false;
...
export const tvData = TV_DUMMY ? dummy : live;
```

Both objects answer the same six calls in the same shapes. With `TV_DUMMY = false` (the current value) every call is the live API:

| Call | Goes to | Endpoint |
|---|---|---|
| `departments()` | `cvApi.departments()` | `GET /team/departments` |
| `department(id)` | `cvApi.department(id)` | `GET /team/departments/{id}` |
| `organisation()` | `cvApi.organisation()` | `GET /team/organisation` |
| `recipients()` | `cvApi.recipients()` | `GET /share-recipients` |
| `exportPreview(sel)` | `cvApi.exportPreview(sel)` | `GET /exports/preview` |
| `list(q)` | `cvApi.vaultList(false, q)` | `GET /normal-vault/credentials` |

> **Explanation: why the dummy code is still in the file.** The Critical Vault's `cvData.ts` imports `ADMIN`, `later`, `toRow` and `Seed` from it, and the Access Requests' `arData.ts` imports `later`. Deleting the dummy block from `tvData.ts` breaks those two pages, even though the flag is Team Vault's.

### 3.2 `cvApi` — the transport

| Function | What it does |
|---|---|
| `get()` / `send()` | Prefix `/credvault` and turn every Axios failure into `CvApiError { status, errors, code }`. `get()` (and `download()`) drop empty params with `clean()`; `send()` sends the body as is |
| `CvApiError.field(name)` | The first message for one input — used to show an error under that input |
| `download()` | Streams a blob into a temporary `<a download>`. On failure the body is a JSON blob, which it parses back into a `CvApiError` |

---

## 4. The Page — `TeamVault.tsx`

### 4.1 State and the derived filters

```ts
const deptId = dept && dept.key !== 'admin' ? dept.key : null;
const memberEmp = tab === 'team' && member?.employeeId ? member.employeeId : null;
```

| Line | Meaning |
|---|---|
| `deptId` | The organisation node (`key: 'admin'`) means "everything", so no `department_id` is sent for it |
| `memberEmp` | The person filter is sent only on the Team tab — the server rule is that `mine` ignores Team-side filters |

### 4.2 The list effect

It runs again when any of `[tab, dq, page, pageSize, deptId, memberEmp, reload]` changes.

| Step | Code | What happens |
|---|---|---|
| 1 | `const my = ++seq.current` | A response from an older run is dropped (`if (my !== seq.current) return`), so a slow request never overwrites a newer one |
| 2 | `tvData.list({ tab, q: dq, page, per_page, department_id, member_employee_id })` | The request |
| 3 | success | Stores rows, `tabs` and `meta`; if the page is now past `last_page`, it jumps to `last_page` |
| 4 | failure on `member_employee_id` | Stored as `memberErr`; the server's message becomes the empty-state text |
| 5 | any other failure | Toast *Could not load credentials* |

`useDebounced(q.trim())` holds the search for 350 ms. A separate effect resets `page` to 1 whenever `dq` changes.

> **Explanation: step 4.** The source comment: *"A person with no CredVault login: nothing can be shared with them, so the filter is empty, not broken."* That is why it is shown as an empty list, not as an error toast.

### 4.3 `openDept()` and `selectMember()`

```ts
const openDept = (d) => { setDept(d); setMember(null); setPage(1); if (d) setTab('team'); };
const selectMember = (n) => { setMember(n); setPage(1); setTab('team'); };
```

Opening a department clears the picked person and switches to the Team tab. Picking a person also switches to the Team tab.

### 4.4 `open()` — the overlay switch

```ts
const previewable = (next?.kind === 'form' && !!next.id) || next?.kind === 'share' || next?.kind === 'export';
if (TV_DUMMY && !previewable) toast.info('Design preview', '…');
else setOverlay(next);
```

With `TV_DUMMY = false`, every overlay opens. The guard only matters on dummy data.

### 4.5 `onCopy()`

| Step | What happens |
|---|---|
| 1 | `cvApi.reveal(row.id, 'copy')` |
| 2 | `copyText(value, clear_clipboard_after)` — the clipboard is cleared after the server's 30 seconds |
| 3 | Toast *‹Label› copied* with *Clipboard clears in 30s.* |
| 4 | A **423** opens `UnlockModal` |

> **Explanation: step 4.** A Normal Vault credential has no lock steps, so the server never answers 423 for a Team Vault row. The branch is there because the same handler is used on protected (Critical Vault) rows.

### 4.6 What it renders

| Piece | Notes |
|---|---|
| `CvStrip` | Title, subtitle and **Export Credentials** → `open({ kind: 'export' })` |
| `CvBrief` | The four-step help panel, open by default (`defaultOpen`) |
| Left pane | `TeamDetails` with `dept`, `onOpenDept`, `selected`, `onSelect`. **Hide panel** sets `leftOff` (class `is-l-off`); the rail brings it back |
| Right pane | `CvTabsRow` (badge counts from `tabs[t.k]`), the person chip, `CredentialTable`, `WorklistPager` |
| `CredentialTable` | No `onShare` and no `onAdd` are passed, so a row has no Share button and the empty state has no Add button |
| Overlays | `ViewDrawer`, `CredentialFormModal scope="team" departmentId={deptId}`, `ShareModal`, `BinConfirm`, `UnlockModal`, `ExportModal` |

The export receives `{ tab, department_id: tab === 'team' ? deptId : null }`.

> **Explanation: no search and no person in the export.** The source comment: *"The table's search must not narrow the export."* The picked person is not sent either; the export is the tab plus the department.

---

## 5. The Left Pane — `TeamDetails.tsx` and `tvShared.ts`

### 5.1 Who is scoped

```ts
const scoped = !TV_DUMMY && !seesEveryone(user?.user_type);
```

`seesEveryone()` is true for the Vault Admin (Branch User). For them the browser trims nothing: it builds the tree from the server's `members`, already narrowed to their branch (`teamBranchOf()`, section 7.1). Every other viewer is **scoped**: the browser trims the organisation to "me and everyone below me".

### 5.2 The Vault Admin card

```ts
const branchAdmin = !TV_DUMMY && user?.user_type === 'branch_user';
const admins = branchAdmin ? [{ id: user?.id, name: user?.name }] : list?.admin?.admins ?? [];
const adminName = admins[0]?.name || 'Vault Administrator';
```

When the viewer is the Branch User, the admin card shows **the viewer** as the Vault Admin of the branch. `adminName` also labels the root node of every tree.

### 5.3 `loadList()`

```ts
const own = scoped && user
  ? tvData.organisation().then(d => setBranch(ownBranch(d.members ?? [], Number(user.id))))
  : Promise.resolve();
Promise.all([tvData.departments(), own]).then(([l]) => setList(l)).catch(e => setListErr(errMsg(e)));
```

A scoped viewer fetches the whole organisation once and keeps only their own branch of it — across **every** department they manage, not just their own.

### 5.4 `ownBranch(members, userId)`

| Step | What happens |
|---|---|
| 1 | Find the viewer's member row by `user_id`. None → `[]`, which shows *"You are not in the team hierarchy yet…"* |
| 2 | Build a map `manager_employee_id → reports` |
| 3 | Walk down from the viewer; a `seen` set stops a reporting loop |

### 5.5 Department cards

For a scoped viewer each card is rebuilt from the trimmed members: `members = mine.length`, `levels = levelsOf(mine)`, and a department with nobody from the viewer's branch is dropped. The HOD line shows only when the HOD is inside the viewer's branch; otherwise the card reads *Your team*.

### 5.6 The tree effect

It runs when `dept?.key` changes.

| Viewer | Selection | Source | Builder |
|---|---|---|---|
| Scoped | Organisation | The stored `branch` | `buildBranch(branch, meEmployeeId)` |
| Scoped | A department | `branch` filtered to that department, plus the viewer | `buildBranch(...)` |
| Vault Admin | Organisation | `GET /team/organisation` | `buildHierarchy(members, { name: adminName, desig: 'Vault Administrator · All departments' })` |
| Vault Admin | A department | `GET /team/departments/{id}` | `buildHierarchy(members, { name: adminName, desig: 'Vault Administrator' })` |

The organisation view opens with every direct child of the root folded (`open[k.id] = false`, `exp = 'col'`); a department opens fully expanded.

### 5.7 `buildHierarchy(members, admin)`

| Step | What happens |
|---|---|
| 1 | One `TreeNode` per member (`id: e<employee_id>`; level defaults to `emp`) |
| 2 | Each member hangs under `manager_employee_id` when that manager is in the set and is not the member itself; otherwise it becomes a root |
| 3 | **Loop repair** — nodes no root can reach (a reporting cycle) are removed from their parent and lifted to a root |
| 4 | Children are sorted by `LV_ORDER`, then by name |
| 5 | `rootedAt()` puts the Vault Admin node on top and counts each level (`cnt`) and the `total` |

`buildBranch()` builds the same tree but takes the **viewer's** node as the root, and hangs any member whose manager was cut off under the viewer.

> **Worth testing.** A reporting loop in HR (A reports to B, B reports to A). Without step 3 both people would disappear from the tree.

### 5.8 `Node`, `tog()` and `expandAll()`

| Function | What it does |
|---|---|
| `open[id] !== false` | A node is open unless it was folded |
| `tog()` | Flips one node |
| `expandAll(true)` | Clears the map — everything open |
| `expandAll(false)` | Folds every non-admin node that has children |
| Click a node | `onSelect(node)`; clicking the selected node again sends `null`, which clears the filter |

Closed branches are not rendered at all, which keeps a large organisation light.

---

## 6. The List Endpoint — `listCredentials()`

### 6.1 Entry and the module gate

`NormalVaultController::index()` → `listCredentials($request, 'normal')`. It first calls `tenantUser()`:

| Check | Result |
|---|---|
| No `client_id` on the user | 403 |
| No `can_view` on the `credentials-vault` menu | 403 |

`tenantUser()` is memoised, so the check runs once per request.

### 6.2 `memberFilter()` — the picked person

```php
$e = Employee::where('client_id', $u->client_id)->find($f['member_employee_id'], …)
    ?? $this->reject('That person is not part of your company.', 'member_employee_id', 404);
$f['member_id'] = $e->resolved_user_id
    ?? $this->reject('This person has no CredVault login yet, so nothing is shared with them.', 'member_employee_id', 422);
```

The login is then loaded with the same tenant check. The second message is the one the page shows as the empty state (section 4.2, step 4).

### 6.3 The base query

```php
$memberFull = $member && $this->managesMember($u, $member);
$base = $memberFull
    ? Credential::where(...client...)->where(fn ($w) => $w->where('owner_id', $member->id)->orWhereIn('id', $memberShareIds))
    : $this->visibleQuery($u, $vault === 'critical');
```

| Case | Base set |
|---|---|
| The viewer oversees the picked person (`managesMember()`) | The person's **whole** set — anything they own, any scope, plus what is shared with them or their department |
| Anyone else | The viewer's own `visibleQuery()`; the person is applied later on `$teamSide` |

`$vault` then pins `vault = normal`. Risk, type, group and search are applied to the base.

`managesMember()` is true when the viewer is the Vault Admin of the person's branch, the HOD of the person's department, or above the person in the reporting line. It is never true for oneself.

> **Explanation.** The source comment: the viewer *"sees that person's WHOLE vault, any scope — these are company credentials."*

### 6.4 `visibleQuery($u)` — which rows may be listed

A row is listed when **any** line below is true:

| # | Condition | Who it covers |
|---|---|---|
| 1 | `owner_id = me` | The owner |
| 2 | `id in sharedWithMeIds(me)` | A live share to me, or a team share to my department |
| 3 | `owner_id in overseenUserIds(me)` — any scope | People I am above |
| 4 | `scope = team` and (owner is a non-admin user of my branch, **or** the credential's branch is mine and the owner is a non-admin) | The Vault Admin (Branch User), through `adminBranchOf()` |
| 5 | `scope = team` and `department_id in headedDepts(me)` | The HOD |
| 6 | `scope = team` and `owner_id in downlineIds(me)` | A manager |

The Team Vault calls it with `$branchCritical = false`; the extra "whole branch" rule for critical credentials is used only by the Critical Vault list.

### 6.5 The tab closures

```php
'mine' => fn () => (clone $base)->where('owner_id', $u->id),
'team' => fn () => $member ? (clone $teamSide)
    : (clone $teamSide)
        ->where(fn ($w) => $w->where('scope', 'team')->when($overseen, fn ($q) => $q->orWhereIn('owner_id', $overseen)))
        ->where('owner_id', '!=', $u->id)->whereNotIn('id', $sharedIds),
```

| Tab | Rows |
|---|---|
| `mine` | Only what the viewer owns. The department and person filters are not applied |
| `team`, no person picked | Team-scope credentials **plus** anything owned by overseen people — never the viewer's own, never ones shared with the viewer |
| `team`, a person picked | The person's set, still narrowed to the open department |

All five closures (`all`, `mine`, `team`, `shared`, `others`) run `count()` for the tab badges, plus one count for `sharedby`; only the requested tab is paginated.

> **Common misunderstanding.** "A credential shared with me should be in the Team tab." The `team` closure removes `$sharedIds` on purpose; those rows are in the `shared` tab, which the Team Vault does not show. They appear in **My Vault → Shared With Me**.

### 6.6 `accessMap()` — how much the viewer may do

It loads the live shares for the whole page in one query and the owners of the team-scope rows in another, then walks each row. The first rule that matches wins; a share replaces it only when the share's rank is higher.

| # | Rule | Result `[rank, via]` |
|---|---|---|
| 1 | I own it | `[full, owner]` |
| 2 | Team credential; I am the Vault Admin of the owner's branch (or of the credential's branch), and the owner is not an admin login | `[full, branch]` |
| 3 | Team credential; the owner is in my downline | `[full, manager]` |
| 4 | Team credential in a department I head; the owner's **level** (from the designation; admin logins rank highest) is lower than mine | `[full, hod]` |
| 5 | Team credential in a department I head; the owner's level is not lower than mine | `[copy, team]` |
| 6 | A live share to me or my department | `[that share's rank, share]` if higher than the result above |
| — | Nothing matched | No entry — the row is listed with `access: null` |

### 6.7 `row()` and `canFlags()`

`row()` turns the pair into `access { permission, via, shared_by }` and `can`:

| Flag | True when |
|---|---|
| `reveal` | rank ≥ View |
| `copy` | rank ≥ Copy |
| `edit`, `share` | rank = Full |
| `delete` | rank = Full and `via` is not `share` (a critical-risk row also needs `via` = `owner` or `branch`) |
| `remove` | `via = share` — "Remove from your vault" |
| `edit_protection` | `via = owner` (a Critical Vault setting; not used on Normal Vault rows) |

A row with no entry in the map gets `access: null` and `can: null`; the table then disables Edit, Copy and Bin for it.

---

## 7. The Tree Endpoints

### 7.1 `teamDepartments()` — `GET /team/departments`

| Step | What happens |
|---|---|
| 1 | `teamBranchOf($u)` — the branch for a `branch_user` (`0` if none is on file, which matches nobody), otherwise `null` (no branch filter) |
| 2 | `levelCounts($clientId, $branch)` — one grouped query: department × designation → count, each designation passed through `levelOf()`. Memoised |
| 3 | Team-credential counts per department (`count` and a `critical` sum), filtered to the branch for the Vault Admin |
| 4 | Departments kept: the tenant's departments that have members or credentials |
| 5 | Each row: `hodOf()` (the stored HOD name and the login it resolves to), `members`, `levelList()`, credential counts; optional `q` filter on department name and HOD name |
| 6 | The `admin` block — admins, the sum of all levels, the department count and how many departments have a `head`. For a Branch User the frontend replaces the admin card with the viewer (§5.2), so this list is not what the Vault Admin sees |

> **Explanation: step 1.** The source comment: *"a client with two branches must not show branch A's admin the employees of branch B."*

### 7.2 `hierarchy($u, $dep)` — `GET /team/departments/{id}` and `GET /team/organisation`

| Step | What happens |
|---|---|
| 1 | `onTeam()` — Active, onboarding stage ≥ 6, and no finished exit |
| 2 | The branch filter for the Vault Admin; then the department, or `department_id is not null` for the organisation |
| 3 | Logins resolved by `employees.user_id`, else by `users.employee_code = emp_code`, in one batch |
| 4 | `manager_employee_id` is set only when that manager is in the result set — the frontend uses this to decide which nodes are roots |
| 5 | Counts per level, with `admin` put first. `tree` is also returned (`hierarchyTree()`), but the Team Vault screen does not use it — it builds the tree itself from `members` |
| 6 | `hierarchyTree()` builds the nested `tree` — cycle-safe through `$seen`; the organisation view adds one node per department under the Vault Admin |

> **Explanation: the exit check in step 1.** The source comment: *"The exit guard mirrors ExitController: a finished exit (Closed / Exited, not rehired) whose employees.status was never written back still counts as gone."*

### 7.3 `levelOf()` — designation to level

```php
str_contains($d, 'head of department') || str_contains($d, 'hod') => 'hod',
str_contains($d, 'team lead')                                      => 'tl',
str_contains($d, 'executive')                                      => 'exec',
str_contains($d, 'intern') || str_contains($d, 'trainee')          => 'intern',
default                                                            => 'emp',
```

The order matters: the first match wins. In `accessMap()`, heading a department makes a user an HOD whatever their designation says.

### 7.4 `deptHeads()` — why the HOD is matched to HR, not to the login

`master_departments.head` stores a **name**. It is matched against Active employees' display name, first + last and first + middle + last name, and only when **exactly one** employee matches. Platform-shared departments (`client_id null`) are left out.

> **Explanation.** The source records the reason: a login's own name can be edited on the profile, and HOD rights mean Full Access to a team vault, so they must never land on a namesake.

> **Worth testing.** Two Active employees with the same name as a department's `head`. The department must then have **no** HOD.

---

## 8. Actions on a Row

Every action starts with `findCredential()` (or `findInVault()` for the Normal Vault's own routes):

```php
$c   = Credential::where('client_id', $u->client_id)->...->find($id) ?? $this->reject('Credential not found.', null, 404);
$acc = $this->accessMap(collect([$c]), $u)[$c->id] ?? $this->reject('Credential not found.', null, 404);
if ($acc[0] < $min) $this->reject($message, null, 403);
```

> **Explanation: 404, not 403.** A credential the viewer cannot reach answers **404 "Credential not found."**, so a caller cannot tell "it exists but not for you" from "it does not exist". 403 is only for "you can reach it, but your rank is too low".

### 8.1 View — `ViewDrawer` → `show()`

`detail($c, $u, $acc, true)` returns the row, `locked`, `updated_by`, then every field, with secrets, the recovery key, notes and `all_values` in plain text **only for View and above**; attachments for all. With Full Access it also returns the live `shares[]` and `protection`. A Normal Vault row is never locked.

The drawer then posts `events { action: 'view' }` once and loads `activity`.

> **Explanation.** The source comment: *"Opening the drawer is logged once by logAccess"* (the comment means `logEvent()`: `POST /credentials/{id}/events`, `findCredential` at Use Only, audited *Opened credential details*; the drawer posts it only when the detail is not `locked`) — that is why the drawer sends one `view` event and the Activity endpoint hides the old per-open reveal rows.

### 8.2 Open an attachment — `attachment()`

| Step | What happens |
|---|---|
| 1 | `findCredential(…, RANK_VIEW, 'Your access is Use Only — attachments are not included.')` |
| 2 | `assertUnlocked()` — a no-op for a Normal Vault row |
| 3 | Find the attachment by `key` → 404 *That attachment does not exist.* |
| 4 | File not on the `local` disk → 404 *The file is missing from storage.* |
| 5 | Audit `view` with *Attachment opened: ‹file name›* |
| 6 | `Storage::disk('local')->download($path, $name)` |

### 8.3 Reveal and copy — `reveal()`

| Step | What happens |
|---|---|
| 1 | `findCredential(…, RANK_VIEW, 'Your access is Use Only — …')` |
| 2 | `copy` also needs `RANK_COPY` → 403 *Your access lets you view this credential but not copy it.* |
| 3 | `assertUnlocked()` — a no-op for a Normal Vault row |
| 4 | Pick the field: the type's `sec` field, a named secret field, or `recovery_key` |
| 5 | Audit `reveal` / `copy`, module *My Vault* (`$c->isProtected() ? 'Critical Vault' : 'My Vault'`) |
| 6 | Return the value with `hide_after_seconds: 30` and `clear_clipboard_after: 30` |

### 8.4 Edit — `NormalVaultController::update()` → `persistCredential()`

```php
[$c, $acc] = $this->findInVault($u, $id, 'normal', self::RANK_FULL,
    'Only the owner, a Vault Admin or someone with Full Access can edit this credential.');
```

| Who | May change |
|---|---|
| `via = owner` or `via = branch` (the Vault Admin) | Every field, including `scope` and `department_id` |
| `via = manager`, `hod` or a Full share | The details only; a changed `scope` → 403 *…can change the vault.*; a changed `department_id` → 403 *…can change the team.* |

`persistCredential()` then:

| Step | What happens |
|---|---|
| 1 | Validates; refuses a type change and a `critical` risk (those belong to the Critical Vault) |
| 2 | Checks for a duplicate name per owner + type |
| 3 | Resolves the department with `teamDepartmentFor()` |
| 4 | No minimum-strength check (that applies only to Critical Vault saves); the new strength is recalculated and stored |
| 5 | Saves inside `inTransaction()` and audits `edit` with the changed keys |
| 6 | Records any Password Health issue the save resolved |

### 8.5 Share — `share()`

| Step | What happens |
|---|---|
| 1 | Validate; Full Access required |
| 2 | `$until` from `expires_at` (end of that day) or `duration_days`. Neither means no end date — which the fixed 30-day maximum then refuses, so every share needs an end date within 30 days |
| 3 | A re-sharer who holds Full only through a share is capped at `ownShareEnd()` |
| 4 | Fixed sharing rules: an end date at most 30 days ahead, and a reason of at least 5 characters. Then the recipient checks: an active user, not the owner, not yourself, in your branch, and not the person who shared it with you |
| 5 | In a transaction: find the live share with `lockForUpdate()` or create one; on renewal keep the original `shared_by`; a unique-index race → 409; on renewal run `endOrphanedShares()`; audit; bell notification to the person, or to every team member except the sharer |
| 6 | Outside the transaction: `mailShare()` (BCC in batches of 50 for a team), then **201** (new) or **200** (renewed) |

> **Explanation: step 6 outside the transaction.** Mail can be slow or fail. Sending it after the commit means a mail error never rolls back a share that was saved.

### 8.6 `endOrphanedShares()` — re-shares that lost their source

Up to 10 rounds: for every live share made by someone other than the owner, `accessMap()` is run again for that sharer. If they are now below Full, their shares are revoked and audited *"Share ended — ‹name› no longer has Full Access"*. It repeats until a round ends nothing, so a chain of re-shares unwinds however deep it goes. It is called after a share renewal, a revoke, and a "Remove from your vault". Moving a credential to the bin does not call it.

> **Explanation: revoke.** `revokeShare()` (`DELETE /shares/{id}`) is not called from the Team Vault; revoking is done from My Vault → Shared By Me. On a team credential it is allowed for the owner, the sharer, or a viewer who reaches the credential as `branch`, `manager` or `hod`.

### 8.7 Bin or remove — `NormalVaultController::destroy()` → `binCredential()`

| `via` | What happens |
|---|---|
| `share` | Ends **my** user shares (409 if only a team share reaches me), audits `revoke`, runs `endOrphanedShares()` — "Remove from your vault" |
| anything else | Needs Full; sets `deleted_by`, soft-deletes, cancels open access requests, audits `bin`, and answers with the Recycle Bin period of the credential's branch — the branch's own period if its Branch User set one, otherwise 30 days |

---

## 9. Export

### 9.1 `ExportModal.tsx`

| Step | What happens |
|---|---|
| 1 | On open: `loadPreview({ tab, department_id, q })` (Team Vault passes `tvData.exportPreview`); groups with `count > 0` are kept and all ticked |
| 2 | `ok = sel > 0 && (!pw || (ack && (preview \|\| password.length > 0))) && !busy` — the Export button's enabled state |
| 3 | `run()` posts `cvApi.exportRun({ tab, department_id?, q?, groups, format: 'csv', include_notes: true, include_passwords, acknowledge?, account_password? })` |
| 4 | Success toast reads `x-credvault-count`; if passwords were asked for and `x-credvault-withheld > 0`, a second toast explains the placeholders |
| 5 | A 422 with field errors shows them under the inputs (`acknowledge`, `account_password`, or `groups` / `format` / `tab`); anything else is a toast *Export failed* |

### 9.2 `exportSet()` — the rows to export

```php
$q = $this->visibleQuery($u)->with(['owner:id,name', 'department:id,name']);
foreach (['vault', 'risk', 'type'] as $k) if (!empty($d[$k])) $q->where($k, $d[$k]);   // the Team Vault sends none of these
if ($tab === 'mine') $q->where('owner_id', $u->id);
else { $q->where('scope', 'team')->where('owner_id', '!=', $u->id)->whereNotIn('id', $this->sharedWithMeIds($u));
       if (!empty($d['department_id'])) $q->where('department_id', $d['department_id']); }
```

Then the search, `orderBy('code')`, and `_rank` / `_via` stamped on each model from `accessMap()`. `exportPreview()` uses the same set (light columns) for the per-group counts and both tab counts.

### 9.3 `export()` — `POST /exports`

| Step | What happens |
|---|---|
| 1 | Validate; with passwords, `acknowledge` must be accepted and `Hash::check()` the account password → 422 *Your account password is incorrect.* |
| 2 | `exportSet()` narrowed to the ticked `groups`; empty → 422 *No credentials match this selection.* |
| 3 | `exportRows()` — `EXPORT_COLUMNS`, plus *Password / Secret* through `fileSecret()` (protected → `[Protected — unlock in CredVault]`, below Copy → `[No copy permission]`) and *Notes* (empty for protected rows) |
| 4 | `VaultFile::build()`; in a transaction a `Transfer` (`EX-nnnn`, code allocated under the client row lock) and an `export` audit row, module *Team Vault* |
| 5 | `download()` with `X-CredVault-Code`, `X-CredVault-Count`, `X-CredVault-Withheld` and `Cache-Control: no-store` |

> **Worth testing.** Export with passwords as a viewer who has only View on some rows: those rows must say `[No copy permission]`, and the second toast must give the withheld count.

---

## 10. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | Access is worked out on every request; only shares are stored | `accessMap()` |
| BR-02 | The Vault Admin is the Branch User, for their own branch only | `adminBranchOf()`, `teamBranchOf()` |
| BR-03 | A team credential owned by an admin login gives no `branch` rights to anyone | `accessMap()` rule 2, `visibleQuery()` line 4 (`ADMIN_TYPES`) |
| BR-04 | A credential out of reach answers 404, never 403 | `findCredential()` |
| BR-05 | The Team tab never shows the viewer's own credentials or ones shared with the viewer | `listCredentials()` `team` closure |
| BR-06 | `mine` ignores the department and person filters | `listCredentials()` `mine` uses `$base`, not `$teamSide` |
| BR-07 | Only the owner and the Vault Admin may move a credential to another scope or team | `NormalVaultController::update()` |
| BR-08 | A re-share never outlives the re-sharer's own access | `share()` → `ownShareEnd()` |
| BR-09 | A sharer who drops below Full loses their re-shares, at any depth | `endOrphanedShares()` |
| BR-10 | A revealed value hides and a copied value clears after 30 seconds | `reveal()` → `hide_after_seconds`, `clear_clipboard_after` |
| BR-11 | Exporting readable passwords needs the acknowledgement **and** the account password | `export()` |
| BR-12 | The table's search does not narrow the export | `TeamVault.tsx` export selection |
| BR-13 | The HOD is matched to exactly one Active employee, never to a login's editable name | `deptHeads()` |
| BR-14 | Team Details shows only people on the team: Active, onboarded, not exited | `onTeam()` |
| BR-15 | A reporting loop never hides people from the tree | `buildHierarchy()` loop repair, `hierarchyTree()` `$seen` |
| BR-16 | A slow list response never overwrites a newer one | `TeamVault.tsx` `seq.current` |

---

## 11. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | No UI path creates a `scope: team` credential: Team Vault passes no `onAdd`, `CredentialForm` takes `scope` from the detail or `init` with no selector, and My Vault / the import send no team scope | Team rows come only from direct API calls |
| 2 | `/team/organisation` is not narrowed for ordinary employees | `ownBranch()` trims it in the browser only |
| 3 | `visibleQuery()` lists overseen users' **personal** credentials, but `accessMap()` gives no rank on a personal credential | Such rows are listed with `can: null` and answer 404 when opened. The class docblock still says a personal credential is the owner's alone |
| 4 | With `memberFull`, `tabs.mine` is counted on the picked person's set | The My Credentials badge changes while a person is picked; `docs/CREDVAULT_API_SHEET.md` says the member filter *leaves the "My Credentials" tab alone* |
| 5 | The chip and empty state say *owned by ‹name›* | The server also includes credentials shared with that person or their department |
| 6 | `exportSet()` gets no `vault` from the Team Vault and has no "overseen owner" rule | Export counts can differ from the Team Credentials tab, and the export can contain Critical Vault team credentials (written as `[Protected — unlock in CredVault]`) |
| 11 | The withheld toast always says *Protected secrets withheld … open only through an unlock* | On Normal Vault rows the usual reason is `[No copy permission]` — including rows with no `accessMap` entry, stamped `RANK_USE` |
| 7 | `levelOf()` uses `str_contains($d, 'hod')` | Matches any designation that merely contains those letters |
| 8 | Audit modules: `reveal` writes *My Vault* for team credentials; `export` writes *Team Vault* for a `mine` export | Audit Log filters by module can mislead |
| 9 | `ExportModal`'s own docblock says it exports the table's search | Team Vault intentionally passes no `q` (BR-12) |
| 10 | `X-CredVault-Count` is not in `Access-Control-Expose-Headers` | The count toast works only same-origin |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`), for their own branch |
| `[rank, via]` | What `accessMap()` returns per credential: how much, and why |
| `$base` | The listed set before the Team-side filters |
| `$teamSide` | `$base` plus the department and person filters — used by every tab except `mine` |
| `memberFull` | True when the viewer oversees the picked person, so the person's whole set is shown |
| Scoped viewer | A viewer whose tree the browser trims to "me and everyone below me" |
| Live share | A `credvault_shares` row that is neither revoked nor expired |
| Orphaned share | A re-share whose sharer no longer has Full Access |
| Memo | A value cached for one request by `$this->memo()` |
