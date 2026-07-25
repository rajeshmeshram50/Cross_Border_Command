# MASTER DATA MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: dashboard counts → list/search → create (validate→scope→upload→sublist) → update (hierarchy + system lock) → delete (guards) → next-code → frontend. Files: `MasterController.php`, `MasterVisibility.php`, `MasterBundleCache.php`, `MasterPage.tsx`, `MasterDashboard.tsx`. Legend: `→` a call · `⇒` a return.

---

## 1. DASHBOARD COUNTS

### `MasterController::counts()`
```php
$user = $request->user() ?? abort(401);
$branchFilter = $request->integer('branch_id') ?: null;

// Non-super-admins: pre-load which master.<slug> modules they can view,
// so we only query allowed masters (others → zero card, never "loading").
if (!$user->isSuperAdmin()) {
    $allowedSlugs = DB::table('permissions')->join('modules',…)
        ->where('permissions.user_id',$user->id)->where('can_view',true)
        ->where('modules.slug','like','master.%')->pluck('modules.slug'); // strip 'master.'
}

foreach (self::MODELS as $slug => $modelClass) {
    if ($allowedSlugs !== null && !isset($allowedSlugs[$slug])) { $out[$slug]=zeros; continue; }
    try {
        $q = $modelClass::query(); $this->applyScope($q,$user,$branchFilter);
        // ONE SQL aggregate — never pull whole tables (states has 10k+ rows) — bug #16/#21
        $stat = $q->selectRaw("COUNT(*) total, SUM(CASE WHEN LOWER(TRIM(status))
                 IN ('active','1','true','yes','enabled') THEN 1 ELSE 0 END) active")->first();
        $out[$slug] = ['active'=>$active,'inactive'=>max(0,$total-$active),'total'=>$total];
    } catch (\Throwable $e) { $out[$slug]=zeros; }   // one bad model can't break the batch
}
⇒ response()->json($out);
```

---

## 2. LIST + SEARCH

### `MasterController::list()`
```php
$this->authorizeMaster($request,$slug,'can_view');      // per-master permission
$modelClass = $this->resolveModel($slug);               // MODELS[slug] or 404
$q = $modelClass::query()->with(self::OWNERSHIP_WITH)->orderByDesc('id');
if ($slug === 'state_codes') $q->with('state:id,name,country_id');   // inline state name
$this->applyScope($q,$request->user(),$request->integer('branch_id')?:null);  // MasterVisibility

if ($search = $request->query('search')) {              // ILIKE across text-type fields only
    $q->where(fn($w)=> collect($fields)->each(fn($f)=>
        in_array($f['t'],['text','email','textarea','select']) && $w->orWhere($f['n'],'ilike',"%$search%")));
}
if ($countryId = $request->integer('country_id'))       // cascade filter when the master has country_id
    $q->where('country_id',$countryId);

⇒ $q->get()->map(fn($r)=>$this->withOwnership($r));      // flatten client/branch/creator names
```

`withOwnership()` also embeds `banks` for LegalEntities and `in_use` for GstPercentage.

---

## 3. CREATE (the core write)

### `MasterController::store()`
```php
$this->authorizeMaster($request,$slug,'can_add');
if ($slug === 'address_types') return 403;              // fixed vocabulary — no adds even via Postman

$data = $this->validatePayload($request,$slug,null);    // §5 below
$data['created_by'] = $user->id;
[$clientId,$branchId] = $this->resolveOwnership($request,$user);  // server-truth tenant stamps
$data['client_id']=$clientId; $data['branch_id']=$branchId;

$data = $this->absorbUploads($request,$modelClass,$slug,$data);   // *_file → *_file_path
$row  = $modelClass::create($data);
$this->syncSublists($request,$slug,$row);               // legal_entities → banks
MasterBundleCache::bump();                               // refresh cached dropdowns
⇒ response()->json($this->withOwnership($row->load(OWNERSHIP_WITH)), 201);
```

### `resolveOwnership()` — who owns the row
```php
super_admin              → [request client_id, request branch_id]   // may seed globals
client_admin/client_user → [own client, null]                       // client-level
branch_user/employee     → [own client, own branch]                 // branch-scoped
```

