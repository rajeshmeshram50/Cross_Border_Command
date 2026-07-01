# CLIENT MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Client
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT

This walkthrough follows the Client lifecycle **in execution order**, showing the actual method chain per step. Line numbers reference the live source (`ClientController.php`, ~785 lines) and may drift; method names are stable. Legend: `→` a call · `⇒` a return.

Primary files:
- `app/Http/Controllers/Api/ClientController.php` (HTTP layer)
- `app/Models/Client.php`, `Branch.php`, `User.php`, `ClientSetting.php`
- `resources/js/pages/client/*` (SPA)

---

## 1. LISTING CLIENTS

### 1.1 Frontend: `Clients.tsx`

```tsx
// One call fetches the full list + KPI stats; react-table paginates client-side.
const fetchClients = async () => {
  const res = await api.get('/clients', { params: { search, per_page: 9999, include_stats: 1 } });
  setClients(res.data.data);
  if (res.data.stats) setStats(res.data.stats);
};
// Warm the form-bundle cache during idle time (create flow feels instant)
requestIdleCallback(() => api.get('/clients/form-bundle').then(writeClientFormBundle));
```
Search is debounced 400 ms. Export re-fetches `per_page=9999` and builds an XLSX with `xlsx` + `file-saver`.

### 1.2 Backend: `ClientController::index()` (29)

```php
public function index(Request $request)
{
    $q = Client::query()->with(['plan', 'createdBy'])
        ->withCount([
            'branches as branches_count' => fn($b) => $b->where('code', '!=', 'HO'),
            'users',
        ]);

    if ($s = $request->query('search')) {
        $q->where(fn($w) => $w->where('org_name', 'ilike', "%$s%")
                              ->orWhere('unique_number', 'ilike', "%$s%")
                              ->orWhere('email', 'ilike', "%$s%"));
    }
    if ($st = $request->query('status')) $q->where('status', $st);

    $clients = $q->orderByDesc('created_at')->paginate($request->integer('per_page', 15));

    if ($request->boolean('include_stats')) {
        $arr = $clients->toArray();
        $arr['stats'] = $this->computeStats();     // shared with stats()
        return response()->json($arr);
    }
    return response()->json($clients);
}
```
> No `client_id` scoping — this returns **all** clients (super-admin console). `branches_count` excludes the auto-created `HO` branch so the UI shows "real" branches.

### 1.3 `computeStats()` (77)
Totals by status + a left join to `plans` grouped for the donut (`plan_breakdown`, null plan labelled `Free`).

---

## 2. LOADING THE FORM

### 2.1 `formBundle()` (739)

```php
public function formBundle(Request $request)
{
    $key = MasterBundleCache::key('client:form-bundle', $request->user()->id);
    return Cache::remember($key, now()->addMinutes(5), function () use ($request) {
        return [
            'organization_types' => /* MasterVisibility::applyReadScope(...)->active */,
            'plans'              => /* active plans */,
            'countries'          => /* active countries */,
            // states intentionally excluded — fetched lazily per country
        ];
    });
}
```
The frontend (`ClientForm.tsx`) reads a sessionStorage cache first (`client:form-bundle:v3`, 5-min TTL) before calling this, and fetches states lazily via `GET /master/states?country_id=` with an AbortController.

---

## 3. CREATING A CLIENT (the provisioning transaction)

### 3.1 Frontend submit (`ClientForm.tsx`)
Create is **always multipart**:
```tsx
const fd = new FormData();
// ...append all fields + logo/favicon/profile_photo...
await api.post('/clients', fd);   // 201 → toast → setTimeout(onBack, 1200)
// 422 → serverErrors keyed by field
```

### 3.2 Backend: `ClientController::store()` (108) — annotated

