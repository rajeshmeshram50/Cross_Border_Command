<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use App\Mail\WelcomeCredentialsMail;

class ClientController extends Controller
{
    public function index(Request $request)
    {
        $query = Client::with(['plan', 'createdBy'])
            ->withCount('branches')
            ->withCount('users');

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('org_name', 'ilike', "%{$search}%")
                  ->orWhere('unique_number', 'ilike', "%{$search}%")
                  ->orWhere('email', 'ilike', "%{$search}%");
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $clients = $query->orderBy('created_at', 'desc')->paginate($request->query('per_page', 15));

        return response()->json($clients);
    }

    public function store(Request $request)
    {
        $request->validate([
            // Organization
            'org_name' => 'required|string|max:255',
            'org_type' => 'required|string|max:50|exists:organization_types,name',
            'email' => 'required|email|max:255',
            'phone' => 'nullable|string|max:20',
            'website' => 'nullable|string|max:500',
            'status' => 'required|in:active,inactive,suspended',
            'sports' => 'nullable|string|max:100',
            'industry' => 'nullable|string|max:100',

            // Address
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'state' => 'nullable|string|max:100',
            'country' => 'nullable|string|max:100',

            // Legal
            'gst_number' => 'nullable|string|max:20',
            'pan_number' => 'nullable|string|max:20',

            // Plan
            'plan_id' => 'nullable|exists:plans,id',
            'plan_type' => 'nullable|in:free,paid',
            'plan_expires_at' => 'nullable|date',

            // Branding
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',

            // Notes
            'notes' => 'nullable|string',

            // Client Admin credentials
            'admin_name' => 'required|string|max:255',
            'admin_email' => 'required|email|unique:users,email',
            'admin_phone' => 'nullable|string|max:20',
            'admin_designation' => 'nullable|string|max:100',
            'admin_password' => 'required|string|min:6',
            'admin_status' => 'nullable|in:active,inactive,pending',
        ]);

        return DB::transaction(function () use ($request) {
            // Generate unique number: EA + timestamp
            $unique = 'EA' . strtoupper(substr($request->org_name, 0, 2)) . now()->format('ymdHis');

            $client = Client::create([
                'org_name' => $request->org_name,
                'unique_number' => $unique,
                'email' => $request->email,
                'phone' => $request->phone,
                'website' => $request->website,
                'address' => $request->address,
                'city' => $request->city,
                'state' => $request->state,
                'district' => $request->district,
                'taluka' => $request->taluka,
                'pincode' => $request->pincode,
                'country' => $request->country ?? 'India',
                'org_type' => $request->org_type,
                'sports' => $request->sports,
                'industry' => $request->industry,
                'gst_number' => $request->gst_number,
                'pan_number' => $request->pan_number,
                'plan_id' => $request->plan_id,
                'plan_type' => $request->plan_type ?? 'free',
                'status' => $request->status ?? 'inactive',
                'plan_expires_at' => $request->plan_expires_at,
                'primary_color' => $request->primary_color ?? '#4F46E5',
                'secondary_color' => $request->secondary_color ?? '#10B981',
                'notes' => $request->notes,
                'created_by' => $request->user()->id,
            ]);

            // Create default branch (NOT main — main is set manually by client)
            $branch = Branch::create([
                'client_id' => $client->id,
                'name' => $request->org_name . ' — Head Office',
                'code' => 'HO',
                'email' => $request->email,
                'phone' => $request->phone,
                'is_main' => false,
                'status' => 'active',
                'created_by' => $request->user()->id,
            ]);

            // Create client admin user
            $adminUser = User::create([
                'name' => $request->admin_name,
                'email' => $request->admin_email,
                'password' => Hash::make($request->admin_password),
                'phone' => $request->admin_phone,
                'user_type' => 'client_admin',
                'client_id' => $client->id,
                'branch_id' => $branch->id,
                'status' => $request->admin_status ?? 'active',
                'designation' => $request->admin_designation,
            ]);

            $client->load(['plan', 'createdBy']);
            $client->loadCount(['branches', 'users']);

            // Send welcome email
            try {
                Mail::to($request->admin_email)->send(new WelcomeCredentialsMail(
                    $request->admin_name,
                    $request->admin_email,
                    $request->admin_password,
                    'client_admin',
                    $request->org_name,
                ));
            } catch (\Exception $e) {
                // Don't fail the request if email fails
            }

            return response()->json([
                'message' => 'Client created successfully',
                'client' => $client,
                'admin_user' => $adminUser->only(['id', 'name', 'email', 'user_type', 'status']),
            ], 201);
        });
    }

