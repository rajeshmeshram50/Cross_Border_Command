<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Masters\Countries;
use App\Models\Masters\States;
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
use App\Support\BrandingResolver;
use App\Support\Settings;

class ClientController extends Controller
{
    public function index(Request $request)
    {
        // Match the Branches list filter: exclude the auto-created "Head
        // Office" placeholder (code 'HO' or name ending in "— Head Office")
        // so the count column matches what the user sees on the Branches
        // page when they click into a client.
        $query = Client::with(['plan', 'createdBy'])
            ->withCount(['branches as branches_count' => function ($q) {
                // Exclude the auto-created Head Office branch (code='HO') so the
                // count reflects user-created branches only — see show() and
                // store/update responses below which apply the same filter.
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

        // Opt-in stats — when the caller asks (`?include_stats=1`), embed the
        // same totals/breakdown the standalone /clients/stats endpoint returns.
        // Lets the Clients list page render its KPI cards in 1 round-trip
        // instead of 2 (list + stats) without breaking the standalone endpoint
        // or other consumers that don't need stats.
        if ($request->boolean('include_stats')) {
            $stats = $this->computeStats();
            $payload = $clients->toArray();
            $payload['stats'] = $stats;
            return response()->json($payload);
        }

        return response()->json($clients);
    }

    /**
     * Shared stats computation — used by both stats() and index() with
     * include_stats=1 so the two endpoints stay in lockstep.
     */
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

    /**
     * KPI card stats for the Clients listing page. Kept as a standalone
     * endpoint for backward compatibility; new callers should prefer
     * /clients?include_stats=1 which returns list + stats in one call.
     */
    public function stats()
    {
        return response()->json($this->computeStats());
    }

    public function store(Request $request)
    {
        // Indian GSTIN / PAN are uppercase by spec — canonicalize before
        // validation so the regex + unique check + stored value all see
        // the same string.
        $this->normalizeGstPanInput($request);

        $request->validate([
            // Organization
            'org_name' => 'required|string|max:255',
            'org_type' => 'required|string|max:50|exists:organization_types,name',
            /* Org email + phone are now globally unique (case-insensitive on
             * email via the lowercase normalization in normalizeGstPanInput).
             * The Rule::unique whereNull('deleted_at') keeps a soft-deleted
             * client's email available for re-use after restore/cleanup. */
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

            // Address
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'state' => 'nullable|string|max:100',
            'country' => 'nullable|string|max:100',

            // Legal — GSTIN and PAN are globally unique business IDs.
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

            // Plan
            'plan_id' => 'nullable|exists:plans,id',
            'plan_type' => 'nullable|in:free,paid',
            'plan_expires_at' => 'nullable|date',

            // Branding
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'favicon' => 'nullable|image|mimes:jpg,jpeg,png,ico,svg,webp|max:512',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',

            // Notes
            'notes' => 'nullable|string',

            // Client Admin credentials. Admin email + phone are also
            // globally unique on the users table — same normalization
            // (lowercase + digits-only) handles the case-sensitivity
            // ask. soft-deleted rows excluded so a removed admin can
            // be re-added cleanly.
            'admin_name' => 'required|string|max:255',
            'admin_email' => ['required', 'email', Rule::unique('users', 'email')->whereNull('deleted_at')],
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
                // New clients always start as 'free' regardless of what the form sends.
                // Activating a paid plan happens via SubscriptionController::createOrder
                // → Razorpay checkout → verifyPayment → activatePlan(), which atomically
                // flips plan_type to 'paid' and grants module permissions. Allowing the
                // create form to set plan_type='paid' directly would bypass payment and
                // leave the client_admin with no permissions until they re-subscribe.
                'plan_type' => 'free',
                'status' => $request->status ?? 'inactive',
                'plan_expires_at' => $request->plan_expires_at,
                'primary_color' => $request->primary_color ?? '#4F46E5',
                'secondary_color' => $request->secondary_color ?? '#10B981',
                'notes' => $request->notes,
                'created_by' => $request->user()->id,
            ]);

            // Store relative paths so they resolve correctly across local and
            // Azure disks. URL is generated at read time via file_url().
            $brandingUpdates = [];
            if ($request->hasFile('logo')) {
                $brandingUpdates['logo'] = $request->file('logo')->store('clients/logos', 'public');
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

            // Create client admin user. We store TWO copies of the password:
            //   - `password`           — bcrypt hash, used for auth.
            //   - `password_encrypted` — reversibly-encrypted (Crypt::encryptString)
            //     so Super Admin can read the original value back when editing.
            //
            // Canonical lifecycle trigger points (Onboarding / Exit
            // Management / Promotion) live as global (client_id = NULL)
            // rows seeded by 2026_05_18_120000_consolidate_canonical_trigger_points.
            // Every tenant — including this freshly-created client — sees
            // them via the master scope's `whereNull('client_id')` clause,
            // so we no longer need to copy them into each new client's
            // own master_trigger_points partition.

            // Create client admin user
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

            // Send welcome email — gated by Settings → Notifications → newUser.
            // We dispatch TWO sends with swapped TO/CC so BOTH the organisation
            // inbox AND the client_admin user see the credentials with their
            // own address in the "To" line (not CC). Mail filters in some
            // clients route CC differently, and this pattern guarantees both
            // mailboxes treat it as a primary message. When the two addresses
            // match (case-insensitive), we collapse to a single send.
            if (Settings::shouldSendMail('newUser')) {
                $orgEmail   = trim((string) $request->email);
                $adminEmail = trim((string) $request->admin_email);
                $loginUrl   = PasswordChangedMail::resolveLoginUrl($request);

                // $orgName here is the SENDER's brand (IGC) because this
                // email is from us welcoming the new customer onto our
                // platform — NOT the new client's own org name. Branch /
                // employee welcomes flow the other way (the client welcoming
                // their own user) and pass the client's org_name instead.
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
                        // Two distinct addresses: send twice with swapped TO/CC.
                        Mail::to($orgEmail)->cc($adminEmail)->send($buildMail());
                        Mail::to($adminEmail)->cc($orgEmail)->send($buildMail());
                    } else {
                        // Same address (or org email missing): single send.
                        Mail::to($adminEmail)->send($buildMail());
                    }
                } catch (\Exception $e) {
                    // Don't fail the request if email fails
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

        // Get client admin user
        $adminUser = User::where('client_id', $client->id)
            ->where('user_type', 'client_admin')
            ->first();

        // Only super admins should receive the decrypted password. Other
        // roles (client_admin viewing their own org, etc.) get the redacted
        // payload to avoid leaking creds across tenant boundaries.
        $isSuperAdmin = optional(request()->user())->user_type === 'super_admin';
        $adminPayload = null;
        $adminPermissions = [];
        if ($adminUser) {
            $adminPayload = $adminUser->only(['id', 'name', 'email', 'phone', 'designation', 'status']);
            if ($isSuperAdmin && $adminUser->password_encrypted) {
                try {
                    $adminPayload['password_plain'] = Crypt::decryptString($adminUser->password_encrypted);
                } catch (\Throwable $e) {
                    // Decryption fails if APP_KEY rotated since the value was stored
                    // — fall through and let admin re-set the password.
                    $adminPayload['password_plain'] = null;
                }
            }

            // Embed the admin user's permissions so ClientPermissions page
            // can hydrate in 2 API calls instead of 3 (was: clients/{id} +
            // modules + permissions/user/{id} waterfall — admin id wasn't
            // known until clients/{id} resolved, forcing the waterfall).
            // Now permissions ride on the clients/{id} response, eliminating
            // the third sequential round-trip.
            $adminPermissions = \App\Models\Permission::where('user_id', $adminUser->id)
                ->with('module:id,name,slug,icon')
                ->get();
        }

        return response()->json([
            'client' => $client,
            'admin_user' => $adminPayload,
            'admin_permissions' => $adminPermissions,
        ]);
    }

    public function update(Request $request, Client $client)
    {
        $adminUser = User::where('client_id', $client->id)
            ->where('user_type', 'client_admin')
            ->first();

        // Canonicalize GSTIN / PAN to uppercase before validation.
        $this->normalizeGstPanInput($request);

        $request->validate([
            'org_name' => 'required|string|max:255',
            'org_type' => 'required|string|max:50|exists:organization_types,name',
            /* Same email + phone uniqueness as store(), with ->ignore on
             * the row being edited so saving an unchanged client doesn't
             * report itself as its own duplicate. Case-insensitive on
             * email via the lowercase normalization in
             * normalizeGstPanInput. */
            'email' => [
                'required', 'email', 'max:255',
                Rule::unique('clients', 'email')->ignore($client->id)->whereNull('deleted_at'),
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
            // plan_type cannot be flipped to 'paid' from this admin form — only
            // SubscriptionController::activatePlan() (called after a real payment)
            // is allowed to transition free → paid. Letting an admin save it here
            // would bypass billing.
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

            // Detect status transition from active → non-active. Existing user
            // sessions (Sanctum tokens) need to be revoked otherwise the login
            // guard only protects FRESH logins; users already logged in keep
            // working. Without this, admin can mark a client inactive and the
            // branch users continue accessing data with their existing tokens.
            $statusBecomingInactive = isset($payload['status'])
                && $client->status === 'active'
                && $payload['status'] !== 'active';

            $client->update($payload);

            // Replace branding files if new uploads came in. Old files are deleted
            // so we don't accumulate orphans. Old rows may store a legacy
            // "/storage/..." URL — strip the prefix before deleting.
            if ($request->hasFile('logo')) {
                if ($client->logo) {
                    Storage::disk('public')->delete($this->relativePath($client->logo));
                }
                $client->update(['logo' => $request->file('logo')->store('clients/logos', 'public')]);
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

            // Update client admin if provided
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
                    // Keep the readable mirror in sync with the new password.
                    $adminData['password_encrypted'] = Crypt::encryptString($request->admin_password);
                    $passwordChanged = true;
                }

                $adminUser->update($adminData);

                // Notify the client_admin whenever super_admin actually rotates
                // their password from the Client form. Read the post-update
                // email so a simultaneous email change goes to the new mailbox.
                if ($passwordChanged && Settings::shouldSendMail()) {
                    try {
                        // Super admin initiated this password change, so the
                        // email is FROM us (IGC) — override the recipient-
                        // based branding resolver so the email reads as a
                        // platform-side action, not the client's own org.
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
            // Revoke any live Sanctum tokens BEFORE soft-deleting users — once
            // soft-deleted, `User::tokens()->delete()` would still work but the
            // intent is clearer here and ensures no in-flight request can ride
            // on a stale token after the row is gone.
            $this->revokeAllUserTokensForClient($client->id);

            // Soft delete related users
            User::where('client_id', $client->id)->delete();
            // Soft delete branches
            Branch::where('client_id', $client->id)->delete();
            // Soft delete client
            $client->delete();
        });

        return response()->json(['message' => 'Client deleted successfully']);
    }

    /**
     * Revoke every Sanctum personal access token for every user (any role)
     * under this client. Used when the client is deactivated/suspended/deleted
     * so existing sessions are killed alongside the new-login guard. Returns
     * the count of revoked tokens (informational only).
     */
    /**
     * Indian GSTIN and PAN are uppercase by spec. Canonicalize them so the
     * regex format check, the unique check, and the stored value all see
     * the same string regardless of how the user typed it.
     */
    private function normalizeGstPanInput(Request $request): void
    {
        $patch = [];
        foreach (['gst_number', 'pan_number'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = strtoupper(trim($val));
            }
        }
        /* Lowercase + trim both email fields BEFORE validation runs so the
         * downstream Rule::unique checks become case-insensitive. Without
         * this, super admins could re-create a client with "Admin@x.com"
         * after one already existed at "admin@x.com" — Postgres treats
         * the strings as distinct and the unique constraint passes.
         * Storing lowercase keeps the auth lookup (which calls
         * strtolower on the input) consistent too. */
        foreach (['email', 'admin_email'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = strtolower(trim($val));
            }
        }
        /* Phones — strip every non-digit so "+91 98765-43210" and
         * "9876543210" collide on the unique check. The same digits-only
         * form is what we then store, so the column is the authoritative
         * normalized value. */
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

    /**
     * Normalize a stored value (legacy "/storage/..." URL or already-relative
     * path) to a disk-relative path suitable for Storage::delete().
     */
    private function relativePath(string $stored): string
    {
        if (preg_match('#^https?://#i', $stored)) {
            // Full URL stored (e.g. Azure CDN) — extract path after the host
            $path = parse_url($stored, PHP_URL_PATH) ?: '';
            $stored = ltrim($path, '/');
        }
        $stored = ltrim(str_replace('\\', '/', $stored), '/');
        if (str_starts_with($stored, 'storage/')) {
            $stored = substr($stored, strlen('storage/'));
        }
        return $stored;
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /clients/form-bundle
     *
     * Bundle every master dropdown the ClientForm needs into ONE response.
     * Replaces 4 separate round-trips:
     *   /organization-types, /plans, /master/countries, /master/states
     *
     * Cached server-side via Cache::remember (5-min TTL, per-user) — these
     * masters change rarely so the cache absorbs the bulk of repeat opens.
     * The frontend mirrors this with sessionStorage in
     * clientFormBundleCache.ts.
     *
     * Country + state status filter is case-insensitive (master_* tables
     * use 'Active' enum; clm_* tables use lowercase 'active'). Plans use
     * lowercase 'active'. Same `LOWER()` filter handles both.
     * ────────────────────────────────────────────────────────────── */
    public function formBundle(Request $request)
    {
        $user = $request->user();
        $cacheKey = 'client:form-bundle:user:' . ($user?->id ?? 'guest');

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            // Tenant safety — apply MasterVisibility::applyReadScope to every
            // master query, mirroring the gate MasterController::list() uses
            // for the canonical /master/{slug} endpoint. Per-user cache key
            // is a second line of defence.
            $scope = fn ($q) => \App\Support\MasterVisibility::applyReadScope($q, $user);

            // NOTE: states master is intentionally NOT included here.
            // It's 1797 rows (~122 KB JSON) and the user only ever sees
            // states for ONE country at a time. Shipping all of them upfront
            // was 87% of the bundle payload. The frontend now fetches
            // /master/states?country_id=X lazily after a country is picked
            // (or, in edit mode, after the saved country hydrates).
            return [
                // organization_types — uses lowercase status string
                'organization_types' => OrganizationType::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('sort_order')
                    ->orderBy('name')
                    ->get(['id', 'name', 'slug', 'icon', 'status', 'sort_order']),

                // plans — admin/SaaS-level master, lowercase status
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