```php
public function store(Request $request)
{
    $this->normalizeGstPanInput($request);     // upper GST/PAN, lower emails, strip phone digits
    $data = $request->validate([ /* full rule set — see API/Technical docs */ ]);

    return DB::transaction(function () use ($request, $data) {
        // 1. unique number: EA + first 2 chars of org name + timestamp
        $unique = 'EA' . strtoupper(substr($data['org_name'], 0, 2)) . now()->format('ymdHis');

        // 2. create the Client — plan_type FORCED to 'free'
        $client = Client::create($data + [
            'unique_number' => $unique,
            'plan_type'     => 'free',                        // paid only via billing
            'status'        => $data['status'] ?? 'inactive',
            'primary_color'   => $data['primary_color']   ?? '#4F46E5',
            'secondary_color' => $data['secondary_color'] ?? '#10B981',
            'created_by'    => $request->user()->id,
        ]);

        // 3. branding files → public disk; logo → dark-mode variant
        if ($request->hasFile('logo')) {
            $client->logo = $request->file('logo')->store('clients/logos', 'public');
            LogoDarkVariantGenerator::generate($client->logo);
        }
        // (favicon → clients/favicons, profile_photo → clients/profile-photos)
        $client->save();

        // 4. default Head Office branch
        $branch = Branch::create([
            'client_id' => $client->id,
            'name'      => $client->org_name . ' — Head Office',
            'code'      => 'HO',
            'status'    => 'active',
            'created_by'=> $request->user()->id,
        ]);

        // 5. client-admin user — DUAL password storage
        $admin = User::create([
            'client_id'  => $client->id,
            'branch_id'  => $branch->id,
            'user_type'  => 'client_admin',
            'name'       => $data['admin_name'],
            'email'      => $data['admin_email'],
            'password'            => Hash::make($request->admin_password),          // bcrypt (auth)
            'password_encrypted'  => Crypt::encryptString($request->admin_password),// reversible mirror
            'status'     => $data['admin_status'] ?? 'active',
        ]);

        // 6. welcome email with the PLAINTEXT password (best-effort)
        if (Settings::shouldSendMail('newUser')) {
            try { Mail::to(...)->send(new WelcomeCredentialsMail($client, $admin, $request->admin_password)); }
            catch (\Throwable $e) { Log::warning(...); }   // never fails the request
        }

        return response()->json([
            'message'    => 'Client created successfully',
            'client'     => $client->load('plan','createdBy')->loadCount([...]),
            'admin_user' => ['id'=>$admin->id,'name'=>$admin->name,'email'=>$admin->email,
                             'user_type'=>$admin->user_type,'status'=>$admin->status],
        ], 201);
    });
}
```

Key points:
- **One transaction** creates client + HO branch + admin — a failure rolls all back.
- **`plan_type` is forced to `free`**; a `paid` value is ignored.
- The admin password is stored **twice** (bcrypt + reversible Crypt) — see §7.

### 3.3 `normalizeGstPanInput()` (659)
Runs `$request->merge([...])` **before** validation: uppercases `gst_number`/`pan_number`, lowercases+trims `email`/`admin_email`, strips non-digits from `phone`/`admin_phone`.

---

## 4. VIEWING A CLIENT (password disclosure)

### 4.1 `ClientController::show()` (349)

```php
public function show(Client $client)          // route-model binding
{
    $client->load('plan', 'createdBy')->loadCount([...]);
    $admin = User::where('client_id', $client->id)->where('user_type', 'client_admin')->first();

    $adminPayload = $admin ? [
        'id'=>$admin->id, 'name'=>$admin->name, 'email'=>$admin->email,
        'phone'=>$admin->phone, 'designation'=>$admin->designation, 'status'=>$admin->status,
    ] : null;

    // ── Password disclosure: super-admin only ──
    $isSuperAdmin = optional(request()->user())->user_type === 'super_admin';
    if ($isSuperAdmin && $admin?->password_encrypted) {
        try { $adminPayload['password_plain'] = Crypt::decryptString($admin->password_encrypted); }
        catch (\Throwable $e) { $adminPayload['password_plain'] = null; }   // rotated APP_KEY
    }

    // admin permissions + states for the client's country
    $permissions = $admin ? Permission::where('user_id',$admin->id)->with('module:id,name,slug,icon')->get() : [];
    $states = /* resolve country name → id → states (try/catch) */;

    return response()->json([
        'client' => $client, 'admin_user' => $adminPayload,
        'admin_permissions' => $permissions, 'states' => $states,
    ]);
}
```
> The `super_admin` check only controls whether `password_plain` is returned — it is **not** an access gate. Non-super-admins still receive the rest of the payload. `ClientForm.tsx` uses `password_plain` to pre-fill and auto-reveal the password on edit.

