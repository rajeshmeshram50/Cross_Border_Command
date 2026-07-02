# PLAN MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Plans
> A guided, execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT
Follows plan catalogue CRUD, then how a plan gets assigned/activated to a client (module gating → permissions). Line numbers reference the live source and may drift. Legend: `→` a call · `⇒` a return.

Primary files: `PlanController.php`, `SubscriptionController.php`, `Plan.php`/`PlanModule.php`/`Module.php`, `Plans.tsx`, `AddPlan.tsx`.

---

## 1. LISTING PLANS

### 1.1 Frontend (`Plans.tsx`)
```tsx
const fetchPlans = async () => {
  const res = await api.get('/plans');            // list + clients_count + modules
  setPlans(res.data);
};
// delete:
await api.delete(`/plans/${id}`);
bustClientFormBundle();   // plans are bundled into /clients/form-bundle
```

### 1.2 Backend (`PlanController::index`, 21)
```php
$q = Plan::withCount('clients')->with(['modules:id,name,slug,icon'])->orderBy('sort_order');
if ($s = $request->query('search')) $q->where('name', 'ilike', "%$s%");   // Postgres
return response()->json($q->get());   // each plan carries clients_count + nested modules(+pivot)
```
> No tenant scoping — plans are global super-admin records.

---

## 2. CREATING A PLAN

### 2.1 Frontend (`AddPlan.tsx`)
```tsx
// module access state: { [moduleId]: 'not_included' | 'full' | 'limited' | 'addon' }
const cycleAccess = (id) => setModuleAccess(m => ({ ...m, [id]: NEXT[m[id]] }));  // Not Included→Full→Limited→Add-on
const payload = {
  ...form,                                   // numbers parsed, blanks → null
  modules: modules.map(m => ({ module_id: m.id, access_level: moduleAccess[m.id] })),
};
isEdit ? await api.put(`/plans/${editId}`, payload) : await api.post('/plans', payload);
bustClientFormBundle();
```

### 2.2 Backend (`PlanController::store`, 34) — annotated
```php
$data = $request->validate([
  'name'=>'required|string|max:100', 'price'=>'required|numeric|min:0',
  'period'=>'required|in:month,quarter,year',
  'max_branches'=>'nullable|integer|min:0', 'max_users'=>'nullable|integer|min:0',
  'storage_limit'=>'nullable|string|max:20', 'support_level'=>'nullable|string|max:50',
  'is_featured'=>'boolean', 'badge'=>'nullable|string|max:50', 'color'=>'nullable|string|max:7',
  'description'=>'nullable|string', 'best_for'=>'nullable|string|max:255',
  'status'=>'required|in:active,inactive', 'trial_days'=>'nullable|integer|min:0',
  'yearly_discount'=>'nullable|numeric|min:0|max:100', 'is_custom'=>'boolean',
  'modules'=>'nullable|array',
  'modules.*.module_id'=>'required|exists:modules,id',
  'modules.*.access_level'=>'required|in:full,limited,addon,not_included',
]);

$slug = $this->makeSlug($data['name']);
if ($slug === '' || Plan::where('slug', $slug)->exists())
    throw ValidationException::withMessages(['name' => 'A plan with a similar name already exists.']);

DB::transaction(function () use ($data, $slug) {
    $plan = Plan::create($data + ['slug' => $slug, 'sort_order' => (Plan::max('sort_order') ?? 0) + 1]);
    foreach ($data['modules'] ?? [] as $m) {
        if ($m['access_level'] === 'not_included') continue;      // never persisted
        PlanModule::create(['plan_id'=>$plan->id, 'module_id'=>$m['module_id'],
                            'access_level'=>$m['access_level']]);
    }
});
MasterBundleCache::bump();     // refresh cached client-form dropdown
return response()->json(['message'=>'Plan created successfully', 'plan'=>$plan->load('modules')], 201);
// UniqueConstraintViolationException → 422 name error (race guard)
```

### 2.3 Update (`PlanController::update`, 131)
```php
// same validation; slug recomputed + uniqueness (excluding own id) checked...
// ...but the UPDATE PAYLOAD DOES NOT INCLUDE slug → slug never changes on rename
DB::transaction(function () use ($plan, $data) {
    $plan->update([... all fields EXCEPT slug ...]);
    PlanModule::where('plan_id', $plan->id)->delete();           // replace module set
    foreach ($data['modules'] ?? [] as $m) {
        if ($m['access_level'] === 'not_included') continue;
        PlanModule::create([...]);
    }
});
MasterBundleCache::bump();
```

