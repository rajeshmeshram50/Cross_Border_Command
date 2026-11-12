# CredVault Access Request Management — Code Walkthrough

| | |
|---|---|
| **Jira** | To be added (parent — CredVault Access Request Management Documentation) |
| **Module** | CredVault → Access Request Management |
| **Audience** | Developers joining the module, code reviewers, tech leads |
| **Companion documents** | Functional Documentation · Technical Documentation · API Documentation · Critical Vault Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document walks through the Access Request Management **code** in the order it runs: the page loads the list, the server decides who sees which request, an approver presses **Approve** or **Reject**, and the requester cancels or locks. Each section names the function, says what it does and quotes the lines that matter. Read it next to the source. For what the user sees, read the Functional Documentation; for the request and response shapes, read the API Documentation.

### 1.2 The walkthrough in one paragraph

`AccessRequests.tsx` calls `arData.requests()`, which hits `GET /critical-vault/access-requests`. On the server `accessRequests()` builds a visibility base (the Vault Admin's branch, or the caller's own and named requests), applies the search, counts six tabs, pages the result and turns each row into the request object with `requestRow()`. The four buttons call `approve`, `reject`, `cancel` and `lock`; approve and reject both go through `decide()`, which checks the stage and the named approver, writes the decision, and either moves the request on, unlocks it, or ends it. The page then reloads quietly, and keeps doing so every 30 seconds.

### 1.3 How to read this document

Line numbers drift as the code changes; **function names are stable**, so search for the name. "Base" means `CredVaultController`, which `AccessRequestController` extends.

| Callout | Meaning |
|---|---|
| **Explanation** | Why the code is written this way, usually from a comment in the source |
| **Common misunderstanding** | Something a reader of the code often gets wrong |
| **Worth testing** | A path that is easy to break when the code is changed |

### 1.4 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| Vault Admin | The **Branch User**; `adminBranchOf($u)` returns their branch |
| Named approver | `admin_user_id` and `manager_user_id`, set by `requestAccess()` |
| `currentStage()` | The first step of a request not yet done — `admin`, `manager`, `otp` or `null` |
| `requestRow()` | Builds the request object the page renders, including the `can.*` flags |
| `decide()` | One function for approve and reject |
| `sweepUnlocks()` | Ends every window whose time has passed, on the next call |

---

## 2. Where the Code Lives

### 2.1 Files

| File | Lines | What it holds |
|---|---|---|
| `resources/js/pages/credvault/requests/AccessRequests.tsx` | 368 | The page |
| `resources/js/pages/credvault/requests/arData.ts` | 155 | The data source (`AR_DUMMY = false`) |
| `resources/js/pages/credvault/requests/requests.css` | 241 | Page styles |
| `resources/js/pages/credvault/cvApi.ts` | 419 | `requests`, `approve`, `reject`, `cancel`, `lock`; `AccessRequestRow` |
| `app/Http/Controllers/Api/CredVault/CriticalVault/AccessRequestController.php` | 427 | `accessRequests`, `accessRequest`, `approveRequest`, `rejectRequest`, `cancelRequest`, `lockRequest` (and the raise / code calls) |
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | 5,746 | `decide`, `requestRow`, `findRequest`, `canApproveAdmin`, `unlock`, `sweepUnlocks`, `notify`, `notifyStage`, `userInfo` |
| `app/Models/CredVault/AccessRequest.php` | 95 | The model |

### 2.2 One approval, and the function that runs at each step

