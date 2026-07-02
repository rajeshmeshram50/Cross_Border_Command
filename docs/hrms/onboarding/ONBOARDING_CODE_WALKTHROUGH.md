# EMPLOYEE ONBOARDING MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Onboarding
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: create invite → public open → public complete (provisioning) → HR 6-stage progression. Line numbers may drift. Files: `OnboardingController.php`, `EmployeeOnboardingInvite.php`, `PublicOnboarding.tsx`, `HrEmployees.tsx`, `HrEmployeeOnboarding.tsx`.

---

## 1. CREATE INVITE (authed)

### `OnboardingController::createInvite()` (34)
```php
if (!in_array($user->user_type, ['super_admin','client_admin','branch_user'])) abort(403);
$data = $request->validate([
    'invitee_name'=>'required|string|max:255',
    'invitee_email'=>'required|email|max:191',
    'department_id'=>'nullable|exists:master_departments,id',
    'expected_join_date'=>'nullable|date',                 // window now-1y … now+2y
    'expiry_days'=>'nullable|integer|in:3,7,15,30',
    'app_origin'=>'nullable|url|max:255',
]);
[$clientId,$branchId] = $this->resolveOwnership($user);
// dup-guard: reject if a non-deleted User with same LOWER(email) exists in this client (422)
$token = $this->generateToken();                           // Str::random(64), collision-looped
$invite = EmployeeOnboardingInvite::create([... 'token'=>$token, 'status'=>'pending',
    'expires_at'=>now()->addDays($expiryDays ?? 15) ]);
$url = $this->buildOnboardingUrl($token, $data['app_origin'] ?? null);   // anti-phishing host check
if (Settings::shouldSendMail('newUser')) { try { Mail::to(...)->send(new OnboardingInviteMail(...)); } catch(...){} }
return response()->json(['message'=>'…', 'invite'=>[... 'url'=>$url, 'status'=>'pending']], 201);
```

### `buildOnboardingUrl()` (346)
```php
$base = config('app.frontend_url');
// honour caller app_origin ONLY if its host matches the configured frontend/app host
// (loopback localhost/127.0.0.1/::1 normalised so dev ports work)
return "{$base}/onboarding/{$token}";
```

---

## 2. PUBLIC OPEN (GET)

### `OnboardingController::show($token)` (138)
```php
$invite = EmployeeOnboardingInvite::firstWhere('token', $token);
if (!$invite) abort(404, 'Invalid onboarding link.');
if ($invite->status === 'completed') abort(410);
if ($invite->status === 'cancelled') abort(410);
if ($invite->expires_at->isPast()) { $invite->update(['status'=>'expired']); abort(410); }
return response()->json(['invite'=>[... org_name, logo_url, website ...],
    'masters'=>['countries'=>..., 'states'=>..., 'departments'=>..., 'designations'=>...,
                'roles'=>..., 'legal_entities'=>...]]);   // tenant-scoped (client_id NULL OR invite.client_id)
```

---

## 3. PUBLIC COMPLETE (the provisioning)

