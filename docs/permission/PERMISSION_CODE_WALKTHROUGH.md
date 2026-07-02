# PERMISSION MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Access Control → Permissions
> A guided, execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT
Follows: load matrix → edit → save (with all guards) → downstream cascade → how the saved flags gate the SPA. Line numbers reference the live source and may drift. Legend: `→` a call · `⇒` a return.

Primary files: `PermissionController.php`, `AuthController.php` (login payload), `PermissionMatrix.tsx`, `Permissions.tsx`, `Sidebar.tsx`.

---

## 1. LOADING THE MATRIX

### 1.1 Frontend (`Permissions.tsx`)
```tsx
// module tree + manageable users + (on pick) the target's grants + my own grants
const mods = await api.get('/modules');
const users = await api.get('/permissions/users');
const target = await api.get(`/permissions/user/${userId}`);
const mine   = await api.get(`/permissions/user/${authUser.id}`);   // → myPerms for grantableBy
// grantableBy = isSuperAdmin ? null : myPerms
```

### 1.2 `PermissionController::modules()` (15)
```php
return Module::where('is_active', true)
    ->orderBy('parent_id')->orderBy('sort_order')
    ->get(['id','parent_id','name','slug','icon','is_default','sort_order','description']);
// flat list; the SPA builds the tree via parent_id
```

### 1.3 `getUserPermissions()` (25) — read guard
```php
$target = User::findOrFail($userId);
$allowed = $auth->id === $target->id                                   // self
        || $auth->isSuperAdmin()
        || ($auth->isClientAdmin() && $target->client_id === $auth->client_id)
        || ($auth->isClientAdmin() && $target->client_id === null)     // orphan adopt-preview
        || ($auth->isBranchUser() && $target->user_type==='employee'
             && $target->client_id===$auth->client_id && $target->branch_id===$auth->branch_id);
if (!$allowed) abort(403);
return ['user'=>[...], 'permissions'=> Permission::where('user_id',$target->id)->with('module:id,name,slug,icon')->get()];
```

### 1.4 `manageableUsers()` (66) — the picker
```php
// super_admin  → active client_admins (client active)
// client_admin → active branch_user/employee in own client (optional branch filter), minus self
// branch_user  → active employees in own client+branch, minus self
// else → []
```

---

## 2. EDITING (PermissionMatrix)

```tsx
// every change funnels through emit() → withImpliedView(): any action true ⇒ can_view true
const withImpliedView = (m) => { for (leaf) if (anyActionOn(leaf)) leaf.can_view = true; return m; };

// View checkbox is locked when an action is on (and not a default module)
const lockedByAction = key === 'can_view' && anyActionOn && !is_default;   // checked + disabled

// grantableBy disables boxes you can't grant
const isPermAllowed = (slug, key) => grantableBy === null || !!grantableBy[slug]?.[key];
```
Columns: **All** + `can_view, can_add, can_edit, can_delete, can_export, can_import, can_approve`. `is_default` leaves render all-checked + disabled. `HIDDEN_SLUGS` (clients, plans, payments, settings, permissions, master.organization_types) are filtered out.

### Save payload (`extractLeafPermissions`)
```tsx
// leaf modules only; parents excluded; is_default forced all-true
[{ module_id, can_view, can_add, can_edit, can_delete, can_export, can_import, can_approve }]
// non-super granters AND each flag with myPerms[slug] before POST (defence-in-depth)
await api.post(`/permissions/user/${userId}`, { permissions });
```

---

## 3. SAVING (`PermissionController::savePermissions`, 128)

```php
$data = $request->validate([
  'permissions'=>'required|array',
  'permissions.*.module_id'=>'required|exists:modules,id',
  'permissions.*.can_view'=>'boolean', /* … all 7 booleans … */
]);

// ── grant-scope authorization (the cascade) ──
if ($auth->isSuperAdmin()) {
    if ($target->user_type !== 'client_admin') abort(403);
} elseif ($auth->isClientAdmin()) {
    // orphan adoption: adopt a client_id=null target (and its Employee) into the admin's tenant
    if ($target->client_id === null) { $target->update(['client_id'=>..., 'branch_id'=>...]); /* + Employee */ }
    $manageableTypes = ['branch_user'];
    if ($target->client_id !== $auth->client_id || !in_array($target->user_type,$manageableTypes) || $target->id===$auth->id) abort(403);
    $this->assertCanGrant($auth, $data);        // can't-grant-what-you-don't-have → 422
} elseif ($auth->isBranchUser()) {
    if (!($target->user_type==='employee' && $target->client_id===$auth->client_id && $target->branch_id===$auth->branch_id) || $target->id===$auth->id) abort(403);
    $this->assertCanGrant($auth, $data);        // → 422
} else abort(403);

// ── can't-grant-what-you-don't-have (assertCanGrant) ──
foreach ($data['permissions'] as $row) {
  foreach (ACTION_KEYS as $k) if ($row[$k]) {
    $mine = Permission::where('user_id',$auth->id)->where('module_id',$row['module_id'])->first();
    if (!$mine)        abort(422, 'You cannot grant a permission for a module you do not have.');
    if (!$mine->$k)    abort(422, "You cannot grant $k that you do not have.");
  }
}

// ── leaf-only ──
$parentIds = /* modules referenced as a parent */;   // skip these rows, count $skippedParents

// ── replace (NOT wrapped in a transaction) ──
DB::table('permissions')->where('user_id',$target->id)->delete();
foreach ($rows as $row) {
    // action-implies-view
    $view = $row['can_view'] || $row['can_add'] || $row['can_edit'] || $row['can_delete']
          || $row['can_export'] || $row['can_import'] || $row['can_approve'];
    if (!$view) continue;                                  // skip all-false rows
    DB::table('permissions')->insert([
        'user_id'=>$target->id, 'client_id'=>$target->client_id, 'branch_id'=>$target->branch_id,
        'role'=>$target->user_type, 'module_id'=>$row['module_id'],
        'can_view'=>true, 'can_add'=>$row['can_add'], /* … */ 'granted_by'=>$auth->id,
        'created_at'=>now(),'updated_at'=>now(),
    ]);
}

// ── downstream cascade (only super-admin editing a client-admin) ──
if ($auth->isSuperAdmin() && $target->user_type==='client_admin')
    $this->cascadeClearDownstream($target->id, $target->client_id);

return response()->json(['message'=>'...', 'saved_count'=>..., 'db_count'=>..., 'skipped_parent_modules'=>..., 'target_user_id'=>..., 'cascade_branch_users_updated'=>...]);
```

