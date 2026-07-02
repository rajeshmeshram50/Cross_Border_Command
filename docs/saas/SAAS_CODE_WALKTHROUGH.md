# SAAS PLATFORM — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command · Multi-tenant SaaS ERP
> Platform-level trace: login → tenant scope → branch switch → gating → activation → isolation.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial platform code walkthrough |

> For per-entity code paths see `docs/client/`, `docs/branch/`, `docs/plan/`, `docs/payment/`, `docs/permission/`, `docs/payroll/`.

---

## 0. HOW TO READ THIS DOCUMENT
This traces the **cross-cutting platform mechanics** — the parts every module relies on. Line numbers may drift; method/file names are stable. Legend: `→` a call · `⇒` a return.

Primary files: `AuthController.php`, `EnsureUserActive.php`, `MasterVisibility.php`, `SubscriptionController.php`, `resources/js/api.ts`, `contexts/AuthContext.tsx`, `contexts/BranchSwitcherContext.tsx`, `layouts/Sidebar.tsx`.

---

## 1. LOGIN → TOKEN + PERMISSIONS MAP

### 1.1 Three login paths (one token)
```php
POST /api/login          → email + password (PasswordHistory enforced)
POST /api/login/face     → 128-d face descriptor (login threshold 0.50)
POST /api/google-login   → Google OAuth (user must exist)
```
All resolve a `User`, apply the brute-force lockout (5/15min, shared cache key), and mint a Sanctum token.

### 1.2 Per-tenant email disambiguation
Because email is unique **per client** (not global), a plain email may match users under several clients. The login returns `needs_org_selection` with the candidate orgs; the SPA shows a picker, then re-submits with the chosen client.

### 1.3 The permissions payload (`AuthController::formatUser`, ~592)
```php
// super_admin: bypass (no per-module map needed)
foreach ($modulesWithPerms as $p) {
    $permissions[$p->module->slug] = [
        'can_view'=>$p->can_view, 'can_add'=>$p->can_add, /* … */ 'can_approve'=>$p->can_approve,
    ];
}
return [ ...user..., 'user_type'=>..., 'client_id'=>..., 'branch_id'=>..., 'permissions'=>$permissions,
         'plan'=>[ 'has_plan'=>..., 'expired'=>... ] ];
```
The SPA stores this and gates on it.

### 1.4 Frontend (`AuthContext.tsx`)
```tsx
// refresh() calls /me on mount + on window focus (throttled 60s) to repopulate user.permissions & plan
```

---

## 2. EVERY AUTHENTICATED REQUEST

### 2.1 Frontend interceptor (`resources/js/api.ts`)
```tsx
config.headers.Authorization = `Bearer ${localStorage.cbc_token}`;
// auto-inject the active branch on GETs (except /branches, /me, auth endpoints)
if (method === 'get' && activeBranchId > 0 && !hasBranchParam) config.params.branch_id = activeBranchId;
// 401 → clear token, redirect /login
```

### 2.2 Middleware chain
```php
Route::middleware(['auth:sanctum', 'user.active'])->group(function () { /* all protected routes */ });
```
`EnsureUserActive` (`user.active`) checks the **status** of the user, their client, and their branch — not module permissions:
```php
if ($user->status !== 'active') abort(403);
if ($user->client && $user->client->status !== 'active') abort(403);   // suspended tenant
if ($user->branch && $user->branch->status !== 'active') abort(403);   // deactivated office
```

### 2.3 Controller scope resolution (the universal pattern)
```php
$user = $request->user();
$clientId = $user->client_id;                 // ALWAYS from the user, never the body
// branch: branch_user pinned; others may use the injected ?branch_id
$query = Model::query();
MasterVisibility::applyReadScope($query, $user);   // creator-hierarchy scoping
```

---

## 3. TENANT ISOLATION (`MasterVisibility::applyReadScope`)

```php
if ($user->user_type === 'super_admin') { if ($branchFilter) $q->where('branch_id',$branchFilter); return; }

if (in_array($user->user_type, ['client_admin','client_user'])) {
    $q->where(fn($w)=>$w->whereNull('client_id')->orWhere('client_id',$user->client_id));
    $this->applySwitcherBranchFilter($q,$user,$branchFilter);      // may narrow to a branch
    return;
}
if ($user->user_type === 'branch_user') {
    $q->where(fn($w)=>$w->whereNull('client_id')
        ->orWhere(fn($x)=>$x->where('client_id',$user->client_id)
            ->where(fn($y)=>$y->whereNull('branch_id')->orWhere('branch_id',$user->branch_id))));
    return;   // sibling branches hidden; switcher ignored
}
if ($user->user_type === 'employee') {
    // globals + client-level + own rows (created_by = self) — peer-isolated
    ...
    return;
}
$q->whereRaw('1 = 0');   // unknown → nothing
```
Mutation guard `hierarchicalDenial()` derives the row's tier from its `client_id`/`branch_id` stamps and blocks lower tiers from editing higher-tier rows.

---

## 4. BRANCH SWITCHER

