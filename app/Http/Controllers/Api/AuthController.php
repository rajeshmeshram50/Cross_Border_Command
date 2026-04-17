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

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'user_type' => $user->user_type,
            'initials' => $initials,
            'client_id' => $user->client_id,
            'branch_id' => $user->branch_id,
            'client_name' => $user->client?->org_name,
            'branch_name' => $user->branch?->name,
            'status' => $user->status,
            'designation' => $user->designation,
            'phone' => $user->phone,
            'avatar' => $user->avatar,
            'permissions' => $permissions,
            'plan' => $planInfo,
        ];
    }
}