### `OnboardingController::complete(Request, $token)` (201)
```php
$invite = EmployeeOnboardingInvite::firstWhere('token', $token);
if (!$invite || $invite->status !== 'pending' || $invite->expires_at->isPast()) abort(410);
$data = $this->validateOnboardingPayload($request, $invite);   // age >=18, tenant-scoped FKs, XSS guards

DB::transaction(function () use (...) {
    $invite = EmployeeOnboardingInvite::whereKey($invite->id)->lockForUpdate()->first();  // OB-08 race guard
    if ($invite->status !== 'pending') abort(409);                                        // double-submit

    $user = User::create(['name'=>..., 'email'=>$invite->invitee_email, 'user_type'=>'employee',
        'password'=>Hash::make($this->generatePassword()), 'status'=>'active', ...tenant...]);
    $empCode = $this->allocateEmpCode(...);                     // EMP-### under lockForUpdate
    $employee = Employee::create($data + ['user_id'=>$user->id, 'emp_code'=>$empCode,
        'created_by'=>$invite->created_by, 'department_id'=>$data['department_id'] ?? $invite->department_id,
        'date_of_joining'=>$data['date_of_joining'] ?? $invite->expected_join_date ]);
    $user->update(['employee_code'=>$empCode]);
    $this->grantSelfServicePermissions($user, $clientId, $branchId, $invite->created_by);
    $invite->update(['status'=>'completed', 'completed_at'=>now(), 'employee_id'=>$employee->id]);
});

if (Settings::shouldSendMail('newUser')) {                     // OB-12: sent synchronously (no queue worker)
    try { Mail::to($user->email)->send(new WelcomeCredentialsMail($employee, $user, $rawPassword, $loginUrl)); }
    catch (\Throwable $e) { Log::warning(...); }
}
return response()->json(['message'=>'…', 'employee'=>['id'=>..., 'emp_code'=>..., 'display_name'=>...]]);
// PG 23505 (unique) → 422 on email
```

### `grantSelfServicePermissions()` (411)
```php
foreach (['profile','dashboard','master.employees'] as $slug) firstOrCreate(view-only);
// + inherit any master.* modules the inviter (granted_by) can_view
```

### `validateOnboardingPayload()` (451)
```php
$tenantFk = fn($t) => Rule::exists($t,'id')->where(fn($q)=>$q->whereNull('client_id')->orWhere('client_id',$invite->client_id));
// name regex, mobile regex, pincode 4-10, XSS not_regex /[<>]/,
// date_of_birth before_or_equal now-18y (min age 18), FKs tenant-scoped
```

---

## 4. HR 6-STAGE PROGRESSION

`HrEmployeeOnboarding.tsx` advances an existing employee:
```tsx
PUT /employees/{id} { onboarding_stage_completed: n }   // bumpMacroStage — high-watermark, only advances
// complete → { onboarding_stage_completed: 6, onboarding_complete_notes }
// activate → { status: 'Active', onboarding_stage_completed: 6 }
```
Backend (`EmployeeController::update`) clamps to `max(existing, incoming)`; Stage 1's internal 4-step wizard (`wizard_step_completed >= 4`) forces macro ≥ 1.

---

## 5. FRONTEND

### `PublicOnboarding.tsx`
```tsx
GET  /onboarding/${token}            // invite preview + masters
POST /onboarding/${token}/complete   // submit (JSON; no file upload)
// draft autosave: localStorage cbc:public-onboarding-draft:${token}
// pincode /^\d{6}$/ (stricter than backend); success → emp_code card
```

### `HrEmployees.tsx` (invite-send)
```tsx
POST /employees/onboarding-invite { invitee_name, invitee_email, department_id,
     expected_join_date, expiry_days (default 15), app_origin: window.location.origin }
```

---

## 6. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Token invite + expiry | createInvite | Secure, time-boxed self-fill |
| Rate limiting | public routes | Protect the token from brute-force |
| Locked completion | complete() | Prevent double provisioning (409) |
| Tenant-scoped FKs | validateOnboardingPayload | Block cross-tenant id injection |
| Anti-phishing URL | buildOnboardingUrl | Only trusted hosts |
| Synchronous mail | complete() | No queue worker runs |
| High-watermark stage | HR wizard → EmployeeController | Progress never regresses |

---

## 7. NOTES & CAVEATS
- Public form collects **no documents**; pincode 6-digit frontend vs 4–10 backend.
- `cancelled` invite status is defined but not wired to any endpoint.
- No DB foreign keys on the invite table.
- Emails are best-effort and sent synchronously.
- DB is PostgreSQL.

---

*Related documents: ONBOARDING_TECHNICAL_DOCUMENTATION.md · ONBOARDING_FUNCTIONAL_DOCUMENTATION.md · ONBOARDING_API_DOCUMENTATION.md*