---

## 5. UPDATING A CLIENT

### 5.1 Frontend (`ClientForm.tsx`)
```tsx
// JSON when no new files; multipart with _method=PUT when files change
if (hasNewFiles) await api.post(`/clients/${editId}?_method=PUT`, fd);
else             await api.put(`/clients/${editId}`, jsonPayload);
// If the admin password is unchanged, null the password fields (skip re-hash + email)
if (form.admin_password === originalAdminPassword) payload.admin_password = null;
```

### 5.2 Backend: `ClientController::update()` (436)

```php
public function update(Request $request, Client $client)
{
    $this->normalizeGstPanInput($request);
    $data = $request->validate([ /* same rules, uniqueness ->ignore($client->id) */ ]);

    return DB::transaction(function () use ($request, $client, $data) {
        $wasActive = $client->status === 'active';

        // whitelist mass-assign; block free→paid escalation
        $payload = /* whitelisted subset of $data */;
        if (($payload['plan_type'] ?? null) === 'paid' && $client->plan_type !== 'paid')
            unset($payload['plan_type']);                     // escalation dropped

        // branding replacement (delete old files via relativePath())
        // ...

        $client->update($payload);

        // status active → non-active revokes all the client's tokens
        if ($wasActive && $client->status !== 'active')
            $this->revokeAllUserTokensForClient($client->id);

        // update the admin ONLY when admin_name is present
        if ($request->filled('admin_name')) {
            $admin = User::where('client_id',$client->id)->where('user_type','client_admin')->first();
            $fields = array_filter([...], fn($v) => !is_null($v));
            if ($request->filled('admin_password')) {
                $fields['password']           = Hash::make($request->admin_password);
                $fields['password_encrypted'] = Crypt::encryptString($request->admin_password);
                if (Settings::shouldSendMail())
                    Mail::to($admin->email)->send(new PasswordChangedMail($client, $admin, $request->admin_password));
            }
            $admin?->update($fields);
        }

        return response()->json(['message'=>'Client updated successfully','client'=>$client->fresh()->load(...)]);
    });
}
```

### 5.3 `revokeAllUserTokensForClient()` (694)
```php
DB::table('personal_access_tokens')
    ->where('tokenable_type', User::class)
    ->whereIn('tokenable_id', User::where('client_id', $clientId)->pluck('id'))
    ->delete();     // every user of the client is logged out
```

---

## 6. DELETING A CLIENT (soft cascade)

### `ClientController::destroy()` (628)
```php
public function destroy(Client $client)
{
    DB::transaction(function () use ($client) {
        $this->revokeAllUserTokensForClient($client->id);   // 1. logout everyone
        User::where('client_id', $client->id)->delete();     // 2. soft-delete users
        Branch::where('client_id', $client->id)->delete();   // 3. soft-delete branches
        $client->delete();                                   // 4. soft-delete client
    });
    return response()->json(['message' => 'Client deleted successfully']);
}
```
All four steps are **soft deletes** (models use `SoftDeletes`) — recoverable, not destructive.

---

## 7. PASSWORD STORAGE (reversible — CRITICAL)

The Crypt-encrypted password lives on the **client-admin `User`** row, not on `Client`.

**Write (create & update):**
```php
'password'           => Hash::make($plain),           // bcrypt — used for login
'password_encrypted' => Crypt::encryptString($plain), // reversible (AES via APP_KEY)
```
Column added by `2026_05_15_170000_add_admin_password_plain_to_users.php` (`password_encrypted` text nullable). Its docblock warns: *anyone with DB + APP_KEY access can decrypt.*

**Read-back:** `show()` decrypts to `admin_user.password_plain` **for super-admins only** (§4). The `User` model `$hidden` lists both `password` and `password_encrypted`, so normal serialization never leaks them; the controller deliberately bypasses this into a separate key.

**Email:** `WelcomeCredentialsMail` (create) and `PasswordChangedMail` (update) both carry the plaintext password.