| # | What happens | Function |
|---|---|---|
| 1 | The page loads | `AccessRequests.load()` → `arData.requests()` → `accessRequests()` |
| 2 | The server builds each row | `requestRow()` (`display_status`, `status_label`, `can.*`) |
| 3 | The Vault Admin presses **Approve** | `AccessRequests.approve()` → `approveRequest()` → `decide($u, $id, true)` |
| 4 | The requester forwards (Critical Vault) | `raiseManager()` |
| 5 | The manager presses **Approve** | `decide()` → `unlock()` or `status = approved` |
| 6 | Someone presses **Reject** | `confirmDialog()` → `rejectRequest()` → `decide($u, $id, false, …)` |
| 7 | The requester presses **Cancel** / **Lock now** | `confirmDialog()` → `cancelRequest()` / `lockRequest()` |
| 8 | Every 30 s | `load(true)` |

---

## 3. The Data Source — `arData.ts`

```ts
export const AR_DUMMY = false;
...
const live = {
  requests: cvApi.requests,
  approve: (id: number) => cvApi.approve(id),
  reject: (id: number) => cvApi.reject(id),
  cancel: cvApi.cancel,
  lock: cvApi.lock,
};
export const arData = AR_DUMMY ? dummy : live;
```

| Point | Detail |
|---|---|
| Live | With `AR_DUMMY = false` every call is the real API |
| Reject | `cvApi.reject(id)` sends **no note**, so the server stores *Not approved at this time* |
| Dummy | 22 fixed requests that move Vault Admin → Manager → approved in memory, for design work only. It skips the forward: a Vault Admin approval goes straight to the manager stage |

---

## 4. The Page — `AccessRequests.tsx`

### 4.1 Constants

```ts
const TABS = [
  { key: 'all', label: 'All Requests', ... }, { key: 'pending', label: 'Pending Requests', ... },
  { key: 'approved', label: 'Approved Requests', ... }, { key: 'rejected', label: 'Rejected Requests', ... },
];
const COLS = ['Sr. No', 'Request ID', 'Credential', 'Requested By', 'Reason', 'Access Window', 'Vault Admin', 'Reporting Manager', 'Status', 'Action'];
const POLL_MS = 30_000;
```

The server returns six tabs; the page shows four (`mine` and `to_me` are not used).

### 4.2 `load()`

```ts
const load = useCallback(async (silent = false) => {
  const my = ++seq.current;
  if (!silent) setLoading(true);
  try {
    const r = await arData.requests({ tab, q: dq, page, per_page: perPage });
    if (my !== seq.current) return;
    setRows(r.data); setTabs(r.tabs); setMeta(r.meta); setError(null); setFetchedAt(Date.now());
    if (r.meta.current_page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
  } ...
```

