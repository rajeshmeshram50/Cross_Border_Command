<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordChangedMail;
use App\Models\Permission;
use App\Models\User;
use App\Services\LogoWebVariantGenerator;
use App\Support\BrandingResolver;
use App\Support\Settings;
use App\Traits\PasswordHistory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    use PasswordHistory;

    private const BF_MAX_ATTEMPTS = 5;
    private const BF_WINDOW_MIN   = 15;

    public static function isDegenerateDescriptor(?array $descriptor): bool
    {
        if (!is_array($descriptor) || count($descriptor) !== 128) {
            return true;
        }
        $sum = 0.0;
        foreach ($descriptor as $v) {
            if (!is_numeric($v) || !is_finite((float) $v)) {
                return true;
            }
            $sum += ((float) $v) * ((float) $v);
        }

        return sqrt($sum) < 0.1;
    }

    private function bruteForceKey(?string $email): string
    {
        return 'login_attempts:' . strtolower(trim((string) $email));
    }

    private function bruteForceIsLocked(string $lockKey): bool
    {
        if (!Settings::is('security', 'bruteForce', true)) return false;
        return (int) Cache::get($lockKey, 0) >= self::BF_MAX_ATTEMPTS;
    }

    private function bruteForceRecordFailure(string $lockKey): void
    {
        if (!Settings::is('security', 'bruteForce', true)) return;
        Cache::add($lockKey, 0, now()->addMinutes(self::BF_WINDOW_MIN));
        Cache::increment($lockKey);
    }

    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
            'client_id' => 'nullable|integer',
        ]);

        $lockKey = $this->bruteForceKey($request->email);

        if ($this->bruteForceIsLocked($lockKey)) {
            throw ValidationException::withMessages([
                'email' => ['Too many failed login attempts. Try again in 15 minutes.'],
            ]);
        }

        $candidates = User::with(['client', 'branch.client'])->where('email', $request->email)->get();
        $matches = $candidates->filter(fn ($u) => Hash::check($request->password, $u->password))->values();

        if ($request->filled('client_id')) {
            $matches = $matches->where('client_id', (int) $request->client_id)->values();
        }

        if ($matches->isEmpty()) {
            $this->bruteForceRecordFailure($lockKey);
            throw ValidationException::withMessages([
                'email' => ['Invalid email or password.'],
            ]);
        }

        if ($matches->count() > 1) {
            Cache::forget($lockKey);
            return response()->json([
                'needs_org_selection' => true,
                'message' => 'This email is registered with more than one organization. Choose which one to sign in to.',
                'organizations' => $matches->map(fn ($u) => [
                    'client_id' => $u->client_id,
                    'name'      => $u->effectiveClient()?->org_name
                        ?? ($u->user_type === 'super_admin' ? 'Platform Admin' : 'Organization'),
                ])->values(),
            ], 409);
        }

        $user = $matches->first();

        Cache::forget($lockKey);

        if ($user->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your account is not active. Contact administrator.'],
            ]);
        }

        $effectiveClient = $user->effectiveClient();
        if ($effectiveClient && $effectiveClient->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your organization is ' . $effectiveClient->status . '. Contact administrator.'],
            ]);
        }

        if ($user->branch_id && $user->branch && $user->branch->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your branch is not active. Contact administrator.'],
            ]);
        }

        if ($user->must_reset_password) {
            throw ValidationException::withMessages([
                'email' => ['Your sign-in email was changed, so your password must be reset for security. Use "Forgot Password" to set a new one before logging in.'],
            ]);
        }

        $user->update([
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
            'login_count' => ($user->login_count ?? 0) + 1,
            'login_source' => 'web',
        ]);

        $user->tokens()->delete();
        $token = $user->createToken('cbc-token')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $this->formatUser($user),
        ]);
    }

    public function faceLogin(Request $request)
    {
        $request->validate([
            'email'        => 'required|email',
            'descriptor'   => 'required|array|size:128',
            'descriptor.*' => 'required|numeric|between:-5,5',
            'client_id'    => 'nullable|integer',
        ]);

        if ($this->isDegenerateDescriptor($request->input('descriptor'))) {
            throw ValidationException::withMessages([
                'descriptor' => ['That face capture was not usable. Please try again.'],
            ]);
        }

        $lockKey = $this->bruteForceKey($request->email);

        if ($this->bruteForceIsLocked($lockKey)) {
            throw ValidationException::withMessages([
                'email' => ['Too many failed login attempts. Try again in 15 minutes.'],
            ]);
        }

        $accounts = User::with(['client', 'branch.client'])->where('email', $request->email)->get();
        if ($request->filled('client_id')) {
            $accounts = $accounts->where('client_id', (int) $request->client_id)->values();
        }

        $captured = $request->input('descriptor');
        $threshold = 0.50;
        $anyFaceOnFile = false;
        $matches = [];

        foreach ($accounts as $candidate) {
            $emp = \App\Models\Employee::find($candidate->employee_id);
            if (!$emp || empty($emp->face_descriptor) || $emp->face_registered_at === null) {
                continue;
            }
            $anyFaceOnFile = true;
            $sum = 0.0;
            for ($i = 0; $i < 128; $i++) {
                $d = (float) $captured[$i] - (float) $emp->face_descriptor[$i];
                $sum += $d * $d;
            }
            $dist = sqrt($sum);
            if ($dist <= $threshold) {
                $matches[] = ['user' => $candidate, 'employee' => $emp, 'distance' => $dist];
            }
        }

        usort($matches, fn ($a, $b) => $a['distance'] <=> $b['distance']);

        $activeMatches = array_values(array_filter($matches, fn ($m) => $m['user']->status === 'active'));
        $usable = $activeMatches !== [] ? $activeMatches : $matches;

        if (count($usable) > 1 && !$request->filled('client_id')) {
            $orgs = collect($usable)
                ->map(fn ($m) => $m['user'])
                ->unique('client_id');
            if ($orgs->count() > 1) {
                Cache::forget($lockKey);
                return response()->json([
                    'needs_org_selection' => true,
                    'message' => 'This email is registered with more than one organization. Choose which one to sign in to.',
                    'organizations' => $orgs->map(fn ($u) => [
                        'client_id' => $u->client_id,
                        'name'      => $u->effectiveClient()?->org_name
                            ?? ($u->user_type === 'super_admin' ? 'Platform Admin' : 'Organization'),
                    ])->values(),
                ], 409);
            }
        }

        $best = $usable[0] ?? null;
        $bestUser     = $best['user'] ?? null;
        $bestEmployee = $best['employee'] ?? null;
        $bestDistance = $best['distance'] ?? INF;

        if (!$anyFaceOnFile) {
            $this->bruteForceRecordFailure($lockKey);
            throw ValidationException::withMessages([
                'email' => ['Face login is not available for this account. Try password login.'],
            ]);
        }

        if (!$bestUser || $bestDistance > $threshold) {
            $this->bruteForceRecordFailure($lockKey);
            throw ValidationException::withMessages([
                'email' => ['Face did not match. Please try again with better lighting or use password login.'],
            ]);
        }

        $user = $bestUser;
        $employee = $bestEmployee;
        $distance = $bestDistance;

        Cache::forget($lockKey);

        if ($user->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your account is not active. Contact administrator.'],
            ]);
        }
        $effectiveClient = $user->effectiveClient();
        if ($effectiveClient && $effectiveClient->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your organization is ' . $effectiveClient->status . '. Contact administrator.'],
            ]);
        }
        if ($user->branch_id && $user->branch && $user->branch->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your branch is not active. Contact administrator.'],
            ]);
        }

        if ($user->must_reset_password) {
            throw ValidationException::withMessages([
                'email' => ['Your sign-in email was changed, so your password must be reset for security. Use "Forgot Password" to set a new one before logging in.'],
            ]);
        }

        $user->update([
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
            'login_count'   => ($user->login_count ?? 0) + 1,
            'login_source'  => 'face',
        ]);

        $user->tokens()->delete();
        $token = $user->createToken('cbc-token')->plainTextToken;

        return response()->json([
            'token'     => $token,
            'user'      => $this->formatUser($user),
            'distance'  => round($distance, 4),
        ]);
    }

    public function googleLogin(Request $request)
    {
        $request->validate([
            'id_token' => 'required|string',
            'client_id' => 'nullable|integer',
        ]);

        $clientId = config('services.google.client_id');
        if (! $clientId) {
            return response()->json(['message' => 'Google sign-in is not configured.'], 500);
        }

        $client = new \Google_Client(['client_id' => $clientId]);

        try {
            $payload = $client->verifyIdToken($request->id_token);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Invalid Google token.'], 401);
        }

        if (! $payload || empty($payload['email'])) {
            return response()->json(['message' => 'Invalid Google token.'], 401);
        }

        if (empty($payload['email_verified'])) {
            return response()->json(['message' => 'Google email is not verified.'], 401);
        }

        $email = strtolower($payload['email']);
        $googleId = $payload['sub'];

        $lockKey = $this->bruteForceKey($email);
        if ($this->bruteForceIsLocked($lockKey)) {
            return response()->json([
                'message' => 'Too many failed login attempts. Try again in 15 minutes.',
            ], 429);
        }

        $googleAccounts = User::with(['client', 'branch.client'])->where('email', $email)->get();
        $selectedClientId = $request->input('client_id');
        if ($selectedClientId !== null && $selectedClientId !== '') {
            $googleAccounts = $googleAccounts->where('client_id', (int) $selectedClientId)->values();
        }

        if ($googleAccounts->isEmpty()) {
            $this->bruteForceRecordFailure($lockKey);
            return response()->json([
                'message' => 'Account not found. Please contact your administrator.',
            ], 404);
        }

        if ($googleAccounts->count() > 1) {
            return response()->json([
                'needs_org_selection' => true,
                'message' => 'This email is registered with more than one organization. Choose which one to sign in to.',
                'organizations' => $googleAccounts->map(fn ($u) => [
                    'client_id' => $u->client_id,
                    'name'      => $u->effectiveClient()?->org_name
                        ?? ($u->user_type === 'super_admin' ? 'Platform Admin' : 'Organization'),
                ])->values(),
            ], 409);
        }

        $user = $googleAccounts->first();

        if ($user->status !== 'active') {
            $this->bruteForceRecordFailure($lockKey);
            return response()->json([
                'message' => 'Your account is not active. Contact administrator.',
            ], 403);
        }

        $effectiveClient = $user->effectiveClient();
        if ($effectiveClient && $effectiveClient->status !== 'active') {
            $this->bruteForceRecordFailure($lockKey);
            return response()->json([
                'message' => 'Your organization is ' . $effectiveClient->status . '. Contact administrator.',
            ], 403);
        }

        if ($user->branch_id && $user->branch && $user->branch->status !== 'active') {
            $this->bruteForceRecordFailure($lockKey);
            return response()->json([
                'message' => 'Your branch is not active. Contact administrator.',
            ], 403);
        }

        if ($user->must_reset_password) {
            $this->bruteForceRecordFailure($lockKey);
            return response()->json([
                'message' => 'Your sign-in email was changed, so your password must be reset for security. Use "Forgot Password" to set a new one before logging in.',
            ], 403);
        }

        Cache::forget($lockKey);

        $updates = [
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
            'login_count' => ($user->login_count ?? 0) + 1,
            'login_source' => 'web',
        ];
        if (empty($user->google_id)) {
            $updates['google_id'] = $googleId;
        }
        $user->update($updates);

        $user->tokens()->delete();
        $token = $user->createToken('cbc-token')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $this->formatUser($user),
        ]);
    }

    public function me(Request $request)
    {
        $user = $request->user()->load(['client', 'branch']);

        return response()->json($this->formatUser($user));
    }

    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'required|string',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = $request->user();

        if (!Hash::check($request->current_password, $user->password)) {
            return response()->json(['message' => 'Current password is incorrect'], 422);
        }

        if ($this->isPasswordReused($user, $request->password)) {
            return response()->json([
                'message' => $this->passwordReuseMessage(),
            ], 422);
        }

        $this->recordPasswordHistory($user);

        $newPassword = $request->password;

        $user->update([
            'password' => Hash::make($newPassword),
            'must_reset_password' => false,
        ]);

        if (Settings::shouldSendMail()) {
            try {
                Mail::to($user->email)->send(new PasswordChangedMail(
                    $user->name,
                    $user->email,
                    $newPassword,
                    PasswordChangedMail::resolveLoginUrl($request),
                    BrandingResolver::forUser($user),
                ));
            } catch (\Throwable $e) {
                Log::warning('Password-changed confirmation mail failed (in-app change)', [
                    'user_id' => $user->id,
                    'email'   => $user->email,
                    'error'   => $e->getMessage(),
                ]);
            }
        }

        return response()->json(['message' => 'Password changed successfully']);
    }

    public function updateProfile(Request $request)
    {
        $request->validate([
            'name' => 'required|string|min:2|max:255',
            'phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'designation' => 'nullable|string|max:100',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
        ], [
            'phone.regex' => 'Phone may only contain digits, spaces, +, -, ( and ) and must be 7–20 characters.',
        ]);

        $user = $request->user();
        $user->update($request->only(['name', 'phone', 'designation']));

        if ($request->hasFile('profile_photo')) {
            if ($user->user_type === 'branch_user' && $user->branch_id) {
                $branch = $user->branch;
                if ($branch) {
                    if ($branch->profile_photo) {
                        \Illuminate\Support\Facades\Storage::disk('public')
                            ->delete($this->relativeFilePath($branch->profile_photo));
                    }
                    $branch->update([
                        'profile_photo' => $request->file('profile_photo')->storeAs(
                            "branches/profile-photos/{$branch->id}",
                            $this->uploadFileName($request->file('profile_photo')),
                            'public'
                        ),
                    ]);
                }
            } elseif ($user->user_type === 'client_admin' && $user->client_id) {
                $client = $user->client;
                if ($client) {
                    if ($client->profile_photo) {
                        \Illuminate\Support\Facades\Storage::disk('public')
                            ->delete($this->relativeFilePath($client->profile_photo));
                    }
                    $client->update([
                        'profile_photo' => $request->file('profile_photo')->storeAs(
                            "clients/profile-photos/{$client->id}",
                            $this->uploadFileName($request->file('profile_photo')),
                            'public'
                        ),
                    ]);
                }
            } else {
                if ($user->profile_photo) {
                    \Illuminate\Support\Facades\Storage::disk('public')
                        ->delete($this->relativeFilePath($user->profile_photo));
                }
                $user->update([
                    'profile_photo' => $request->file('profile_photo')->storeAs(
                        "users/profile-photos/{$user->id}",
                        $this->uploadFileName($request->file('profile_photo')),
                        'public'
                    ),
                ]);
            }
        }

        return response()->json([
            'message' => 'Profile updated successfully',
            'user' => $this->formatUser($user->fresh()->load(['client', 'branch'])),
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out']);
    }

    private function formatUser(User $user): array
    {
        $nameParts = explode(' ', trim($user->name));
        $initials = strtoupper(substr($nameParts[0], 0, 1) . substr(end($nameParts), 0, 1));

        $permissions = [];
        if (!$user->isSuperAdmin()) {
            $perms = Permission::where('user_id', $user->id)
                ->with('module:id,slug')
                ->get();

            foreach ($perms as $p) {
                if ($p->module) {
                    $permissions[$p->module->slug] = [
                        'can_view' => $p->can_view,
                        'can_add' => $p->can_add,
                        'can_edit' => $p->can_edit,
                        'can_delete' => $p->can_delete,
                        'can_export' => $p->can_export,
                        'can_import' => $p->can_import,
                        'can_approve' => $p->can_approve,
                    ];
                }
            }
        }

        $client = $user->effectiveClient();
        if (in_array($user->user_type, ['employee', 'branch_user'], true) && $user->branch?->client) {
            $client = $user->branch->client;
        }

        $planInfo = null;
        if ($client) {
            $expired = $client->plan_expires_at && $client->plan_expires_at->isPast();
            $planInfo = [
                'suggested_plan_id' => $client?->plan_id,
                'has_plan' => $client?->plan_id !== null && $client?->plan_type === 'paid',
                'expired' => $expired,
                'plan_name' => $client?->plan?->name,
                'plan_type' => $client?->plan_type,
                'expires_at' => $client?->plan_expires_at?->format('Y-m-d'),
            ];
        }

        $linkedEmployee = \App\Models\Employee::where(function ($w) use ($user) {
                $w->where('user_id', $user->id);
                if (!empty($user->employee_code)) {
                    $w->orWhere(function ($c) use ($user) {
                        $c->where('emp_code', $user->employee_code)
                          ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id));
                    });
                }
            })
            ->orderByRaw('CASE WHEN user_id = ? THEN 0 ELSE 1 END', [$user->id])
            ->select(['id', 'emp_code', 'onboarding_stage_completed', 'department_id', 'designation_id'])
            ->with(['photoDocument:id,employee_id,document_key,file_path', 'department:id,name', 'designation:id,name'])
            ->first();
        $linkedEmployeeId = $linkedEmployee?->id;
        $linkedEmployeeCode = $linkedEmployee?->emp_code;
        $linkedEmployeePhoto = $linkedEmployee?->photo_url;
        $linkedEmployeeDepartment = $linkedEmployee?->department?->name;
        $linkedEmployeeDesignation = $linkedEmployee?->designation?->name;

        $onboardingStage   = $linkedEmployeeId ? (int) ($linkedEmployee->onboarding_stage_completed ?? 0) : 6;
        $onboardingPending = $linkedEmployeeId && $onboardingStage < 6;

        $hasReports = $linkedEmployeeId
            ? \App\Models\Employee::where('reporting_manager_id', $linkedEmployeeId)->exists()
            : false;
        $isReportingManager = $hasReports
            || in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true);

        $inboxCount = 0;
        try {
            $candidates = \App\Models\HrDocumentSignature::query()
                ->whereIn('status', ['Pending', 'In Progress'])
                ->when($user->user_type !== 'super_admin', function ($q) use ($user, $linkedEmployeeId) {
                    if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
                        $q->where(function ($w) use ($user) {
                            $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
                        });
                    } elseif (in_array($user->user_type, ['branch_user', 'employee'], true)) {
                        $q->where(function ($w) use ($user, $linkedEmployeeId) {
                            $w->where('client_id', $user->client_id);
                            if ($linkedEmployeeId) {
                                $w->orWhere('employee_id', $linkedEmployeeId);
                            }
                        });
                    }
                })
                ->get(['id', 'signers', 'current_index']);
            foreach ($candidates as $row) {
                $signers = is_array($row->signers) ? $row->signers : [];
                $current = $signers[(int) $row->current_index] ?? null;
                if (!$current) continue;
                if ((int) ($current['user_id'] ?? 0) !== (int) $user->id) continue;
                if (($current['status'] ?? '') === 'Done') continue;
                $inboxCount++;
            }
        } catch (\Throwable $e) {
            $inboxCount = 0;
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'user_type' => $user->user_type,
            'initials' => $initials,
            'client_id' => $user->client_id,
            'branch_id' => $user->branch_id,
            'employee_id' => $linkedEmployeeId,
            'employee_code' => $linkedEmployeeCode,
            'client_name' => $user->client?->org_name,
            'branch_name' => $user->branch?->name,
            'client_logo' => file_url($user->client?->logo),
            'branch_logo' => file_url($user->branch?->logo),
            'client_logo_web' => file_url(LogoWebVariantGenerator::existingWebPath($user->client?->logo)),
            'branch_logo_web' => file_url(LogoWebVariantGenerator::existingWebPath($user->branch?->logo)),
            'client_profile_photo' => file_url($user->client?->profile_photo),
            'branch_profile_photo' => file_url($user->branch?->profile_photo),
            'employee_profile_photo' => $linkedEmployeePhoto,
            'user_profile_photo' => file_url($user->profile_photo),
            'primary_color' => $this->pickHexColor($user->branch?->primary_color, $user->client?->primary_color),
            'secondary_color' => $this->pickHexColor($user->branch?->secondary_color, $user->client?->secondary_color),
            'is_reporting_manager' => $isReportingManager,
            'has_direct_reports'   => $hasReports,
            'inbox_count'          => $inboxCount,
            'onboarding_pending'   => $onboardingPending,
            'onboarding_stage'     => $onboardingStage,
            'status' => $user->status,
            'designation' => $user->designation,
            'employee_designation' => $linkedEmployeeDesignation,
            'department' => $linkedEmployeeDepartment,
            'phone' => $user->phone,
            'avatar' => $user->avatar,
            'permissions' => $permissions,
            'plan' => $planInfo,
        ];
    }

    private function pickHexColor(?string ...$candidates): ?string
    {
        foreach ($candidates as $c) {
            $c = trim((string) $c);
            if ($c !== '' && preg_match('/^#[0-9a-fA-F]{6}$/', $c)) {
                return $c;
            }
        }
        return null;
    }

    public function updateBranding(\Illuminate\Http\Request $request)
    {
        $request->validate([
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
        ]);

        $user = $request->user();

        if ($user->user_type === 'client_admin' && $user->client_id) {
            $client = $user->client;
            if (!$client) return response()->json(['message' => 'Client not found'], 404);

            $payload = [];
            if ($request->filled('primary_color'))   $payload['primary_color']   = $request->input('primary_color');
            if ($request->filled('secondary_color')) $payload['secondary_color'] = $request->input('secondary_color');
            if ($payload) $client->update($payload);

            if ($request->hasFile('logo')) {
                if ($client->logo) {
                    \Illuminate\Support\Facades\Storage::disk('public')
                        ->delete($this->relativeFilePath($client->logo));
                }
                $client->update([
                    'logo' => $request->file('logo')->storeAs(
                        "clients/logos/{$client->id}",
                        $this->uploadFileName($request->file('logo')),
                        'public'
                    ),
                ]);
            }
        }
        elseif ($user->user_type === 'branch_user' && $user->branch_id) {
            $branch = $user->branch;
            if (!$branch) return response()->json(['message' => 'Branch not found'], 404);

            $payload = [];
            if ($request->filled('primary_color'))   $payload['primary_color']   = $request->input('primary_color');
            if ($request->filled('secondary_color')) $payload['secondary_color'] = $request->input('secondary_color');
            if ($payload) $branch->update($payload);

            if ($request->hasFile('logo')) {
                if ($branch->logo) {
                    \Illuminate\Support\Facades\Storage::disk('public')
                        ->delete($this->relativeFilePath($branch->logo));
                }
                $branch->update([
                    'logo' => $request->file('logo')->storeAs(
                        "branches/logos/{$branch->id}",
                        $this->uploadFileName($request->file('logo')),
                        'public'
                    ),
                ]);
            }
        }
        else {
            return response()->json(['message' => 'No tenant branding to update for this account'], 403);
        }

        return response()->json([
            'message' => 'Branding updated',
            'user' => $this->formatUser($user->fresh(['client', 'branch'])),
        ]);
    }

    private function uploadFileName(\Illuminate\Http\UploadedFile $file): string
    {
        $slug = \Illuminate\Support\Str::slug(
            pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME)
        );
        if ($slug === '') {
            $slug = 'logo';
        }
        $slug = substr($slug, 0, 60);

        $ext = strtolower($file->getClientOriginalExtension() ?: $file->guessExtension() ?: 'png');

        return $slug . '.' . $ext;
    }

    private function relativeFilePath(string $stored): string
    {
        if (preg_match('#^https?://#i', $stored)) {
            $path = parse_url($stored, PHP_URL_PATH) ?: '';
            $stored = ltrim($path, '/');
        }
        $stored = ltrim(str_replace('\\', '/', $stored), '/');
        if (str_starts_with($stored, 'storage/')) {
            $stored = substr($stored, strlen('storage/'));
        }
        return $stored;
    }
}