> This is the documented reversible-password pattern for the client-admin. Treat it as a known security surface.

---

## 8. THE MODEL LAYER

### 8.1 `Client` (`app/Models/Client.php`)
```php
class Client extends Model {
    use SoftDeletes;
    protected $appends = ['logo_url', 'favicon_url', 'profile_photo_url'];
    protected function casts(): array { return ['plan_expires_at' => 'date']; }
    public function getLogoUrlAttribute()         { return file_url($this->logo); }
    // branches() users() plan() createdBy() payments() permissions()
    // departments() approvalQueue() activityLogs() settings()
    public function isActive(): bool { return $this->status === 'active'; }
    public function isPaid():   bool { return $this->plan_type === 'paid'; }
}
```
No `$hidden`, no boot logic, no global scope, no password field on the model itself.

### 8.2 `User` (tenancy links)
```php
public function client() { return $this->belongsTo(Client::class); }
public function branch() { return $this->belongsTo(Branch::class); }
public function effectiveClient() { return $this->client ?? optional($this->branch)->client; }
// $hidden: ['password', 'password_encrypted', ...]
```

### 8.3 `ClientSetting`
```php
public function getTypedValue() {
    return match ($this->type) {
        'boolean' => filter_var($this->value, FILTER_VALIDATE_BOOLEAN),
        'integer' => (int) $this->value,
        'json'    => json_decode($this->value, true),
        default   => $this->value,
    };
}
```

---

## 9. FRONTEND SUPPORTING FLOWS

### 9.1 Permissions (`ClientPermissions.tsx`)
```tsx
// one round-trip gets client + embedded admin + admin_permissions; modules in parallel
const [c, m] = await Promise.all([ api.get(`/clients/${clientId}`), api.get('/modules') ]);
// build matrix, hide platform modules (clients, plans, payments, settings, permissions, org-types)
await api.post(`/permissions/user/${adminUser.id}`, { permissions: extractLeafPermissions(matrix) });
```

### 9.2 Branches / Payments / Settings (read-only)
```tsx
GET /branches?client_id={id}&per_page=100      // ClientBranches
GET /payments?client_id={id}&per_page=100      // ClientPayments
GET /client-settings?client_id={id}            // ClientSettings (display-only)
```

### 9.3 Form-bundle cache (`clientFormBundleCache.ts`)
sessionStorage, key `client:form-bundle:v3`, 5-min TTL, envelope `{v,ts,data}`; `readClientFormBundle` / `writeClientFormBundle` / `bustClientFormBundle`. The `v3` bump removed states from the bundle (now lazy per-country).

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Provisioning transaction | `store()` | Client + HO branch + admin created atomically |
| Dual password storage | `store()` / `update()` | bcrypt for auth + reversible mirror for super-admin recall |
| Token revocation | `update()` (deactivate), `destroy()` | Deactivating/removing a tenant logs everyone out |
| Soft-delete cascade | `destroy()` | Recoverable tenant removal |
| Force `free` plan | `store()`/`update()` | Paid activation reserved for billing |
| Normalize before validate | `normalizeGstPanInput()` | Consistent GST/PAN/email/phone formatting |
| Per-user cached bundle | `formBundle()` + sessionStorage | Fewer round-trips on the form |
| URL accessors | `Client`/`Branch` models | Resolve relative disk paths → full URLs at read time |

---

## 11. NOTES & CAVEATS

- **No route-level role guard / no tenant scoping** on `/clients*` — super-admin restriction is menu-visibility only (`IdimsHeader.tsx`).
- **`BrandingResolver`** is imported in `ClientController` but never used (dead import).
- **`is_main`** on branches was dropped (2026-06-20) — all branches are equal peers.
- **Per-tenant email** — partial unique index `COALESCE(client_id,0)+email` allows the same email across clients.
- **Clients are not seeded** — created via the API only (no factories).
- **DB is PostgreSQL** — `ilike` search and the partial unique index are Postgres-specific.

---

*Related documents: CLIENT_TECHNICAL_DOCUMENTATION.md · CLIENT_FUNCTIONAL_DOCUMENTATION.md · CLIENT_API_DOCUMENTATION.md*