### 2.4 Delete (`PlanController::destroy`, 208)
```php
if ($plan->clients()->exists())
    return response()->json(['message' => 'Cannot delete plan with active clients. Reassign clients first.'], 422);
DB::transaction(function () use ($plan) {
    PlanModule::where('plan_id', $plan->id)->delete();
    $plan->delete();      // HARD delete (Plan has no SoftDeletes)
});
MasterBundleCache::bump();
```

---

## 3. ASSIGNING A PLAN TO A CLIENT (module gating → permissions)

This happens in the Payment module's `SubscriptionController`, but it is the payoff of the whole Plan module.

### 3.1 `SubscriptionController::activatePlan()` (325)
```php
DB::transaction(function () use ($payment, $plan, $client, $user) {
    $payment->update(['status' => 'success']);
    $client->update(['plan_id'=>$plan->id, 'plan_type'=>'paid', 'status'=>'active',
                     'plan_expires_at'=>$payment->valid_until]);

    // ── module gating → permissions ──
    Permission::where('user_id', $user->id)->delete();
    foreach (Module::where('is_active', true)->get() as $module) {
        $pm = $plan->planModules->firstWhere('module_id', $module->id);
        $included = $pm && in_array($pm->access_level, ['full','limited']);
        if (!$included && !$module->is_default) continue;          // module NOT in this plan → skip
        $full = ($pm && $pm->access_level === 'full') || $module->is_default;
        DB::table('permissions')->insert([
            'user_id'=>$user->id, 'client_id'=>$client->id, 'module_id'=>$module->id,
            'can_view'=>true,                       // always for included/default
            'can_add'=>$full, 'can_edit'=>$full,
            'can_delete'=>$full, 'can_export'=>$full, 'can_import'=>$full, 'can_approve'=>$full,
        ]);
    }
    $this->cascadePruneDownstreamPermissions($client->id, $user->id);   // strip flags admin lost
    $this->enforceBranchLimit($client, $plan, $kept);                    // deactivate branches over plan.max_branches
});
```
> This is where a plan's `access_level` map turns into concrete permission rows. `is_default` modules are always granted.

---

## 4. MODULE ACCESS SELECTOR (frontend cycle)

`AddPlan.tsx` renders a searchable tile grid; each tile cycles through:
```
CYCLE_ORDER = ['not_included', 'full', 'limited', 'addon']   // click advances one step
```
Bulk: **All Full** (all → `full`), **Clear** (all → `not_included`). `includedCount` = tiles where access ≠ `not_included`. On save every module is sent (including `not_included`); the backend drops the `not_included` rows.

---

## 5. THE MODELS

```php
// Plan
public function planModules() { return $this->hasMany(PlanModule::class); }
public function modules()     { return $this->belongsToMany(Module::class, 'plan_modules')
                                    ->withPivot('access_level','usage_limit','notes'); }
public function isFree(): bool { return $this->price <= 0; }

// PlanModule (pivot model)
public function plan()   { return $this->belongsTo(Plan::class); }
public function module() { return $this->belongsTo(Module::class); }

// Module (self-ref tree)
public function children() { return $this->hasMany(Module::class, 'parent_id')->orderBy('sort_order'); }
public function isParent(): bool { return $this->parent_id === null; }
```

---

## 6. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Replace-on-update for pivot | `update()` | Simplest way to reconcile plan_modules |
| Drop `not_included` | store/update | Only real grants are stored |
| Cache bump | plan CRUD | Plans feed the cached client-form bundle |
| Delete guard | `destroy()` | Protect clients on the plan |
| Module gating → permissions | `activatePlan()` | A plan's access map becomes permission rows |
| `is_default` always granted | activation | Baseline modules (Dashboard/Profile/Developers) |

---

## 7. NOTES & CAVEATS

- **`update` never rewrites `slug`** — a renamed plan keeps its old slug.
- **`not_included` rows are never persisted.**
- **Hard delete**, blocked while clients reference the plan (422).
- **`period` is the billing cycle**; pricing multipliers live in `SubscriptionController::computePricing`.
- **Free-plan activation** still sets `client.plan_type='paid'`.
- **DB is PostgreSQL** — search uses `ilike`; `plan_modules` has a `UNIQUE(plan_id, module_id)`.

---

*Related documents: PLAN_TECHNICAL_DOCUMENTATION.md · PLAN_FUNCTIONAL_DOCUMENTATION.md · PLAN_API_DOCUMENTATION.md*
