<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordChangedMail;
use App\Models\Permission;
use App\Models\User;
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

    /** Lowercased + trimmed cache key shared across all login paths so an
     *  attacker can't bypass rate-limiting by switching login methods. */
    private function bruteForceKey(?string $email): string
    {
        return 'login_attempts:' . strtolower(trim((string) $email));
    }

    /** Returns true when the account is currently locked. Safe to call with
     *  bruteForce disabled — short-circuits to false. */
    private function bruteForceIsLocked(string $lockKey): bool
    {
        if (!Settings::is('security', 'bruteForce', true)) return false;
        return (int) Cache::get($lockKey, 0) >= self::BF_MAX_ATTEMPTS;
    }

    /** Atomically increment the failure counter. Uses Cache::add to install
     *  a 15-min TTL on first miss, then Cache::increment so concurrent
     *  failing requests can't race-bypass the 5-attempt limit (TOCTOU was a
     *  bug pre-this — two requests both saw 4 attempts and both bumped to 5
     *  without locking, letting a 6th through). */
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
            // Optional — sent only when the SPA re-submits after asking which
            // organization to sign in to (duplicate email across clients).
            'client_id' => 'nullable|integer',
        ]);

        $lockKey = $this->bruteForceKey($request->email);

        if ($this->bruteForceIsLocked($lockKey)) {
            throw ValidationException::withMessages([
                'email' => ['Too many failed login attempts. Try again in 15 minutes.'],
            ]);
        }

        // Eager-load branch.client too — branch_user / employee rows often
        // have no direct client_id, so the parent-org check has to traverse
        // branch → client. Without this, an inactive client would only lock
        // out client_admin / client_user, leaving branch users able to log in.
        //
        // Email is unique PER TENANT now, so the same email can belong to
        // accounts in different clients. Gather ALL matches and let the
        // PASSWORD pick which account the user means — a single-account email
        // behaves exactly as before (one candidate, one password check).
        $candidates = User::with(['client', 'branch.client'])->where('email', $request->email)->get();
        $matches = $candidates->filter(fn ($u) => Hash::check($request->password, $u->password))->values();

        // If the SPA already asked which organization (same email+password
        // matched more than one), it re-submits with the chosen client_id.
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
            // Same email + same password across multiple clients. The user has
            // proven the credential, so it's safe to list their organizations
            // and let them pick which one to sign in to.
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

        // Successful login → clear any prior failed-attempt counter
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

        // Forced-reset gate — after an email change the old password must not
        // grant access. The user has to set a new password via Forgot Password
        // (OTP is sent to their current email) before they can sign in again.
        if ($user->must_reset_password) {
            throw ValidationException::withMessages([
                'email' => ['Your sign-in email was changed, so your password must be reset for security. Use "Forgot Password" to set a new one before logging in.'],
            ]);
        }

        // Onboarding gate — an employee whose onboarding isn't fully complete
        // cannot enter the app yet (logs the blocked attempt for audit).
        // NOTE: onboarding-incomplete employees may now sign in. The SPA
        // restricts them to the Inbox (via the onboarding_pending flag on the
        // user payload) so they can sign their pending onboarding documents —
        // blocking login entirely created a deadlock where the employee could
        // never sign, so onboarding could never complete.

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

    /**
     * Face-based login. The SPA captures a face frame, computes the 128-d
     * descriptor with face-api.js and POSTs it here along with the user's
     * email. We compare against the enrolled descriptor on that user's
     * linked Employee row.
     *
     * Threshold is tighter than attendance (0.50 vs 0.55) because this is
     * authentication — a false match here hands over the session. The face
     * is a SECOND factor in spirit, not the only factor: the user still
     * has to know which email account to identify themselves as.
     *
     * All the same active-account / org / branch gates fire as the password
     * login, plus brute-force lockout on the same Cache key so an attacker
     * can't bypass rate-limiting by switching login methods.
     */
    public function faceLogin(Request $request)
    {
        $request->validate([
            'email'        => 'required|email',
            'descriptor'   => 'required|array|size:128',
            'descriptor.*' => 'required|numeric',
            // Optional org pick when the email exists in multiple clients.
            'client_id'    => 'nullable|integer',
        ]);

        $lockKey = $this->bruteForceKey($request->email);

        if ($this->bruteForceIsLocked($lockKey)) {
            throw ValidationException::withMessages([
                'email' => ['Too many failed login attempts. Try again in 15 minutes.'],
            ]);
        }

        // Email is per-tenant — the same email can have accounts in multiple
        // clients. Try the captured face against EACH matching account's
        // enrolled descriptor and pick the closest under threshold. A
        // single-account email behaves exactly as before.
        $accounts = User::with(['client', 'branch.client'])->where('email', $request->email)->get();
        if ($request->filled('client_id')) {
            $accounts = $accounts->where('client_id', (int) $request->client_id)->values();
        }

        $captured = $request->input('descriptor');
        $threshold = 0.50;
        $bestUser = null;
        $bestEmployee = null;
        $bestDistance = INF;
        $anyFaceOnFile = false;

        foreach ($accounts as $candidate) {
            $emp = \App\Models\Employee::where('user_id', $candidate->id)->first();
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
            if ($dist < $bestDistance) {
                $bestDistance = $dist;
                $bestUser = $candidate;
                $bestEmployee = $emp;
            }
        }

        // No account with this email has a face enrolled. Generic message so we
        // don't leak which condition failed (mirrors the original guard).
        if (!$anyFaceOnFile) {
            $this->bruteForceRecordFailure($lockKey);
            throw ValidationException::withMessages([
                'email' => ['Face login is not available for this account. Try password login.'],
            ]);
        }

        // A face is on file but none matched closely enough.
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

        // Same status / org / branch gates as the password login. We refuse
        // to issue a token if any of these are inactive so a "face match"
        // alone can't bypass account-disabled state.
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

        // Forced-reset gate (mirrors password login) — a face match must not
        // bypass the post-email-change password reset requirement.
        if ($user->must_reset_password) {
            throw ValidationException::withMessages([
                'email' => ['Your sign-in email was changed, so your password must be reset for security. Use "Forgot Password" to set a new one before logging in.'],
            ]);
        }

        // Same onboarding gate as password login — can't bypass via face.
        // NOTE: onboarding-incomplete employees may now sign in. The SPA
        // restricts them to the Inbox (via the onboarding_pending flag on the
        // user payload) so they can sign their pending onboarding documents —
        // blocking login entirely created a deadlock where the employee could
        // never sign, so onboarding could never complete.

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
            // Optional org pick when the email exists in multiple clients.
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

        // Brute-force lockout — shares the same login_attempts:<email> cache
        // key as password + face login, so an attacker can't bypass the
        // 5-in-15-min limit by switching login method. Check is gated on the
        // verified email (post-Google verification) so anonymous token spam
        // doesn't poison real users' counters.
        $lockKey = $this->bruteForceKey($email);
        if ($this->bruteForceIsLocked($lockKey)) {
            return response()->json([
                'message' => 'Too many failed login attempts. Try again in 15 minutes.',
            ], 429);
        }

        // Email is per-tenant — the same Google email can map to accounts in
        // multiple clients. Google only proves the email (no password), so when
        // there's more than one we must ask which organization. The email is
        // Google-verified, so listing the orgs to its owner is safe.
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

        // Forced-reset gate (mirrors password / face login) — a Google sign-in
        // must not bypass the post-email-change password reset requirement.
        if ($user->must_reset_password) {
            $this->bruteForceRecordFailure($lockKey);
            return response()->json([
                'message' => 'Your sign-in email was changed, so your password must be reset for security. Use "Forgot Password" to set a new one before logging in.',
            ], 403);
        }

        // Same onboarding gate as password / face login — can't bypass via Google.
        // NOTE: onboarding-incomplete employees may now sign in. The SPA
        // restricts them to the Inbox (via the onboarding_pending flag on the
        // user payload) so they can sign their pending onboarding documents —
        // blocking login entirely created a deadlock where the employee could
        // never sign, so onboarding could never complete.

        // Clear the failure counter on success — mirrors password / face paths.
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

        // Block re-use of the last 3 passwords (current + 2 historical).
        // See App\Traits\PasswordHistory for the full policy.
        if ($this->isPasswordReused($user, $request->password)) {
            return response()->json([
                'message' => $this->passwordReuseMessage(),
            ], 422);
        }

        // Save the OLD hash to history BEFORE we overwrite it on the user.
        $this->recordPasswordHistory($user);

        // Capture plaintext before hashing so the confirmation mail can echo
        // the new credential. Matches the forgot-password flow's behaviour.
        $newPassword = $request->password;

        $user->update([
            'password' => Hash::make($newPassword),
            // Any forced-reset flag is satisfied once a new password is set.
            'must_reset_password' => false,
        ]);

        // Confirmation mail — non-fatal so SMTP issues never roll back the
        // (already persisted) password change. Master notifications.emailNotif
        // toggle gates ALL platform mail; transactional sends honour it too
        // because once an admin globally disables email they accept the
        // trade-off (no OTP, no welcome creds, etc.).
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

    /**
     * Update the signed-in user's own profile (name, phone, designation).
     * Email is intentionally NOT editable here — it's the login identifier
     * and changing it requires re-verification, which we don't support yet.
     */
    public function updateProfile(Request $request)
    {
        $request->validate([
            'name' => 'required|string|min:2|max:255',
            'phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'designation' => 'nullable|string|max:100',
            // Profile photo lives on the tenant row (client/branch). Accepted only
            // for tenant users; super_admin has no tenant to attach it to.
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
        ], [
            'phone.regex' => 'Phone may only contain digits, spaces, +, -, ( and ) and must be 7–20 characters.',
        ]);

        $user = $request->user();
        $user->update($request->only(['name', 'phone', 'designation']));

        // Profile photo update — branch_user writes to their branch row,
        // client_admin writes to their client row, everyone else (super_admin,
        // employees, client_user) writes to their own user row. Same fallback
        // chain that formatUser surfaces (branch > client > user_profile_photo).
        if ($request->hasFile('profile_photo')) {
            if ($user->user_type === 'branch_user' && $user->branch_id) {
                $branch = $user->branch;
                if ($branch) {
                    if ($branch->profile_photo) {
                        \Illuminate\Support\Facades\Storage::disk('public')
                            ->delete($this->relativeFilePath($branch->profile_photo));
                    }
                    $branch->update([
                        'profile_photo' => $request->file('profile_photo')->store('branches/profile-photos', 'public'),
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
                        'profile_photo' => $request->file('profile_photo')->store('clients/profile-photos', 'public'),
                    ]);
                }
            } else {
                if ($user->profile_photo) {
                    \Illuminate\Support\Facades\Storage::disk('public')
                        ->delete($this->relativeFilePath($user->profile_photo));
                }
                $user->update([
                    'profile_photo' => $request->file('profile_photo')->store('users/profile-photos', 'public'),
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

        // Get permissions with module slugs
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

        // Plan info for client users
        $planInfo = null;
        if ($user->client_id) {
            $client = $user->client;
            $expired = $client?->plan_expires_at && $client->plan_expires_at->isPast();
            $planInfo = [
                // suggested_plan_id is the plan the Super Admin assigned to this
                // client when they were created/edited — the My Plan page uses
                // it to visually highlight the recommended card on purchase.
                'suggested_plan_id' => $client?->plan_id,
                'has_plan' => $client?->plan_id !== null && $client?->plan_type === 'paid',
                'expired' => $expired,
                'plan_name' => $client?->plan?->name,
                'plan_type' => $client?->plan_type,
                'expires_at' => $client?->plan_expires_at?->format('Y-m-d'),
            ];
        }

        // Linked Employee row when the user logs into an employee profile.
        // Both id (numeric) and emp_code (EMP-### string) are surfaced so the
        // frontend can detect "is this my own profile?" regardless of which
        // form the URL slug carries — without an extra round-trip.
        $linkedEmployee = \App\Models\Employee::where('user_id', $user->id)
            ->select(['id', 'emp_code', 'onboarding_stage_completed'])
            ->with('photoDocument:id,employee_id,document_key,file_path')
            ->first();
        $linkedEmployeeId = $linkedEmployee?->id;
        $linkedEmployeeCode = $linkedEmployee?->emp_code;
        $linkedEmployeePhoto = $linkedEmployee?->photo_url;

        // Onboarding gate. An employee whose onboarding isn't fully complete
        // (onboarding_stage_completed < 6) CAN log in, but the SPA restricts
        // them to the Inbox so they can sign their pending onboarding
        // documents. Once HR finishes onboarding (stage 6) the flag clears and
        // full access opens up (subject to the module permissions the branch
        // then grants). Without this in-between state the employee could never
        // sign — they couldn't log in, so onboarding could never complete.
        $onboardingStage   = $linkedEmployeeId ? (int) ($linkedEmployee->onboarding_stage_completed ?? 0) : 6;
        $onboardingPending = $linkedEmployeeId && $onboardingStage < 6;

        // Flag the My Team menu visibility: anyone who's been assigned as
        // someone else's reporting manager (i.e. has direct reports) — plus
        // branch/client users who always need a team view. Computed here so
        // the SPA can gate the profile-dropdown item without an extra fetch.
        $hasReports = $linkedEmployeeId
            ? \App\Models\Employee::where('reporting_manager_id', $linkedEmployeeId)->exists()
            : false;
        $isReportingManager = $hasReports
            || in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true);

        // Inbox count — number of in-flight document signatures where this
        // user is the next signer. Surfaced on /me so the profile dropdown
        // can render a badge without a second round-trip on every page load.
        // Cheap lookup: the JSON `signers` column is small and the row is
        // already filtered to Pending / In Progress.
        $inboxCount = 0;
        try {
            $candidates = \App\Models\HrDocumentSignature::query()
                ->whereIn('status', ['Pending', 'In Progress'])
                ->when($user->user_type !== 'super_admin', function ($q) use ($user) {
                    if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
                        $q->where(function ($w) use ($user) {
                            $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
                        });
                    } elseif (in_array($user->user_type, ['branch_user', 'employee'], true)) {
                        $q->where(function ($w) use ($user) {
                            $w->where('client_id', $user->client_id)
                              ->orWhere('employee_id', $linkedEmployeeId);
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
            // /me must never fail because of an inbox lookup; swallow and
            // let the SPA fall back to fetching the inbox endpoint directly.
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
            'client_profile_photo' => file_url($user->client?->profile_photo),
            'branch_profile_photo' => file_url($user->branch?->profile_photo),
            // Passport-size photo from the employee onboarding documents
            // (employee_documents.document_key='photo'). Only populated when
            // the logged-in user is linked to an Employee row.
            'employee_profile_photo' => $linkedEmployeePhoto,
            // Personal photo on the user row — always set for super_admin (no
            // tenant), and used as a fallback for tenant users when the
            // client/branch photo is blank.
            'user_profile_photo' => file_url($user->profile_photo),
            // Effective tenant theme colors — branch values win over client values,
            // null when neither is set so the frontend falls back to app defaults.
            // Only valid 7-char hex strings (#RRGGBB) are surfaced; anything else
            // is dropped so we never inject malformed CSS into :root.
            'primary_color' => $this->pickHexColor($user->branch?->primary_color, $user->client?->primary_color),
            'secondary_color' => $this->pickHexColor($user->branch?->secondary_color, $user->client?->secondary_color),
            'is_reporting_manager' => $isReportingManager,
            'has_direct_reports'   => $hasReports,
            'inbox_count'          => $inboxCount,
            // When true the SPA locks this employee to the Inbox until HR
            // completes their onboarding (see DashboardRoutes gate).
            'onboarding_pending'   => $onboardingPending,
            'onboarding_stage'     => $onboardingStage,
            'status' => $user->status,
            'designation' => $user->designation,
            'phone' => $user->phone,
            'avatar' => $user->avatar,
            'permissions' => $permissions,
            'plan' => $planInfo,
        ];
    }

    /**
     * Pick the first non-empty value that looks like a 7-char hex color.
     * Anything else (whitespace, malformed, named colors, etc.) is rejected
     * so the frontend never injects invalid CSS into document.documentElement.
     */
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

    /**
     * Self-serve tenant branding update — tenant users (client_admin, branch_user)
     * can edit their own logo + primary/secondary colors from their Profile page
     * without going through the super-admin client form. Authorization is
     * scope-driven:
     *   client_admin → updates the row in `clients`
     *   branch_user  → updates the row in `branches`
     *   super_admin  → no tenant attached, returns 403
     * Returns the freshly-formatted user so the SPA can swap state and the
     * theme effect repaints automatically.
     */
    public function updateBranding(\Illuminate\Http\Request $request)
    {
        $request->validate([
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
        ]);

        $user = $request->user();

        // Client admin → patch the client row
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
                    'logo' => $request->file('logo')->store('clients/logos', 'public'),
                ]);
            }
        }
        // Branch user → patch the branch row
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
                    'logo' => $request->file('logo')->store('branches/logos', 'public'),
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

    /**
     * Normalize a stored value (legacy "/storage/..." URL or already-relative
     * path) to a disk-relative path suitable for Storage::delete().
     */
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