| Step | What happens |
|---|---|
| 1 | `++seq.current` — a response from an older call is dropped |
| 2 | On success: rows, tab counts, paging and `fetchedAt` (the countdown's base) |
| 3 | A page past the last one steps back |
| 4 | On a normal load failure: the error row *Could not load requests* with **Try again**; a silent poll failure keeps the old rows |

> **Explanation.** The source comment: *"A silent poll can supersede a normal load, so whichever finishes last clears the shimmer."* That is why `setLoading(false)` runs only for the latest `seq`.

### 4.3 Polling and the countdown

```ts
useEffect(() => {
  const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, POLL_MS);
  const v = () => { if (document.visibilityState === 'visible') load(true); };
  document.addEventListener('visibilitychange', v);
  ...
}, [load]);

const left = (r) => Math.max(0, Math.min(r.seconds_left, r.seconds_left - Math.floor(Math.max(0, now - fetchedAt) / 1000)));
```

| Piece | Rule |
|---|---|
| Poll | Every 30 s, only while the browser tab is visible; once more when it becomes visible |
| `useNow(anyLive)` | Ticks every second only while some row has `seconds_left > 0` (the server's figure) — so it keeps ticking until the next fetch, even after `left()` reaches 0 |
| `left()` | Subtracts the time since the fetch and **never goes above** the server's figure |

### 4.4 `approve()`

```ts
const approve = async (x) => {
  setBusy(x.id, true);
  setApproving(x.id);
  try {
    const res = await arData.approve(x.id);
    decided(x.id);
    const toMgr = x.stage === 'admin' && x.manager;
    toast.success(`${x.code} ${toMgr ? 'approved · the requester forwards it to the Manager' : 'fully approved'}`, res.message);
    await load(true);
  } catch (e) { toast.error('Could not approve', errMsg(e)); await load(true); }
  finally { setBusy(x.id, false); setApproving(null); }
};
```

| Piece | Why |
|---|---|
| `busyIds` (a Set) | A busy flag **per row** — the source: *"approving A then B must not re-enable B when A finishes first."* |
| `decided(id)` | Switches the row's Approve / Reject off at once, before the reload lands (CS-1467 / CS-1468: the buttons used to come back for 3–4 s) |
| `toMgr` | A Vault Admin approval with a manager step waits for the requester's forward, so the toast says so. *fully approved* means the approvals are done — with a code step the requester still has to enter the code. `res.message` (*Approved.* / *Rejected.* / *Request cancelled.* / *Locked.*) is the toast's second line |
| On failure | Toast, then a reload — e.g. someone else decided first |

### 4.5 `confirmDialog()` — reject, cancel, lock

```ts
if (dialog.kind === 'reject') { const res = await arData.reject(x.id); decided(x.id); toast.warning(`${x.code} rejected`, res.message); }
else if (dialog.kind === 'cancel') { const res = await arData.cancel(x.id); toast.info(`${x.code} cancelled`, res.message); }
else { const res = await arData.lock(x.id); toast.info(`${x.credential?.name ?? x.code} locked`, res.message); }
setDialog(null);
await load(true);
```

While it runs, the dialog cannot be closed (`busyIds.has(d.id)`), and the confirm button shows a spinner with *Rejecting…* / *Cancelling…* / *Locking…*. On failure: toast *Action failed*, close, reload.

### 4.6 The row — buttons and cells

```ts
const awaitingForward = x.stage === 'manager' && x.manager?.status === 'after_admin';
const canDecide = (ok: boolean) => ok && !awaitingForward;
const mgrWait = x.manager?.status === 'not_required' || x.admin?.status === 'rejected' ? 'Not required'
  : awaitingForward ? 'Awaiting forward' : 'After Vault Admin';
```

| Piece | Rule |
|---|---|
| Approve / Reject | Enabled when `can.approve` / `can.reject` **and** not awaiting the forward; tooltip *Approve as Vault Admin / Reporting Manager*, or *The requester has not forwarded this to the manager yet* |
| Lock now | Rendered only when `can.lock` (a **live** window) |
| Paging | Changing the tab, the page size or the (debounced) search resets to page 1 |
| Cancel | Rendered only when `can.cancel` |
| `Approver` cell | Stage object missing, or status `after_admin` / `not_required` → the waiting text (*Not required*, *After Vault Admin*, *Awaiting forward*). Otherwise the name — `decided_by` ?? `user` ?? *Any Branch Admin* / *Reporting Manager* — then *Pending / Approved / Rejected*, plus *· HH:MM* once decided, and *Reason: ‹note›* as the tooltip on a rejection |
| `statusCell()` | `pending` → *Vault Admin approved · awaiting forward* or `status_label`; `approved` → **Unlocked** with the countdown while `left() > 0`, else **Approved** + `status_label`; `rejected` → `status_label` without the word *Rejected*; else **Reset** / **Cancelled** |

> **Common misunderstanding.** "`can.approve` is enough." It is not at the manager stage: the server sets it for the named manager even before the forward. `awaitingForward` is the extra check that keeps the buttons greyed out until then.

---

## 5. The List — `AccessRequestController::accessRequests()`

### 5.1 The visibility base

```php
$admin  = $this->isAdmin($u);
$branch = $this->adminBranchOf($u);
$base   = AccessRequest::where('client_id', $u->client_id);
$base->where(function ($w) use ($u, $branch) {
    $w->where('requester_id', $u->id)->orWhere('admin_user_id', $u->id)->orWhere('manager_user_id', $u->id);
    if ($branch) {
        $w->orWhereIn('requester_id', User::where('client_id', $u->client_id)->where('branch_id', $branch)->select('id'));
    }
});
```

| Caller | Rows |
|---|---|
| The Vault Admin (`adminBranchOf()` returns their branch) | Every request whose requester belongs to the branch, plus their own and the ones naming them |
| Anyone else | Their own, and the ones naming them as the Vault Admin or the manager |

> **Explanation.** The inner source comment: *"The Branch Admin (Vault Admin) sees every request raised in their branch; everyone else only theirs and the ones on them."* (The method's own docblock at the top is out of date — the inner comment is the current rule.)

### 5.2 The search

```php
$num = preg_match('/\d+/', $term, $m) ? (int) $m[0] : null;
$durMins = $num !== null ? (preg_match('/\b(h|hr|hrs|hour)/i', $term) ? $num * 60 : $num) : null;
```

It matches the code, the reason, the credential (name, code, category, type — including trashed credentials), people by name (requester, named approvers, the Vault Admin decider), the requester's department, and the window: the first number in the term, × 60 when the term has an hour unit (*1 hour* → 60).

### 5.3 The tabs

```php
$tabsFn = [
    'pending'  => fn ($q) => $q->where('status', 'pending'),
    'approved' => fn ($q) => $q->whereIn('status', ['approved', 'unlocked', 'locked'])
        ->where(fn ($w) => $w->whereNull('locked_reason')->orWhere('locked_reason', '!=', 'otp_failed')),
    'rejected' => fn ($q) => $q->where('status', 'rejected'),
    'mine'     => fn ($q) => $q->where('requester_id', $u->id),
    'to_me'    => $toMe,
];
// Counts ignore the search box; the list honours it.
$tabs = ['all' => (clone $base)->count()];
foreach ($tabsFn as $k => $fn) $tabs[$k] = $fn(clone $base)->count();
```

The counts are taken from clones of the **unsearched** base; only the chosen tab's predicate is applied to the searched query. Then `orderByDesc('id')`, paging, one batch `userInfo()` for the requesters, and `requestRow()` per row.

> **Worth testing.** A request reset by 3 wrong codes must **not** be counted under Approved, and a cancelled one must appear only under All.

---

## 6. The Request Object — `requestRow()`

### 6.1 Who may decide

```php
$canDecide = $r->status === 'pending' && $r->requester_id !== $u->id && (
    ($stage === 'admin' && $this->canApproveAdmin($u, $r))
    // Manager step: the manager decides — even if they are also the Vault
    // Admin who approved step 1 (RM = branch admin). Two separate actions.
    || ($stage === 'manager' && $r->manager_user_id === $u->id)
);
```

### 6.2 What the page shows

```php
$display = match (true) {
    $r->status === 'pending'                                      => 'pending',
    $r->status === 'rejected'                                     => 'rejected',
    $r->status === 'cancelled'                                    => 'cancelled',
    $r->status === 'locked' && $r->locked_reason === 'otp_failed' => 'reset',
    default                                                       => 'approved',
};
```

| Key | How it is built |
|---|---|
| `status_label` (pending) | *Step n of m · ‹stage›*, where n and m count the **approval** steps only |
| `status_label` (approved) | *Approved · enter the authenticator / email code* (from the credential's method), *Unlocked* while live, else *Both approvals done* |
| `manager.status` | `$r->manager_status ?? ($r->admin_status === 'rejected' ? 'not_required' : 'after_admin')` |
| `duration_label` | ≥ 60 → *‹minutes ÷ 60› hour* (60 is the largest window, so *1 hour*); else *‹n› min* |
| `requester.role_line` | From `userInfo()`: designation · department, else *Team member* |
| `admin.any_admin` | `true` only when no Vault Admin is named |
| `admin` / `manager` | `null` when the request has no such step — the page then shows *Not required*, and `toMgr` relies on `x.manager` |

---

## 7. Approve and Reject — `decide()`

### 7.1 The entry points

```php
public function approveRequest(Request $request, int $id) { ... return $this->decide($u, $id, true, $d['note'] ?? null); }
public function rejectRequest(Request $request, int $id)  { ... return $this->decide($u, $id, false, filled($d['note'] ?? null) ? trim($d['note']) : 'Not approved at this time'); }
```

### 7.2 The checks

```php
$r = $this->findRequest($u, $id, true);
if ($r->status !== 'pending') $this->reject('This request is no longer waiting for approval.', null, 409);
$stage = $r->currentStage();
if ($r->requester_id === $u->id) $this->reject('You cannot decide your own request.', null, 403);
if ($stage === 'admin') {
    if (!$this->canApproveAdmin($u, $r)) $this->reject('This request is waiting for ' . ($r->adminUser?->name ?? 'the Branch Admin') . '.', null, 403);
} elseif ($stage === 'manager') {
    if ($r->manager_status !== 'pending') $this->reject('This request has not been forwarded to the reporting manager yet.', null, 409);
    if ($r->manager_user_id !== $u->id) $this->reject('This request is waiting for ' . ($r->managerUser?->name ?? 'the reporting manager') . '.', null, 403);
} else {
    $this->reject('This request has no approval waiting.', null, 409);
}
```

All inside one transaction, with the request row locked (`findRequest(…, true)` → `lockForUpdate()`), so two approvers pressing at the same moment cannot both win.

### 7.3 `canApproveAdmin()`

When the request names a Vault Admin (`admin_user_id`), **only that person** may decide the Vault Admin stage; only on a request with no named admin may any active Vault Admin of the request's branch decide. `requestAccess()` always names one — the credential's `lock_admin_user_id` when that person is a Vault Admin of the requester's branch, otherwise the lowest-id active Vault Admin of that branch, never the requester — so in practice one person decides.

### 7.4 The outcome

```php
$r->fill(["{$stage}_status" => $approve ? 'approved' : 'rejected', "{$stage}_decided_by" => $u->id,
          "{$stage}_decided_at" => now(), "{$stage}_note" => $note]);
if (!$approve) {
    $r->status = 'rejected';          // audit 'reject', notify the requester
} else {
    $next = $r->currentStage();       // audit 'approve'
    if ($next === null)       $this->unlock($r, $u);
    elseif ($next === 'otp')  $r->status = 'approved';
    // next === 'manager': stays pending; the requester is told to forward it
}
```

| Outcome | Status | The requester is notified |
|---|---|---|
| Reject | `rejected` | *Access request rejected — ‹role› ‹name› rejected your request …: ‹note›* |
| Approve, manager next | `pending` (`manager_status` still `null`) | *Vault Admin approved — … Forward it to your reporting manager to continue.* |
| Approve, code next | `approved` | *Access approved — … Enter your authenticator code to open it.* |
| Approve, nothing left | `unlocked` | *Access approved — "‹name›" is unlocked for ‹n› min.* |

> **Explanation.** The source: *"The manager stage is no longer opened automatically — the requester forwards it (raise-manager)."* And: when the reporting manager is also the Vault Admin, *"the same person gives both approvals — two separate, audited actions, by design."*

---

## 8. Cancel, Lock and the Helpers

### 8.1 `cancelRequest()`

```php
$r = $this->findRequest($u, $id, true);
if ($r->requester_id !== $u->id) $this->reject('Only the person who raised a request can cancel it.', null, 403);
if (!in_array($r->status, ['pending', 'approved'], true)) $this->reject('This request is no longer open.', null, 409);
$r->update(['status' => 'cancelled']);
EmailOtp::forgetUnlock($r->id);
```

Audited as *Request REQ-… cancelled by requester*.

### 8.2 `lockRequest()`

The requester or the Vault Admin; `status` must be `unlocked` → `locked`, `locked_reason = manual`; audited as *Credential locked again*.

### 8.3 `findRequest()`

```php
$q = AccessRequest::where('client_id', $u->client_id)->with(self::REQUEST_RELATIONS);
if ($lock) $q->lockForUpdate();
$r = $q->find($id) ?? $this->reject('Access request not found.', null, 404);
// visible to the requester, the named Vault Admin, the named manager, or anyone canApproveAdmin() allows
```

> **Common misunderstanding.** "The Vault Admin can open every request the list shows them." The list uses the **branch** rule (5.1), but `findRequest()` uses the **named-approver** rule. A branch request named to another Vault Admin is listed, yet its detail and actions answer 404.

### 8.4 `notifyStage()` and `sweepUnlocks()`

| Function | What it does |
|---|---|
| `notifyStage($r, $who)` | Stage `admin` → the named Vault Admin: *Access request to approve — ‹who› asks to unlock "‹name›" for ‹n› min (REQ-…).* Stage `manager` → `manager_user_id`, on the forward or at creation when there is no Vault Admin step (the text still says it passed the Vault Admin): *…'s request … passed the Vault Admin and needs your approval (REQ-…).* Both link to `/credentials-vault/access-requests`. Called only by `requestAccess()` and `raiseManager()` — `decide()` notifies the requester itself |
| `sweepUnlocks()` | Run by the request list and one request here, by raising a request, and by the credential list, show, reveal and dashboard — not by approve, reject, cancel, lock, raise-manager or verify-otp. Once per HTTP request: every ended window → `locked`, `locked_reason = expired`, `locked_at = expires_at`, audited *Unlock window ended — locked again* |

---

## 9. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | The Vault Admin sees every request raised in their branch | `accessRequests()` visibility base |
| BR-02 | Tab counts ignore the search | `accessRequests()` — counts from the unsearched base |
| BR-03 | Reset requests are not "approved" | The `approved` tab predicate |
| BR-04 | Nobody decides their own request | `decide()`, `requestRow()` |
| BR-05 | Only the named Vault Admin decides the Vault Admin stage | `canApproveAdmin()` |
| BR-06 | The manager acts only after the forward | `decide()`, `awaitingForward` in the page |
| BR-07 | Two approvers cannot both win | `findRequest(…, true)` row lock |
| BR-08 | A rejection without a note reads *Not approved at this time* | `rejectRequest()` |
| BR-09 | Only the requester cancels; only while pending or approved | `cancelRequest()` |
| BR-10 | Lock now only on an unlocked request, by the requester or the Vault Admin | `lockRequest()` |
| BR-11 | A decided row's buttons switch off at once | `decided()` in the page |
| BR-12 | The page refreshes every 30 s while visible | `POLL_MS`, `visibilitychange` |

---

## 10. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | The list uses the branch rule, `findRequest()` the named-approver rule | A listed branch request named to another Vault Admin answers 404 on detail and actions |
| 2 | `can.approve` is true for the named manager before the forward | The page needs its own `awaitingForward` check; the server answers 409 until the forward |
| 3 | `to_me` excludes manager rows the caller already approved as Vault Admin | They can still decide them; they just do not appear under `to_me` |
| 4 | The actions do not sweep first | An ended, unswept window can still be locked and is stored as `manual` |
| 5 | The page sends reject without a note | The requester always reads *Not approved at this time* |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Base | `CredVaultController`, which `AccessRequestController` extends |
| Named approver | `admin_user_id` / `manager_user_id` |
| Stage | `admin`, `manager` or `otp` |
| Forward | `raiseManager()` — the requester opens the manager stage |
| `busyIds` | The page's per-row busy flags |
| `seq` | The page's counter that drops stale responses |
| Sweep | `sweepUnlocks()` — locks every window that has ended |