### `absorbUploads()`
```php
foreach ($request->allFiles() as $key=>$file) {
    $targetCol = str_ends_with($key,'_file') ? $key.'_path' : $key;   // invoice_file → invoice_file_path
    if (!in_array($targetCol,$fillable)) continue;                    // ignore fields the model lacks
    if ($row && $row->$targetCol) Storage::disk('public')->delete($row->$targetCol); // drop stale on update
    $data[$targetCol] = $file->store("master/$slug",'public');
    unset($data[$key]);
}
```

### `syncSublists()` — legal_entities → banks
```php
$banks = $request->input('banks');
if (collect($banks)->filter(fn($b)=>!empty($b['bank_name']))->count()===0)
    throw ValidationException('Please add at least one bank account.');   // bug #9
foreach ($banks as $b) {
    // server-side format guards mirroring the UI (name charset, account 9-18, IFSC) — bugs #1-#7
    // upsert by id; true-sync: rows not in the incoming list are deleted
}
```

---

## 4. VALIDATION + UNIQUENESS

### `MasterController::validatePayload()`
```php
$schema = self::SCHEMAS[$slug]; $uFields=$schema['uFields']??[]; $uEach=$schema['uEach']??[];

// 1. Normalize (upper/lower) BEFORE validation so "us"/"US" can't bypass uniqueness
if ($f['normalize']) $request->merge([$f['n']=>strtoupper($val)]);

// 2. Determine the row's (client_id,branch_id) — existing row on update, resolveOwnership on create
[$tenantClientId,$tenantBranchId] = $id ? [existing…] : $this->resolveOwnership($request,$user);

// 3. Build Laravel rules per field
required|nullable · numeric(+min/max) · email · date · string(max maxLen|50) · integer(ref) · Rule::in(opts) · regex(pattern)
//   numeric/FK single uFields get an exact Rule::unique (tenant-scoped, ignore($id) on update)
$validated = $request->validate($rules,$messages);

// 4. Case-INSENSITIVE uniqueness for uEach + single text uFields (LOWER() — Rule::unique can't case-fold)
foreach ($caseInsensitiveCols as $col) {
    if ($modelClass::whereRaw('LOWER(%s)=LOWER(?)',[$col,$val])
          ->when($id, id!=)->where(client_id/branch_id tuple)->exists())
        throw ValidationException("This {$label} is already registered.");
    // system-seed collision — reject names matching a global is_system row
    if (Schema::hasColumn($table,'is_system') && sysQuery(client=null,branch=null,is_system=true,LOWER=)->exists())
        throw ValidationException("\"$value\" is a system-managed {$label} and cannot be re-created.");
}

// 5. Composite uFields — match the COMBINATION (text cols LOWER(), fk/number exact), tenant-scoped
if (count($uFields)>1 && $combinationExists) throw ValidationException('…combination … already exists.');

// 6. Empty string → NULL
⇒ $validated;
```

---

## 5. UPDATE

### `MasterController::update()`
```php
$this->authorizeMaster($request,$slug,'can_edit');
$row = $modelClass::query()->with(OWNERSHIP_WITH); $this->applyScope($q,$user); $q->findOrFail($id);

if ($msg = $this->hierarchicalDenial($user,$row,'edit')) return 403($msg);   // tier ladder
if ($row->is_system) return 403('This record is system-managed…');           // seeded rows fully locked

$data = $this->validatePayload($request,$slug,$id);
$data = $this->absorbUploads($request,$modelClass,$slug,$data,$row);          // deletes old file
$row->update($data);
$this->syncSublists($request,$slug,$row);
MasterBundleCache::bump();
⇒ $this->withOwnership($row->load(OWNERSHIP_WITH));
```

### `MasterVisibility::hierarchicalDenial()`
```php
if (!$user || super_admin) return null;
if ($row is Customer|Consignee) return null;                 // intentionally open
if ($row->created_by === $user->id) return null;             // own row always OK
if ($user is employee) return "employees can only manage rows they created themselves."; // peer-isolated
// Row tier from its OWN stamps (not creator's current type):
$rowTier = !client_id ? SUPER : (!branch_id ? CLIENT : BRANCH);
return $rowTier <= tierFor($user) ? null : "…created by {$rowLabel}.";
```

