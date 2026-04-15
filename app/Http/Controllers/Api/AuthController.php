<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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

        // Update login tracking
        $user->update([
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
            'login_count' => ($user->login_count ?? 0) + 1,
            'login_source' => 'web',
        ]);

        // Delete old tokens & create new
        $user->tokens()->delete();
        $token = $user->createToken('cbc-token')->plainTextToken;

        $nameParts = explode(' ', trim($user->name));
        $initials = strtoupper(substr($nameParts[0], 0, 1) . substr(end($nameParts), 0, 1));

        return response()->json([
            'token' => $token,
            'user' => [
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
            ],
        ]);
    }

    public function me(Request $request)
    {
        $user = $request->user()->load(['client', 'branch']);
        $nameParts = explode(' ', trim($user->name));
        $initials = strtoupper(substr($nameParts[0], 0, 1) . substr(end($nameParts), 0, 1));

        return response()->json([
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
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out']);
    }
}
