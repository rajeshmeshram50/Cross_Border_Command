# BRANCH MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Branch
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT

This walkthrough follows the Branch lifecycle **in execution order**, showing the real method chain per step. Line numbers reference `BranchController.php` (~773 lines) and may drift; method names are stable. Legend: `→` a call · `⇒` a return.

Primary files:
- `app/Http/Controllers/Api/BranchController.php`
- `app/Models/Branch.php`, `User.php`
- `app/Support/MasterVisibility.php`
- `resources/js/pages/branch/*`, `resources/js/contexts/BranchSwitcherContext.tsx`, `resources/js/api.ts`

---

## 1. LISTING BRANCHES

### 1.1 Frontend: `Branches.tsx`
```tsx
const fetchBranches = useCallback(async () => {
  const res = await api.get('/branches', { params: { per_page: 9999 } });  // all; client-side paginate
  setBranches(res.data.data);
}, []);
// warm the form-bundle cache during idle time (Add Branch feels instant)
requestIdleCallback(() => api.get('/branches/form-bundle').then(b => writeBranchFormBundle(b)));
```
Search filters client-side over name/code/type/industry/city/state/contact/email/phone. Export builds an XLSX including all letterhead fields.

### 1.2 Backend: `BranchController::index()` (29-86)
```php
public function index(Request $request)
{
    $user = $request->user();
    $clientId = $user->client_id;
    if (!$clientId && !$user->isSuperAdmin())
        return response()->json(['data' => [], 'total' => 0]);   // no tenant → empty

    $q = Branch::query()->withCount('users')->withCount('departments');
    if ($clientId) $q->where('client_id', $clientId);
    elseif ($request->filled('client_id')) $q->where('client_id', $request->integer('client_id'));  // super-admin

    // Hide the Head Office branch unless asked
    if (!$request->boolean('include_head_office'))
        $q->where(fn($w) => $w->where('code', '!=', 'HO')
                              ->orWhere('name', 'not ilike', '% — Head Office'));

    if ($s = $request->query('search'))
        $q->where(fn($w) => $w->where('name','ilike',"%$s%")->orWhere('code','ilike',"%$s%")
                              ->orWhere('city','ilike',"%$s%")->orWhere('industry','ilike',"%$s%"));
    if ($st = $request->query('status')) $q->where('status', $st);
    if ($t  = $request->query('type'))   $q->where('branch_type', $t);

    // The BranchSwitcher's injected branch_id — honoured only after ownership check
    if ($bid = $request->integer('branch_id')) {
        $owned = Branch::where('id',$bid)->where('client_id',$clientId)->exists();
        if ($owned || $user->isSuperAdmin()) $q->where('id', $bid);
    }
    return response()->json($q->orderBy('name')->paginate($request->integer('per_page', 15)));
}
```
> `index()` is the **only** method that honours the switcher's `branch_id`. Each row carries `users_count`, `departments_count`, and the appended `logo_url` / `profile_photo_url` / `signature_url`.

---

## 2. LOADING THE FORM

### 2.1 `formBundle()` (738-772)
```php
$key = MasterBundleCache::key('branch:form-bundle', $request->user()->id);
$data = Cache::remember($key, now()->addMinutes(5), function () use ($request) {
    return [
        'countries' => /* Countries, active */,
        'states'    => /* States, active, MasterVisibility::applyReadScope */,
    ];
});
$data['next_code'] = $this->peekNextBranchCode($clientId);   // NOT cached — always fresh
$data['prefix']    = 'BR-';
return response()->json($data);
```
The frontend reads a sessionStorage cache first (`branch:form-bundle:v2`, 5-min) for countries/states, and always uses the fresh `next_code` to pre-fill the read-only Branch Code.

---

## 3. CREATING A BRANCH (branch + branch-user)

### 3.1 Frontend submit (`BranchForm.tsx`)
```tsx
// JSON unless a file is attached; then multipart
const hasFiles = logoFile || profilePhotoFile || signatureFile;
if (hasFiles) await api.post('/branches', fd);              // fields: logo, profile_photo, signature_path
else          await api.post('/branches', jsonPayload);
if (createRes.data.mail_warning) toast.warning(createRes.data.mail_warning);
```