### 4.1 `BranchSwitcherContext.tsx`
```tsx
canSwitch = (user.user_type === 'client_admin');           // only client-admins switch
const res = await api.get('/branches', { params: { per_page: 100 } });   // dropdown source
localStorage.setItem(`cbc_selected_branch_id_${user.id}`, String(id ?? ''));  // per-user persistence
setBranch = (id) => { /* validate, persist */ window.location.reload(); };    // refetch under new scope
// branch_user is hard-pinned to user.branch_id (setBranch is a no-op)
```
The interceptor (§2.1) turns the stored id into `?branch_id=` on GETs; only branch-scoped list endpoints honour it.

---

## 5. SUBSCRIPTION ACTIVATION (plan → tenant unlock)

### `SubscriptionController::activatePlan()` (the platform payoff)
```php
DB::transaction(function () use ($payment, $plan, $client, $user) {
    $payment->update(['status' => 'success']);
    // 1. tenant subscription state
    $client->update(['plan_id'=>$plan->id, 'plan_type'=>'paid', 'status'=>'active',
                     'plan_expires_at'=>$payment->valid_until]);
    // 2. module gating → concrete permissions for the client-admin
    Permission::where('user_id',$user->id)->delete();
    foreach (Module::where('is_active',true)->get() as $module) {
        $pm = $plan->planModules->firstWhere('module_id',$module->id);
        if (!($pm && in_array($pm->access_level,['full','limited'])) && !$module->is_default) continue;
        $full = ($pm && $pm->access_level==='full') || $module->is_default;
        DB::table('permissions')->insert(['user_id'=>$user->id,'client_id'=>$client->id,
            'module_id'=>$module->id,'can_view'=>true,'can_add'=>$full, /* … */]);
    }
    // 3. downgrade hygiene + branch cap
    $this->cascadePruneDownstreamPermissions($client->id,$user->id);
    $this->enforceBranchLimit($client,$plan,$kept);        // deactivate extra branches, revoke tokens
});
$this->invoiceMailer->sendForPayment($payment->fresh());   // after commit
```
This is where a **Plan** becomes a tenant's real capabilities. See `docs/payment/` for the full checkout/verify flow and `docs/plan/` for the gating model.

---

## 6. EXPIRY ENFORCEMENT (frontend)

`App.tsx`:
```tsx
const isClient = user_type === 'client_admin' || 'branch_user';
const planExpiredOrMissing = isClient && user.plan && (!user.plan.has_plan || user.plan.expired);
const defaultPages = ['/my-plan','/profile','/plan-blocked'];
// if expired and current path ∉ defaultPages:
//   branch_user → /plan-blocked ; client_admin → /my-plan
```
`navigateFn` applies the same guard to programmatic navigation.

---

## 7. MENU / PAGE GATING

### `Sidebar.canView(id)`
```tsx
if (isSuperAdmin) return /* all except non-whitelisted master.* */;
if (['dashboard','profile','my-plan'].includes(id)) return true;
if (['sales.','clm.','developers.'].some(p=>id.startsWith(p)) && (branch_user||employee)) return true; // temp bypass
if (planBlocked) return false;
return !!perms[id]?.can_view;                     // the login permissions map
```
`utils/menuAccess.moduleVisible()` mirrors this for the horizontal header. There is **no route-level permission guard** — direct URLs generally still resolve; gating is menu/page-level.

---

## 8. TENANT PROVISIONING (create client → branch + admin)

`ClientController::store()` (see `docs/client/`):
```php
DB::transaction(function () {
    $client = Client::create([... 'plan_type'=>'free', 'status'=>'inactive' ...]);
    Branch::create(['client_id'=>$client->id, 'code'=>'HO', 'name'=>"$org — Head Office", 'status'=>'active']);
    User::create(['client_id'=>$client->id, 'user_type'=>'client_admin',
        'password'=>Hash::make($pw), 'password_encrypted'=>Crypt::encryptString($pw)]);   // reversible mirror
    // welcome email with the plaintext password (best-effort)
});
```
`BranchController::store()` follows the same shape for a branch + its `branch_user` (with a `BR-###` code and plan `max_branches` gate).

---

## 9. CROSS-CUTTING PATTERNS (platform)

| Pattern | Where | Why |
|---|---|---|
| Scope from the user | every controller | Never trust body `client_id` |
| Creator-hierarchy scope | `MasterVisibility` | Branch/employee isolation |
| Provisioning transaction | Client/Branch create | Atomic tenant + admin |
| Reversible admin password | Client/Branch admins | Super-admin recall |
| Token revocation | deactivate/delete paths | Instant logout |
| Plan → permissions | `activatePlan` | Module gating becomes real grants |
| Login-payload gating | `formatUser` + Sidebar | Menus driven by `can_view` |
| Branch-id injection | `api.ts` | Client-admin branch focus |
| Inline mail/jobs | no worker | Runs in-request |

---

## 10. NOTES & CAVEATS

- **DB is PostgreSQL** — `ilike`, JSONB, partial unique indexes (per-tenant email).
- **No queue worker/scheduler** — mail, lead sync, Zoho polling are request/UI-driven.
- **Most business APIs are not flag-enforced** — the permission map gates the SPA.
- **Reversible admin passwords** decryptable with DB + `APP_KEY`.
- **Razorpay webhook disabled locally** — verify-payment path is authoritative.
- **Branches are equal peers** — `is_main` removed (2026-06-20).

---

*Related documents: SAAS_TECHNICAL_DOCUMENTATION.md · SAAS_FUNCTIONAL_DOCUMENTATION.md · SAAS_API_DOCUMENTATION.md · and the per-module sets under docs/.*
