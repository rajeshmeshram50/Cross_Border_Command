<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        $user = User::with(['client', 'branch'])->where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['Invalid email or password.'],
            ]);
        }

        if ($user->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your account is not active. Contact administrator.'],
            ]);
        }

        if ($user->client_id && $user->client && $user->client->status !== 'active') {
            throw ValidationException::withMessages([
                'email' => ['Your organization is ' . $user->client->status . '. Contact administrator.'],
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

        $user = User::with(['client', 'branch'])->where('email', $email)->first();

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

        if ($user->client_id && $user->client && $user->client->status !== 'active') {
            return response()->json([
                'message' => 'Your organization is ' . $user->client->status . '. Contact administrator.',
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

        $user->update([
            'password' => Hash::make($request->password),
        ]);

        return response()->json(['message' => 'Password changed successfully']);
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
            ->first();
        $linkedEmployeeId = $linkedEmployee?->id;
        $linkedEmployeeCode = $linkedEmployee?->emp_code;

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