### 3.2 Backend: `BranchController::store()` (88-342) — annotated
```php
public function store(Request $request)
{
    $user = $request->user();
    $clientId = $user->client_id;
    if (!$clientId)
        return response()->json(['message' => 'Only client admins can create branches'], 403);

    // ── Plan gate: plan.max_branches ──
    $client = Client::with('plan')->find($clientId);
    $limit  = (int) ($client->plan->max_branches ?? 0);
    if ($limit > 0 && Branch::where('client_id',$clientId)->count() >= $limit)
        return response()->json(['message' => "Branch limit ($limit) reached. Upgrade your plan."], 422);

    $this->normalizeGstPanInput($request);                 // upper GST/PAN
    $data = $request->validate([ /* full rule set — see API/Technical docs */ ]);

    return DB::transaction(function () use ($request, $data, $clientId, $user) {
        // race-safe BR-### allocation (row lock)
        $code = $request->filled('code') ? $request->code : $this->allocateBranchCode($clientId);

        $branch = Branch::create($data + [
            'client_id'  => $clientId,
            'code'       => $code,
            'country'    => $data['country'] ?? 'India',
            'max_users'  => $data['max_users'] ?? 0,
            'created_by' => $user->id,
        ]);

        // uploads → public disk (relative path); logo → dark variant
        if ($request->hasFile('logo')) {
            $branch->logo = $request->file('logo')->store('branches/logos', 'public');
            LogoDarkVariantGenerator::generate($branch->logo);
        }
        if ($request->hasFile('profile_photo'))  $branch->profile_photo  = $request->file('profile_photo')->store('branches/profile-photos', 'public');
        if ($request->hasFile('signature_path')) $branch->signature_path = $request->file('signature_path')->store('branches/signatures', 'public');
        $branch->save();

        // ── branch-user with DUAL password storage ──
        $branchUser = User::create([
            'client_id' => $clientId,
            'branch_id' => $branch->id,
            'user_type' => 'branch_user',
            'name'      => $data['user_name'],
            'email'     => $data['user_email'],
            'password'            => Hash::make($request->user_password),           // bcrypt
            'password_encrypted'  => Crypt::encryptString($request->user_password), // reversible
            'status'    => $data['user_status'] ?? 'active',
        ]);

        // welcome email (non-fatal → mail_warning)
        $mailWarning = null;
        if (Settings::shouldSendMail('newUser')) {
            try { Mail::to($branchUser->email)->cc(...)->send(new WelcomeCredentialsMail(...)); }
            catch (\Throwable $e) { Log::warning(...); $mailWarning = 'Branch created, but the welcome email could not be sent.'; }
        }

        return response()->json([
            'message'     => 'Branch created successfully',
            'branch'      => $branch,
            'branch_user' => ['id'=>$branchUser->id,'name'=>$branchUser->name,'email'=>$branchUser->email,
                              'user_type'=>$branchUser->user_type,'status'=>$branchUser->status],
            'mail_warning'=> $mailWarning,
        ], 201);
    });
    // QueryException (23505 users_email_unique) → 422 on user_email
}
```

### 3.3 Race-safe code allocation
```php
private function allocateBranchCode(int $clientId): string {
    return DB::transaction(function () use ($clientId) {
        Branch::withTrashed()->where('client_id',$clientId)->lockForUpdate()->get(); // serialise
        return $this->buildNextBranchCode($clientId);          // BR- + zeroPad(max+1, 3)
    });
}
// buildNextBranchCode scans codes matching /^BR-(\d+)$/i, ignores legacy (HO, manual) codes
```

---

## 4. VIEWING A BRANCH (password disclosure)

