<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use App\Mail\WelcomeCredentialsMail;

class BranchController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;

        if (!$clientId && !$user->isSuperAdmin()) {
            return response()->json(['data' => [], 'total' => 0]);
        }

        $query = Branch::withCount('users')
            ->withCount('departments');

        if ($clientId) {
            $query->where('client_id', $clientId);
        } elseif ($request->query('client_id')) {
            $query->where('client_id', $request->query('client_id'));
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%")
                  ->orWhere('city', 'ilike', "%{$search}%")
                  ->orWhere('industry', 'ilike', "%{$search}%");
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($request->query('type')) {
            $query->where('branch_type', $request->query('type'));
        }

        $branches = $query->orderByDesc('is_main')->orderBy('name')
            ->paginate($request->query('per_page', 15));

        return response()->json($branches);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;

        if (!$clientId) {
            return response()->json(['message' => 'Only client admins can create branches'], 403);
        }

        // Enforce plan limit (max_branches) if configured
        $client = \App\Models\Client::with('plan')->find($clientId);
        $maxBranches = (int) ($client?->plan?->max_branches ?? 0);
        if ($maxBranches > 0) {
            $currentCount = Branch::where('client_id', $clientId)->count();
            if ($currentCount >= $maxBranches) {
                return response()->json([
                    'message' => "Branch limit reached. Your plan allows up to {$maxBranches} branches (currently {$currentCount}). Upgrade your plan to add more.",
                ], 422);
            }
        }

        $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'nullable|string|max:50',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:20',
            'website' => 'nullable|string|max:500',
            'contact_person' => 'nullable|string|max:255',
            'branch_type' => 'nullable|string|max:50',
            'industry' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'gst_number' => 'nullable|string|max:20',
            'pan_number' => 'nullable|string|max:20',
            'registration_number' => 'nullable|string|max:50',
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'country' => 'nullable|string|max:100',
            'is_main' => 'nullable|boolean',
            'max_users' => 'nullable|integer|min:0',
            'established_at' => 'nullable|date',
            'status' => 'required|in:active,inactive',
            'notes' => 'nullable|string',

            // Branch user login credentials
            'user_name' => 'required|string|max:255',
            'user_email' => ['required', 'email', Rule::unique('users', 'email')->whereNull('deleted_at')],
            'user_phone' => 'nullable|string|max:20',
            'user_designation' => 'nullable|string|max:100',
            'user_password' => 'required|string|min:6',
            'user_status' => 'nullable|in:active,inactive,pending',
        ]);

        return DB::transaction(function () use ($request, $clientId, $user) {
            // If setting as main, unset existing main branch
            if ($request->boolean('is_main')) {
                Branch::where('client_id', $clientId)
                    ->where('is_main', true)
                    ->update(['is_main' => false]);
            }

            $branch = Branch::create([
                'client_id' => $clientId,
                'name' => $request->name,
                'code' => $request->code,
                'email' => $request->email,
                'phone' => $request->phone,
                'website' => $request->website,
                'contact_person' => $request->contact_person,
                'branch_type' => $request->branch_type,
                'industry' => $request->industry,
                'description' => $request->description,
                'gst_number' => $request->gst_number,
                'pan_number' => $request->pan_number,
                'registration_number' => $request->registration_number,
                'address' => $request->address,
                'city' => $request->city,
                'district' => $request->district,
                'taluka' => $request->taluka,
                'state' => $request->state,
                'pincode' => $request->pincode,
                'country' => $request->country ?? 'India',
                'is_main' => $request->boolean('is_main'),
                'max_users' => $request->max_users ?? 0,
                'established_at' => $request->established_at,
                'status' => $request->status ?? 'active',
                'notes' => $request->notes,
                'created_by' => $user->id,
            ]);

            // Create branch user
            $branchUser = User::create([
                'name' => $request->user_name,
                'email' => $request->user_email,
                'password' => Hash::make($request->user_password),
                'phone' => $request->user_phone,
                'user_type' => 'branch_user',
                'client_id' => $clientId,
                'branch_id' => $branch->id,
                'status' => $request->user_status ?? 'active',
                'designation' => $request->user_designation,
            ]);

            $branch->loadCount(['users', 'departments']);

            // Send welcome email (non-fatal — branch creation succeeds even if mail fails)
            try {
                $clientName = \App\Models\Client::find($clientId)?->org_name ?? 'Your Organization';
                Mail::to($request->user_email)->send(new WelcomeCredentialsMail(
                    $request->user_name,
                    $request->user_email,
                    $request->user_password,
                    'branch_user',
                    $clientName,
                ));
            } catch (\Exception $e) {
                Log::warning('Branch welcome mail failed', [
                    'branch_id' => $branch->id,
                    'user_email' => $request->user_email,
                    'error' => $e->getMessage(),
                ]);
            }

            return response()->json([
                'message' => 'Branch created successfully',
                'branch' => $branch,
                'branch_user' => $branchUser->only(['id', 'name', 'email', 'user_type', 'status']),
            ], 201);
        });
    }

    public function show(Branch $branch, Request $request)
    {
        $user = $request->user();

        if ($user->client_id && $branch->client_id !== $user->client_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $branch->loadCount(['users', 'departments']);

        // Get branch user (first branch_user for this branch)
        $branchUser = User::where('branch_id', $branch->id)
            ->where('user_type', 'branch_user')
            ->first();

        return response()->json([
            'branch' => $branch,
            'branch_user' => $branchUser ? $branchUser->only(['id', 'name', 'email', 'phone', 'designation', 'status']) : null,
        ]);
    }

    public function update(Request $request, Branch $branch)
    {
        $user = $request->user();

        if ($user->client_id && $branch->client_id !== $user->client_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $branchUser = User::where('branch_id', $branch->id)
            ->where('user_type', 'branch_user')
            ->first();

        $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'nullable|string|max:50',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:20',
            'website' => 'nullable|string|max:500',
            'contact_person' => 'nullable|string|max:255',
            'branch_type' => 'nullable|string|max:50',
            'industry' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'gst_number' => 'nullable|string|max:20',
            'pan_number' => 'nullable|string|max:20',
            'registration_number' => 'nullable|string|max:50',
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'country' => 'nullable|string|max:100',
            'is_main' => 'nullable|boolean',
            'max_users' => 'nullable|integer|min:0',
            'established_at' => 'nullable|date',
            'status' => 'required|in:active,inactive',
            'notes' => 'nullable|string',
            'user_name' => 'nullable|string|max:255',
            'user_email' => ['nullable', 'email', Rule::unique('users', 'email')->ignore($branchUser?->id)->whereNull('deleted_at')],
            'user_phone' => 'nullable|string|max:20',
            'user_designation' => 'nullable|string|max:100',
            'user_password' => 'nullable|string|min:6',
            'user_status' => 'nullable|in:active,inactive,pending',
        ]);

        return DB::transaction(function () use ($request, $branch, $branchUser) {
            // If setting as main, unset existing main
            if ($request->boolean('is_main') && !$branch->is_main) {
                Branch::where('client_id', $branch->client_id)
                    ->where('is_main', true)
                    ->where('id', '!=', $branch->id)
                    ->update(['is_main' => false]);
            }

            $branch->update($request->only([
                'name', 'code', 'email', 'phone', 'website', 'contact_person',
                'branch_type', 'industry', 'description',
                'gst_number', 'pan_number', 'registration_number',
                'address', 'city', 'district', 'taluka', 'state', 'pincode', 'country',
                'is_main', 'max_users', 'established_at', 'status', 'notes',
            ]));

            // Update branch user if provided
            if ($branchUser && $request->user_name) {
                $userData = array_filter([
                    'name' => $request->user_name,
                    'email' => $request->user_email,
                    'phone' => $request->user_phone,
                    'designation' => $request->user_designation,
                    'status' => $request->user_status,
                ], fn($v) => $v !== null);

                if ($request->user_password) {
                    $userData['password'] = Hash::make($request->user_password);
                }

                $branchUser->update($userData);
            }

            $branch->loadCount(['users', 'departments']);

            return response()->json([
                'message' => 'Branch updated successfully',
                'branch' => $branch,
            ]);
        });
    }

    public function destroy(Branch $branch, Request $request)
    {
        $user = $request->user();

        if ($user->client_id && $branch->client_id !== $user->client_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if ($branch->is_main) {
            return response()->json(['message' => 'Cannot delete the main branch. Set another branch as main first.'], 422);
        }

        DB::transaction(function () use ($branch) {
            $branch->users()->delete();
            $branch->delete();
        });

        return response()->json(['message' => 'Branch deleted successfully']);
    }
}