    public function show(Client $client)
    {
        $client->load(['plan', 'createdBy']);
        $client->loadCount(['branches', 'users']);

        // Get client admin user
        $adminUser = User::where('client_id', $client->id)
            ->where('user_type', 'client_admin')
            ->first();

        return response()->json([
            'client' => $client,
            'admin_user' => $adminUser ? $adminUser->only(['id', 'name', 'email', 'phone', 'designation', 'status']) : null,
        ]);
    }

    public function update(Request $request, Client $client)
    {
        $adminUser = User::where('client_id', $client->id)
            ->where('user_type', 'client_admin')
            ->first();

        $request->validate([
            'org_name' => 'required|string|max:255',
            'org_type' => 'required|string|max:50|exists:organization_types,name',
            'email' => 'required|email|max:255',
            'phone' => 'nullable|string|max:20',
            'website' => 'nullable|string|max:500',
            'status' => 'required|in:active,inactive,suspended',
            'sports' => 'nullable|string|max:100',
            'industry' => 'nullable|string|max:100',
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'state' => 'nullable|string|max:100',
            'country' => 'nullable|string|max:100',
            'gst_number' => 'nullable|string|max:20',
            'pan_number' => 'nullable|string|max:20',
            'plan_id' => 'nullable|exists:plans,id',
            'plan_type' => 'nullable|in:free,paid',
            'plan_expires_at' => 'nullable|date',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
            'notes' => 'nullable|string',
            'admin_name' => 'nullable|string|max:255',
            'admin_email' => 'nullable|email|unique:users,email,' . ($adminUser?->id ?? 'NULL'),
            'admin_phone' => 'nullable|string|max:20',
            'admin_designation' => 'nullable|string|max:100',
            'admin_password' => 'nullable|string|min:6',
            'admin_status' => 'nullable|in:active,inactive,pending',
        ]);

        return DB::transaction(function () use ($request, $client, $adminUser) {
            $client->update($request->only([
                'org_name', 'email', 'phone', 'website',
                'address', 'city', 'state', 'district', 'taluka', 'pincode', 'country',
                'org_type', 'sports', 'industry', 'gst_number', 'pan_number',
                'plan_id', 'plan_type', 'status', 'plan_expires_at',
                'primary_color', 'secondary_color', 'notes',
            ]));

            // Update client admin if provided
            if ($adminUser && $request->admin_name) {
                $adminData = array_filter([
                    'name' => $request->admin_name,
                    'email' => $request->admin_email,
                    'phone' => $request->admin_phone,
                    'designation' => $request->admin_designation,
                    'status' => $request->admin_status,
                ], fn($v) => $v !== null);

                if ($request->admin_password) {
                    $adminData['password'] = Hash::make($request->admin_password);
                }

                $adminUser->update($adminData);
            }

            $client->load(['plan', 'createdBy']);
            $client->loadCount(['branches', 'users']);

            return response()->json([
                'message' => 'Client updated successfully',
                'client' => $client,
            ]);
        });
    }

    public function destroy(Client $client)
    {
        DB::transaction(function () use ($client) {
            // Soft delete related users
            User::where('client_id', $client->id)->delete();
            // Soft delete branches
            Branch::where('client_id', $client->id)->delete();
            // Soft delete client
            $client->delete();
        });

        return response()->json(['message' => 'Client deleted successfully']);
    }
}
