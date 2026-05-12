<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordChangedMail;
use App\Models\Permission;
use App\Models\User;
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

    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        $lockKey = 'login_attempts:' . strtolower(trim($request->email));

        // Brute-force lockout — gated by Settings → Security → bruteForce.
        // After 5 failed attempts within 15 min, the account is locked for
        // 15 min. Cache-based so it survives a fresh DB but resets on cache
        // clear (intentional — admin can force-unlock by clearing cache).
        if (Settings::is('security', 'bruteForce', true)) {
            $attempts = (int) Cache::get($lockKey, 0);
            if ($attempts >= 5) {
                throw ValidationException::withMessages([
                    'email' => ['Too many failed login attempts. Try again in 15 minutes.'],
                ]);
            }
        }

        // Eager-load branch.client too — branch_user / employee rows often
        // have no direct client_id, so the parent-org check has to traverse
        // branch → client. Without this, an inactive client would only lock
        // out client_admin / client_user, leaving branch users able to log in.
        $user = User::with(['client', 'branch.client'])->where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            if (Settings::is('security', 'bruteForce', true)) {
                Cache::put($lockKey, ((int) Cache::get($lockKey, 0)) + 1, now()->addMinutes(15));
            }
            throw ValidationException::withMessages([
                'email' => ['Invalid email or password.'],
            ]);
        }

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

    public function googleLogin(Request $request)
    {
        $request->validate([
            'id_token' => 'required|string',
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

        $user = User::with(['client', 'branch.client'])->where('email', $email)->first();

        if (! $user) {
            return response()->json([
                'message' => 'Account not found. Please contact your administrator.',
            ], 404);
        }

        if ($user->status !== 'active') {
            return response()->json([
                'message' => 'Your account is not active. Contact administrator.',
            ], 403);
        }

        $effectiveClient = $user->effectiveClient();
        if ($effectiveClient && $effectiveClient->status !== 'active') {
            return response()->json([
                'message' => 'Your organization is ' . $effectiveClient->status . '. Contact administrator.',
            ], 403);
        }

        if ($user->branch_id && $user->branch && $user->branch->status !== 'active') {
            return response()->json([
                'message' => 'Your branch is not active. Contact administrator.',
            ], 403);
        }

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
            ->select(['id', 'emp_code'])
            ->with('photoDocument:id,employee_id,document_key,file_path')
            ->first();
        $linkedEmployeeId = $linkedEmployee?->id;
        $linkedEmployeeCode = $linkedEmployee?->emp_code;
        $linkedEmployeePhoto = $linkedEmployee?->photo_url;

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
            'is_main_branch' => (bool) ($user->branch?->is_main),
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