---

## 6. DELETE

### `MasterController::destroy()`
```php
$this->authorizeMaster($request,$slug,'can_delete');
$row = scoped findOrFail($id);
if ($msg = $this->hierarchicalDenial($user,$row,'delete')) return 403($msg);

// system-seed locks (per master)
if ($slug in [asset_categories,address_types,customer_types,risk_levels,customer_classifications] && $row->is_system)
    return 403('…system-managed and cannot be deleted.');

// referential guard — GST rate still used by products/HSN
if ($slug==='gst_percentage') {
    $hits = Product::where('gst_id',$row->id)->count() + HsnCodes::where('gst_rate_id',$row->id)->count();
    if ($hits) return 409('This GST rate is in use by … Reassign first.');   // QA #43/#44
}

$row->delete();                 // soft delete
MasterBundleCache::bump();
⇒ ['message'=>'Deleted'];
```

---

## 7. NEXT-CODE (auto numbering)

### `MasterController::nextCode()`
```php
$this->authorizeMaster($request,$slug,'can_view');
if (!isset(self::AUTO_CODES[$slug])) return ['code'=>null];   // only departments / expense_category
$cfg = self::AUTO_CODES[$slug];                               // e.g. ['col'=>'code','prefix'=>'DEPT-','pad'=>3]

$q = $modelClass::query(); $this->applyScope($q,$user,$branchFilter);  // SAME scope as list
$max = max( parse each code matching /^DEPT-(\d+)$/i );       // avoid colliding with a visible row
⇒ ['code'=>$prefix.str_pad($max+1,$pad,'0'), 'prefix'=>$prefix];
```
> `legal_entities` numbers differently — `entity_code` (`LE-0001`) is generated in the model's `creating` hook, not here.

---

## 8. FRONTEND

### `MasterDashboard.tsx`
```tsx
const counts = await api.get('/master-counts');    // one batch call
// render 10 category groups; each card shows counts[slug].active / .inactive; click → /masters/{slug}
```

### `MasterPage.tsx`
```tsx
const { slug } = useParams(); const cfg = getMasterConfig(slug);   // 56 configs
const fullSlug = `master.${cfg.slug}`;                             // perm key from /me
const rows = await api.get(masterEndpoint(cfg));                   // /master/{slug} (or override)
// pre-load referenced masters for dropdowns (ref/cascadeFrom)
// on form open: if field.autogenApi → api.get(`${base}/next-code`)
// validateForm mirrors server rules (pattern/uEach/uFields/min-max/maxLen)
await api.post(masterEndpoint(cfg), payload)   // or PUT /{id}, DELETE /{id}
```

---

## 9. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Schema-driven CRUD | MODELS + SCHEMAS | 56 masters, one controller |
| Server-truth tenancy | resolveOwnership | no cross-tenant spoofing |
| Creator-hierarchy scope | MasterVisibility.applyReadScope | who sees which rows |
| Tier mutate gate | hierarchicalDenial | descendants can't touch ancestor rows |
| Case-insensitive uniqueness | LOWER() checks | "India"/"india" collide |
| System-seed lock | is_system guards | protect referenced constants |
| Aggregate counts | counts() selectRaw | never load whole tables |
| Versioned cache | MasterBundleCache.bump | fresh dropdowns after writes |

---

## 10. NOTES & CAVEATS
- `organization_types` is registered in `MODELS` for counts only; full CRUD is `OrganizationTypeController` (super-admin).
- `address_types` is a fixed vocabulary — `store()` returns 403.
- Only text-type fields are searched; large geography tables rely on `country_id` cascade + aggregate counts.
- Uniqueness/uploads/sublists/auto-codes are all tenant-scoped to the row's own (client_id, branch_id).
- DB is PostgreSQL; deletes are soft (`deleted_at`) on masters using SoftDeletes.

---

*Related documents: MASTER_TECHNICAL_DOCUMENTATION.md · MASTER_FUNCTIONAL_DOCUMENTATION.md · MASTER_API_DOCUMENTATION.md*
