<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Masters\Countries;
use App\Models\OrganizationType;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use App\Mail\PasswordChangedMail;
use App\Mail\WelcomeCredentialsMail;
use App\Support\Settings;

class ClientController extends Controller
{
    public function index(Request $request)
    {
        $query = Client::with(['plan', 'createdBy'])
            ->withCount(['branches as branches_count' => function ($q) {
                $q->where('code', '!=', 'HO');
            }])
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

        if ($request->boolean('include_stats')) {
            $stats = $this->computeStats();
            $payload = $clients->toArray();
            $payload['stats'] = $stats;
            return response()->json($payload);
        }

        return response()->json($clients);
    }

    private function computeStats(): array
    {
        $total    = Client::count();
        $active   = Client::where('status', 'active')->count();
        $inactive = Client::where('status', '!=', 'active')->count();

        $planBreakdown = Client::leftJoin('plans', 'clients.plan_id', '=', 'plans.id')
            ->select(DB::raw("COALESCE(plans.name, 'Free') as plan_name"), DB::raw('count(*) as count'))
            ->groupBy('plan_name')
            ->orderByDesc('count')
            ->get();

        return [
            'total'           => $total,
            'active'          => $active,
            'inactive'        => $inactive,
            'plans_count'     => $planBreakdown->count(),
            'plan_breakdown'  => $planBreakdown,
        ];
    }

    public function stats()
    {
        return response()->json($this->computeStats());
    }