### `BranchController::show()` (344-385)
```php
public function show(Branch $branch, Request $request)
{
    $user = $request->user();
    if ($user->client_id && $branch->client_id !== $user->client_id)
        return response()->json(['message' => 'Unauthorized'], 403);   // tenant ownership

    $branch->loadCount('users')->loadCount('departments');
    $branchUser = User::where('branch_id',$branch->id)->where('user_type','branch_user')->first();

    $payload = $branchUser ? [
        'id'=>..., 'name'=>..., 'email'=>..., 'phone'=>..., 'designation'=>..., 'status'=>...,
    ] : null;

    // password_plain → super-admin OR the owning client-admin only
    $canSeePw = $user->isSuperAdmin()
             || ($user->user_type === 'client_admin' && $branch->client_id === $user->client_id);
    if ($canSeePw && $branchUser?->password_encrypted) {
        try { $payload['password_plain'] = Crypt::decryptString($branchUser->password_encrypted); }
        catch (\Throwable $e) { $payload['password_plain'] = null; }   // rotated APP_KEY
    }
    return response()->json(['branch' => $branch, 'branch_user' => $payload]);
}
```
`BranchForm.tsx` uses `password_plain` on edit to pre-fill and reveal the branch-user password.

---

## 5. UPDATING A BRANCH (status cascades)

### `BranchController::update()` (387-614)
```php
public function update(Request $request, Branch $branch)
{
    if ($user->client_id && $branch->client_id !== $user->client_id)
        return response()->json(['message' => 'Unauthorized'], 403);

    $this->normalizeGstPanInput($request);
    $data = $request->validate([ /* same rules; name-unique only if changed; user_* nullable */ ]);

    return DB::transaction(function () use ($request, $branch, $data) {
        $wasActive = $branch->status === 'active';
        $branch->update($data /* whitelisted */);

        // ── status transitions ──
        if ($wasActive && $branch->status === 'inactive') {           // deactivate
            $this->revokeAllUserTokensForBranch($branch->id);
            User::where('branch_id',$branch->id)->delete();           // soft-delete users
            Employee::where('branch_id',$branch->id)->delete();       // soft-delete employees
        }
        if (!$wasActive && $branch->status === 'active') {            // reactivate (conservative restore)
            User::withTrashed()->where('branch_id',$branch->id)->restore();
            Employee::withTrashed()->where('branch_id',$branch->id)->restore();
        }

        // file replacement (delete old via relativePath()), logo dark-variant regen …

        // branch-user update only when user_name supplied
        if ($request->filled('user_name')) {
            $bu = User::where('branch_id',$branch->id)->where('user_type','branch_user')->first();
            $fields = array_filter([...], fn($v) => !is_null($v));
            if ($request->filled('user_password')) {
                $fields['password']           = Hash::make($request->user_password);
                $fields['password_encrypted'] = Crypt::encryptString($request->user_password);
                if (Settings::shouldSendMail())
                    Mail::to($bu->email)->send(new PasswordChangedMail($branch, $bu, $request->user_password, BrandingResolver::forUser($bu)));
            }
            $bu?->update($fields);
        }
        return response()->json(['message' => 'Branch updated successfully', 'branch' => $branch->fresh()]);
    });
}
```

### `revokeAllUserTokensForBranch()` (670-679)
```php
DB::table('personal_access_tokens')
    ->where('tokenable_type', User::class)
    ->whereIn('tokenable_id', User::where('branch_id', $branchId)->pluck('id'))
    ->delete();   // every branch user logged out
```

---

## 6. "DELETING" A BRANCH = DEACTIVATE

### `BranchController::destroy()` (635-667)
```php
public function destroy(Branch $branch, Request $request)
{
    if ($user->client_id && $branch->client_id !== $user->client_id)
        return response()->json(['message' => 'Unauthorized'], 403);

    DB::transaction(function () use ($branch) {
        $this->revokeAllUserTokensForBranch($branch->id);        // logout
        $branch->users()->delete();                              // soft-delete users
        Employee::where('branch_id', $branch->id)->delete();     // soft-delete employees
        $branch->status = 'inactive';
        $branch->save();                                         // branch ROW kept (not soft-deleted)
    });
    return response()->json(['message' => 'Branch deactivated successfully']);
}
```
> Unlike Client `destroy` (which soft-deletes the client), Branch `destroy` **keeps the branch row** and only flips it to `inactive` — preserving historical FKs. Reactivate by editing status → active.

---

## 7. PASSWORD STORAGE (reversible — CRITICAL)