### 3.1 `cascadeClearDownstream()` (362)
```php
// for every branch_user AND employee under $clientId:
//   remove any flag the row has that the (post-save) admin no longer has;
//   if a row ends all-false → delete it.
// Keeps downstream grants from surviving an admin revoke (privilege-escalation guard).
```

---

## 4. HOW SAVED FLAGS GATE THE SPA

### 4.1 Login payload (`AuthController::formatUser`, ~592)
```php
// super_admin: skip (bypass). Others: build permissions keyed by module SLUG
$permissions[$module->slug] = [
  'can_view'=>..., 'can_add'=>..., /* … */ 'can_approve'=>...,
];
// returned as `permissions` on the auth user; refreshed by /me
```

### 4.2 Sidebar gate (`Sidebar.canView`, 82)
```tsx
if (isSuperAdmin) return /* all except non-whitelisted master.* */;
if (['dashboard','profile','my-plan'].includes(id)) return true;
if (['sales.','clm.','developers.'].some(p=>id.startsWith(p)) && (branch_user||employee)) return true; // temp rollout bypass
if (id==='permissions' && user_type==='branch_user') return true;
if (planBlocked) return false;
return !!perms[id]?.can_view;
```

### 4.3 Menu helper (`utils/menuAccess.ts moduleVisible`)
```tsx
moduleVisible(perms, slug, isSuperAdmin, planBlocked)
  = isSuperAdmin || (!planBlocked && (perms[slug]?.can_view || anyChild(perms, slug)?.can_view));
```

> Business API controllers are largely **not** flag-enforced — the map gates the SPA (menus/pages), not most endpoints. There is no `usePermissions`/`can()` helper and no route-level permission guard.

---

## 5. DEFAULTS ON USER CREATION

```php
// EmployeeController::grantSelfServicePermissions (1749) — baseline
foreach (['dashboard','profile'] as $slug)
    Permission::firstOrCreate(['user_id'=>..., 'module_id'=>...], ['can_view'=>true, /* actions false */, 'role'=>'employee']);

// OnboardingController::grantSelfServicePermissions (411) — wider baseline
// ['profile','dashboard','master.employees'] + every master.* the granting admin can view
```
Client-admin baseline permissions are seeded by **plan activation** (see the Plan/Payment modules), not here.

---

## 6. THE MODELS

```php
// Permission — 7 boolean flags, all cast to bool
public function user()   { return $this->belongsTo(User::class); }
public function module() { return $this->belongsTo(Module::class); }
public function grantedBy() { return $this->belongsTo(User::class, 'granted_by'); }

// Module — self-ref tree; leaves hold permissions
public function children() { return $this->hasMany(Module::class, 'parent_id')->orderBy('sort_order'); }
public function isParent(): bool { return $this->parent_id === null; }
```

---

## 7. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Grant cascade | `savePermissions` | Each tier grants only to the one below |
| Can't-grant-what-you-don't-have | `assertCanGrant` | Prevent privilege escalation |
| Action-implies-view | API + `withImpliedView` + backfill | No "edit but can't see" states |
| Leaf-only grants | `savePermissions` / `extractLeafPermissions` | Parents are grouping nodes |
| Full replace | delete-then-insert | Simple reconciliation (no unique needed) |
| Downstream cascade | `cascadeClearDownstream` | Revoking an admin trims their reports |
| Orphan adoption | `savePermissions` | Client-admin claims orphan users into their tenant |
| Login-payload gating | `formatUser` + Sidebar | Menus/pages driven by `can_view` |

---

## 8. NOTES & CAVEATS

- **Save is not transactional** — delete then insert run as separate statements.
- **No `UNIQUE(user_id, module_id)`** — uniqueness is procedural.
- **Most business APIs are not flag-enforced** — gating is SPA-side.
- **Temporary rollout bypasses** surface sales/clm/developers to branch_user/employee.
- **Super-admins bypass** permission checks entirely.
- **`GET /modules`** is served by `PermissionController`, not a ModuleController.
- **DB is PostgreSQL.**

---

*Related documents: PERMISSION_TECHNICAL_DOCUMENTATION.md · PERMISSION_FUNCTIONAL_DOCUMENTATION.md · PERMISSION_API_DOCUMENTATION.md*