    public function store(Request $request)
    {
        $this->normalizeGstPanInput($request);

        $request->validate([
            'org_name' => 'required|string|max:255',
            'org_type' => 'required|string|max:50|exists:organization_types,name',
            'email' => [
                'required', 'email', 'max:255',
                Rule::unique('clients', 'email')->whereNull('deleted_at'),
            ],
            'phone' => [
                'nullable', 'string', 'max:20',
                Rule::unique('clients', 'phone')->whereNull('deleted_at'),
            ],
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

            'gst_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/',
                Rule::unique('clients', 'gst_number')->whereNull('deleted_at'),
            ],
            'pan_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/',
                Rule::unique('clients', 'pan_number')->whereNull('deleted_at'),
            ],

            'plan_id' => 'nullable|exists:plans,id',
            'plan_type' => 'nullable|in:free,paid',
            'plan_expires_at' => 'nullable|date',

            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'favicon' => 'nullable|image|mimes:jpg,jpeg,png,ico,svg,webp|max:512',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',

            'notes' => 'nullable|string',

            'admin_name' => 'required|string|max:255',
            'admin_email' => ['required', 'email'],
            'admin_phone' => [
                'nullable', 'string', 'max:20',
                Rule::unique('users', 'phone')->whereNull('deleted_at'),
            ],
            'admin_designation' => 'nullable|string|max:100',
            'admin_password' => 'required|string|min:6',
            'admin_status' => 'nullable|in:active,inactive,pending',
        ], [
            'gst_number.unique' => 'This GSTIN is already registered with another client.',
            'gst_number.regex'  => 'Invalid GSTIN format. Example: 27AADCI6120M1ZH',
            'pan_number.unique' => 'This PAN is already registered with another client.',
            'pan_number.regex'  => 'Invalid PAN format. Example: AADCI6120M',
            'email.unique'        => 'Another client is already registered with this email.',
            'phone.unique'        => 'Another client is already registered with this phone number.',
            'admin_email.unique'  => 'This email is already in use by another user. Pick a different one.',
            'admin_phone.unique'  => 'This phone number is already in use by another user.',
        ]);

        return DB::transaction(function () use ($request) {
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
                'plan_type' => 'free',
                'status' => $request->status ?? 'inactive',
                'plan_expires_at' => $request->plan_expires_at,
                'primary_color' => $request->primary_color ?? '#4F46E5',
                'secondary_color' => $request->secondary_color ?? '#10B981',
                'notes' => $request->notes,
                'created_by' => $request->user()->id,
            ]);

            $brandingUpdates = [];
            if ($request->hasFile('logo')) {
                $brandingUpdates['logo'] = $request->file('logo')->store('clients/logos', 'public');
                \App\Services\LogoDarkVariantGenerator::generate($brandingUpdates['logo']);
                \App\Services\LogoWebVariantGenerator::generate($brandingUpdates['logo']);
            }
            if ($request->hasFile('favicon')) {
                $brandingUpdates['favicon'] = $request->file('favicon')->store('clients/favicons', 'public');
            }
            if ($request->hasFile('profile_photo')) {
                $brandingUpdates['profile_photo'] = $request->file('profile_photo')->store('clients/profile-photos', 'public');
            }
            if ($brandingUpdates) {
                $client->update($brandingUpdates);
            }

            $branch = Branch::create([
                'client_id' => $client->id,
                'name' => $request->org_name . ' — Head Office',
                'code' => 'HO',
                'email' => $request->email,
                'phone' => $request->phone,
                'status' => 'active',
                'created_by' => $request->user()->id,
            ]);

            $adminUser = User::create([
                'name' => $request->admin_name,
                'email' => $request->admin_email,
                'password' => Hash::make($request->admin_password),
                'password_encrypted' => Crypt::encryptString($request->admin_password),
                'phone' => $request->admin_phone,
                'user_type' => 'client_admin',
                'client_id' => $client->id,
                'branch_id' => $branch->id,
                'status' => $request->admin_status ?? 'active',
                'designation' => $request->admin_designation,
            ]);

            $client->load(['plan', 'createdBy']);
            $client->loadCount([
                'branches as branches_count' => fn ($q) => $q->where('code', '!=', 'HO'),
                'users',
            ]);

            if (Settings::shouldSendMail('newUser')) {
                $orgEmail   = trim((string) $request->email);
                $adminEmail = trim((string) $request->admin_email);
                $loginUrl   = PasswordChangedMail::resolveLoginUrl($request);

                $buildMail = fn () => new WelcomeCredentialsMail(
                    $request->admin_name,
                    $request->admin_email,
                    $request->admin_password,
                    'client_admin',
                    config('app.vendor_name', 'Inorbvict Group of Companies'),
                    $loginUrl,
                );

                try {
                    if ($orgEmail !== '' && strcasecmp($orgEmail, $adminEmail) !== 0) {
                        Mail::to($orgEmail)->cc($adminEmail)->send($buildMail());
                        Mail::to($adminEmail)->cc($orgEmail)->send($buildMail());
                    } else {
                        Mail::to($adminEmail)->send($buildMail());
                    }
                } catch (\Exception $e) {
                }
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
        $client->loadCount([
            'branches as branches_count' => fn ($q) => $q->where('code', '!=', 'HO'),
            'users',
        ]);

        $adminUser = User::where('client_id', $client->id)
            ->where('user_type', 'client_admin')
            ->first();

        $isSuperAdmin = optional(request()->user())->user_type === 'super_admin';
        $adminPayload = null;
        $adminPermissions = [];
        if ($adminUser) {
            $adminPayload = $adminUser->only(['id', 'name', 'email', 'phone', 'designation', 'status']);
            if ($isSuperAdmin && $adminUser->password_encrypted) {
                try {
                    $adminPayload['password_plain'] = Crypt::decryptString($adminUser->password_encrypted);
                } catch (\Throwable $e) {
                    $adminPayload['password_plain'] = null;
                }
            }

            $adminPermissions = \App\Models\Permission::where('user_id', $adminUser->id)
                ->with('module:id,name,slug,icon')
                ->get();
        }

        $states = [];
        try {
            if ($client->country) {
                $country = \App\Models\Masters\Countries::query()
                    ->where('name', $client->country)
                    ->first(['id']);
                if ($country) {
                    $states = \App\Models\Masters\States::query()
                        ->where('country_id', $country->id)
                        ->orderBy('name')
                        ->get(['id', 'country_id', 'name', 'status']);
                }
            }
        } catch (\Throwable $e) {
            \Log::warning('ClientController::show states bundle failed: ' . $e->getMessage());
        }

        return response()->json([
            'client' => $client,
            'admin_user' => $adminPayload,
            'admin_permissions' => $adminPermissions,
            'states' => $states,
        ]);
    }

    public function update(Request $request, Client $client)
    {
        $adminUser = User::where('client_id', $client->id)
            ->where('user_type', 'client_admin')
            ->first();

        $this->normalizeGstPanInput($request);

        $request->validate([
            'org_name' => 'required|string|max:255',
            'org_type' => 'required|string|max:50|exists:organization_types,name',
            'email' => [
                'required', 'email', 'max:255',
                Rule::unique('clients', 'email')->ignore($client->id)->whereNull('deleted_at'),
                new \App\Rules\UniqueSystemEmail('person', $client->id),
            ],
            'phone' => [
                'nullable', 'string', 'max:20',
                Rule::unique('clients', 'phone')->ignore($client->id)->whereNull('deleted_at'),
            ],
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
            'gst_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/',
                Rule::unique('clients', 'gst_number')->ignore($client->id)->whereNull('deleted_at'),
            ],
            'pan_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/',
                Rule::unique('clients', 'pan_number')->ignore($client->id)->whereNull('deleted_at'),
            ],
            'plan_id' => 'nullable|exists:plans,id',
            'plan_type' => 'nullable|in:free,paid',
            'plan_expires_at' => 'nullable|date',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'favicon' => 'nullable|image|mimes:jpg,jpeg,png,ico,svg,webp|max:512',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            'notes' => 'nullable|string',
            'admin_name' => 'nullable|string|max:255',
            'admin_email' => ['nullable', 'email', Rule::unique('users', 'email')->ignore($adminUser?->id)->whereNull('deleted_at')],
            'admin_phone' => [
                'nullable', 'string', 'max:20',
                Rule::unique('users', 'phone')->ignore($adminUser?->id)->whereNull('deleted_at'),
            ],
            'admin_designation' => 'nullable|string|max:100',
            'admin_password' => 'nullable|string|min:6',
            'admin_status' => 'nullable|in:active,inactive,pending',
        ], [
            'gst_number.unique' => 'This GSTIN is already registered with another client.',
            'gst_number.regex'  => 'Invalid GSTIN format. Example: 27AADCI6120M1ZH',
            'pan_number.unique' => 'This PAN is already registered with another client.',
            'pan_number.regex'  => 'Invalid PAN format. Example: AADCI6120M',
            'email.unique'        => 'Another client is already registered with this email.',
            'phone.unique'        => 'Another client is already registered with this phone number.',
            'admin_email.unique'  => 'This email is already in use by another user. Pick a different one.',
            'admin_phone.unique'  => 'This phone number is already in use by another user.',
        ]);

        return DB::transaction(function () use ($request, $client, $adminUser) {
            $payload = $request->only([
                'org_name', 'email', 'phone', 'website',
                'address', 'city', 'state', 'district', 'taluka', 'pincode', 'country',
                'org_type', 'sports', 'industry', 'gst_number', 'pan_number',
                'plan_id', 'plan_type', 'status', 'plan_expires_at',
                'primary_color', 'secondary_color', 'notes',
            ]);
            if (isset($payload['plan_type']) && $payload['plan_type'] === 'paid' && $client->plan_type !== 'paid') {
                unset($payload['plan_type']);
            }

            $statusBecomingInactive = isset($payload['status'])
                && $client->status === 'active'
                && $payload['status'] !== 'active';

            $client->update($payload);

            if ($request->hasFile('logo')) {
                if ($client->logo) {
                    \App\Services\LogoDarkVariantGenerator::delete($this->relativePath($client->logo));
                    \App\Services\LogoWebVariantGenerator::delete($this->relativePath($client->logo));
                    Storage::disk('public')->delete($this->relativePath($client->logo));
                }
                $logoPath = $request->file('logo')->store('clients/logos', 'public');
                $client->update(['logo' => $logoPath]);
                \App\Services\LogoDarkVariantGenerator::generate($logoPath);
                \App\Services\LogoWebVariantGenerator::generate($logoPath);
            }
            if ($request->hasFile('favicon')) {
                if ($client->favicon) {
                    Storage::disk('public')->delete($this->relativePath($client->favicon));
                }
                $client->update(['favicon' => $request->file('favicon')->store('clients/favicons', 'public')]);
            }
            if ($request->hasFile('profile_photo')) {
                if ($client->profile_photo) {
                    Storage::disk('public')->delete($this->relativePath($client->profile_photo));
                }
                $client->update(['profile_photo' => $request->file('profile_photo')->store('clients/profile-photos', 'public')]);
            }

            if ($statusBecomingInactive) {
                $this->revokeAllUserTokensForClient($client->id);
            }

            if ($adminUser && $request->admin_name) {
                $adminData = array_filter([
                    'name' => $request->admin_name,
                    'email' => $request->admin_email,
                    'phone' => $request->admin_phone,
                    'designation' => $request->admin_designation,
                    'status' => $request->admin_status,
                ], fn($v) => $v !== null);

                $passwordChanged = false;
                if ($request->admin_password) {
                    $adminData['password'] = Hash::make($request->admin_password);
                    $adminData['password_encrypted'] = Crypt::encryptString($request->admin_password);
                    $passwordChanged = true;
                }

                $adminUser->update($adminData);

                if ($passwordChanged && Settings::shouldSendMail()) {
                    try {
                        Mail::to($adminUser->email)->send(new PasswordChangedMail(
                            $adminUser->name,
                            $adminUser->email,
                            $request->admin_password,
                            PasswordChangedMail::resolveLoginUrl($request),
                            ['brandName' => config('app.vendor_name', 'Inorbvict Group of Companies')],
                        ));
                    } catch (\Throwable $e) {
                        Log::warning('Password-changed confirmation mail failed (client admin update)', [
                            'user_id' => $adminUser->id,
                            'email'   => $adminUser->email,
                            'error'   => $e->getMessage(),
                        ]);
                    }
                }
            }

            $client->load(['plan', 'createdBy']);
            $client->loadCount([
                'branches as branches_count' => fn ($q) => $q->where('code', '!=', 'HO'),
                'users',
            ]);

            return response()->json([
                'message' => 'Client updated successfully',
                'client' => $client,
            ]);
        });
    }

    public function destroy(Client $client)
    {
        DB::transaction(function () use ($client) {
            $this->revokeAllUserTokensForClient($client->id);

            User::where('client_id', $client->id)->delete();
            Branch::where('client_id', $client->id)->delete();
            $client->delete();
        });

        return response()->json(['message' => 'Client deleted successfully']);
    }

    private function normalizeGstPanInput(Request $request): void
    {
        $patch = [];
        foreach (['gst_number', 'pan_number'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = strtoupper(trim($val));
            }
        }
        foreach (['email', 'admin_email'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = strtolower(trim($val));
            }
        }
        foreach (['phone', 'admin_phone'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = preg_replace('/\D/', '', $val) ?? '';
            }
        }
        if ($patch) $request->merge($patch);
    }

    private function revokeAllUserTokensForClient(int $clientId): int
    {
        $userIds = User::where('client_id', $clientId)->pluck('id');
        if ($userIds->isEmpty()) return 0;

        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->whereIn('tokenable_id', $userIds)
            ->delete();
    }

    private function relativePath(string $stored): string
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

    public function formBundle(Request $request)
    {
        $user = $request->user();
        $cacheKey = \App\Support\MasterBundleCache::key('client:form-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            $scope = fn ($q) => \App\Support\MasterVisibility::applyReadScope($q, $user);

            return [
                'organization_types' => OrganizationType::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('sort_order')
                    ->orderBy('name')
                    ->get(['id', 'name', 'slug', 'icon', 'status', 'sort_order']),

                'plans' => Plan::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('sort_order')
                    ->orderBy('id')
                    ->get(['id', 'name', 'slug', 'price', 'period', 'status', 'trial_days', 'is_featured', 'sort_order']),

                'countries' => Countries::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('name')
                    ->get(['id', 'name', 'iso_code', 'status']),
            ];
        });

        return response()->json($bundle);
    }
}