The branch-user password is stored **twice** on the `users` row:
```php
'password'           => Hash::make($plain),           // bcrypt — used for login
'password_encrypted' => Crypt::encryptString($plain), // reversible (AES via APP_KEY)
```
`show()` returns `password_plain` (decrypted) **only** to a super-admin or the owning client-admin (§4). `WelcomeCredentialsMail` and `PasswordChangedMail` carry the plaintext. The `User` model `$hidden` prevents accidental serialization; the controller deliberately bypasses it for the allowed roles. Anyone with DB + `APP_KEY` can decrypt — a known security surface.

---

## 8. THE MODEL LAYER (`app/Models/Branch.php`)

```php
class Branch extends Model {
    use SoftDeletes;
    protected $appends = ['logo_url', 'profile_photo_url', 'signature_url'];
    protected function casts(): array { return ['max_users' => 'integer', 'established_at' => 'date']; }
    public function getSignatureUrlAttribute() { return file_url($this->signature_path); } // signed PDFs
    // client() createdBy() users() employees() departments() permissions() approvalQueue() activityLogs()
    public function isActive(): bool { return $this->status === 'active'; }
}
```
No `$hidden`, no boot logic, no scopes. 38 fillable fields (all letterhead + branding + ops). `is_main` was dropped (2026-06-20) and is not fillable.

---

## 9. SCOPING & THE BRANCH SWITCHER

### 9.1 `MasterVisibility::applyReadScope()` — branch_user
```php
// globals OR (own client AND (client-level rows OR own branch))
$q->where(fn($w) => $w->whereNull('client_id')
    ->orWhere(fn($x) => $x->where('client_id', $user->client_id)
        ->where(fn($y) => $y->whereNull('branch_id')->orWhere('branch_id', $user->branch_id))));
// sibling branches hidden; the switcher branchFilter is IGNORED for branch users
```

### 9.2 `BranchSwitcherContext.tsx`
```tsx
canSwitch = (user.user_type === 'client_admin');            // only client-admins switch
// list branches for the dropdown
const res = await api.get('/branches', { params: { per_page: 100 }, signal });
// persist active branch per user; branch_user is hard-pinned to user.branch_id
localStorage.setItem(`cbc_selected_branch_id_${user.id}`, String(id ?? ''));
setBranch = (id) => { /* validate ∈ branches, persist, then */ window.location.reload(); };
```

### 9.3 `api.ts` auto-injection
```tsx
// On GET (except /branches, /me, auth endpoints), if a positive active branch is stored,
// append ?branch_id=<id> unless the caller already set it. Opt out with branch_id: ''.
```

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Provisioning transaction | `store()` | Branch + branch-user created atomically |
| Race-safe code allocation | `allocateBranchCode()` | Unique `BR-###` under concurrency |
| Plan gating | `store()` | Enforce `plan.max_branches` |
| In-method tenant ownership | all mutating methods | `branch.client_id === user.client_id` |
| Dual password storage | `store()`/`update()` | bcrypt for auth + reversible mirror for admin recall |
| Deactivate-not-delete | `destroy()` / `update()` | Preserve historical FKs; cascade hide/restore |
| Token revocation | deactivate paths | Log out a branch on deactivation |
| URL accessors | `Branch` model | Resolve relative disk paths → full URLs |
| Peer isolation | `MasterVisibility` | Branch users never see sibling branches |

---

## 11. NOTES & CAVEATS

- **`index()` alone** honours the switcher's `branch_id`; `show/update/destroy` bind by URL and enforce ownership.
- **Delete = deactivate** — the branch row is never removed.
- **`is_main` dropped** (2026-06-20) — no privileged branch; peers are isolated.
- **`code` is not unique** at the DB level (uniqueness relies on the allocator).
- **`max_users`** is stored but not enforced by this controller (only `plan.max_branches` at create).
- **`BrandingResolver`** lives in `app/Support/` (not `app/Services/`).
- **DB is PostgreSQL** — `ilike` search + partial-unique per-tenant email index are Postgres-specific.

---

*Related documents: BRANCH_TECHNICAL_DOCUMENTATION.md · BRANCH_FUNCTIONAL_DOCUMENTATION.md · BRANCH_API_DOCUMENTATION.md*
