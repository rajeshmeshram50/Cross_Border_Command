<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Masters\Countries;
use App\Models\Masters\States;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Illuminate\Database\QueryException;
use App\Mail\PasswordChangedMail;
use App\Mail\WelcomeCredentialsMail;
use App\Support\BrandingResolver;

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
 
        
        if (!$request->boolean('include_head_office')) {
            $query->where(function ($q) {
                $q->where('code', '!=', 'HO')
                  ->orWhere('name', 'not ilike', '% — Head Office');
            });
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


        if ($branchFilter = $request->integer('branch_id') ?: null) {
            $belongsToClient = $clientId
                ? Branch::where('id', $branchFilter)->where('client_id', $clientId)->exists()
                : true;  // super_admin can target any branch
            if ($belongsToClient) {
                $query->where('id', $branchFilter);
            }
        }

        $branches = $query->orderBy('name')
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

        // Normalize GST/PAN to uppercase before validation so the unique
        // check is case-canonical (Indian GSTIN/PAN are uppercase).
        $this->normalizeGstPanInput($request);

        $request->validate([
            'name' => [
                'required', 'string', 'max:255',
                Rule::unique('branches', 'name')
                    ->where(fn ($q) => $q->where('client_id', $clientId))
                    ->whereNull('deleted_at'),
            ],
            'code' => 'nullable|string|max:50',
            'email' => 'nullable|email|max:255',
            'phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'website' => ['nullable', 'string', 'max:500', 'regex:/^(https?:\/\/)?(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/[^\s]*)?$/i'],
            'contact_person' => 'nullable|string|max:255',
            'branch_type' => 'nullable|string|max:50',
            'industry' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'gst_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/',
                Rule::unique('branches', 'gst_number')
                    ->where(fn ($q) => $q->where('client_id', $clientId))
                    ->whereNull('deleted_at'),
            ],
            'pan_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/',
                Rule::unique('branches', 'pan_number')
                    ->where(fn ($q) => $q->where('client_id', $clientId))
                    ->whereNull('deleted_at'),
            ],
            'registration_number' => 'nullable|string|max:50',
            // Letterhead / export-house compliance fields — all optional,
            // surface on the Quotation/PI PDF when filled.
            'gst_state_code'   => 'nullable|string|max:10',
            'cin'              => 'nullable|string|max:30',
            'iec'              => 'nullable|string|max:30',
            'drug_license'     => 'nullable|string|max:60',
            'pcpndt_no'        => 'nullable|string|max:60',
            'aeo_code'         => 'nullable|string|max:60',
            'one_star_file_no' => 'nullable|string|max:60',
            'one_star_udin_no' => 'nullable|string|max:60',
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'country' => 'nullable|string|max:100',
            'max_users' => 'nullable|integer|min:0',
            'established_at' => 'nullable|date',
            'status' => 'required|in:active,inactive',
            'notes' => 'nullable|string',
            // Work shifts repeater — arrives as a JSON string on multipart
            // uploads and as a real array on JSON requests; normalised below.
            'shifts' => 'nullable',
            // Bank accounts repeater (Legal & Registration) — same transport.
            'bank_accounts' => 'nullable',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            // Authorised-signatory image (signature + stamp combined).
            // Goes on the with-signature PDF variant. PNG preferred so
            // transparent background blends with the branded footer.
            'signature_path' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:2048',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',

            // Branch user login credentials
            'user_name' => 'required|string|max:255',
            // Email is unique PER TENANT — scope the dup check to THIS branch's
            // client so the same email used in a different client doesn't block
            // creation here. Matches the users_email_client_unique DB index.
            'user_email' => ['required', 'email', Rule::unique('users', 'email')->where(fn ($q) => $q->where('client_id', $clientId))->whereNull('deleted_at')],
            'user_phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'user_designation' => 'nullable|string|max:100',
            'user_password' => 'required|string|min:6',
            'user_status' => 'nullable|in:active,inactive,pending',
        ], [
            'gst_number.unique' => 'This GSTIN is already registered to another branch.',
            'gst_number.regex'  => 'Invalid GSTIN format. Example: 27AADCI6120M1ZH',
            'pan_number.unique' => 'This PAN is already registered to another branch.',
            'pan_number.regex'  => 'Invalid PAN format. Example: AADCI6120M',
        ]);

        try {
            return DB::transaction(function () use ($request, $clientId, $user) {
            // Auto-allocate BR-### when the user didn't supply a code.
            // Race-safe — allocateBranchCode() uses lockForUpdate() inside
            // the surrounding transaction so two concurrent creates can't
            // both grab the same number.
            $branchCode = trim((string) $request->code);
            if ($branchCode === '') {
                $branchCode = $this->allocateBranchCode($clientId);
            }

            $branch = Branch::create([
                'client_id' => $clientId,
                'name' => $request->name,
                'code' => $branchCode,
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
                'gst_state_code'   => $request->gst_state_code,
                'cin'              => $request->cin,
                'iec'              => $request->iec,
                'drug_license'     => $request->drug_license,
                'pcpndt_no'        => $request->pcpndt_no,
                'aeo_code'         => $request->aeo_code,
                'one_star_file_no' => $request->one_star_file_no,
                'one_star_udin_no' => $request->one_star_udin_no,
                'address' => $request->address,
                'city' => $request->city,
                'district' => $request->district,
                'taluka' => $request->taluka,
                'state' => $request->state,
                'pincode' => $request->pincode,
                'country' => $request->country ?? 'India',
                'max_users' => $request->max_users ?? 0,
                'established_at' => $request->established_at,
                'status' => $request->status ?? 'active',
                'notes' => $request->notes,
                'shifts' => $this->normalizeShifts($request->input('shifts')),
                'bank_accounts' => $this->normalizeBankAccounts($request->input('bank_accounts')),
                'primary_color' => $request->primary_color,
                'secondary_color' => $request->secondary_color,
                'created_by' => $user->id,
            ]);

            // Store relative path so it resolves correctly across local and
            // Azure disks. URL is generated at read time via file_url().
            if ($request->hasFile('logo')) {
                $logoPath = $request->file('logo')->store('branches/logos', 'public');
                $branch->update(['logo' => $logoPath]);
                \App\Services\LogoDarkVariantGenerator::generate($logoPath);
            }
            if ($request->hasFile('profile_photo')) {
                $branch->update([
                    'profile_photo' => $request->file('profile_photo')->store('branches/profile-photos', 'public'),
                ]);
            }
            // Authorised-signatory image — used by the Quotation/PI PDF's
            // with-signature variant. PNG with transparent background works
            // best because the stamp + signature sit on the branded footer.
            if ($request->hasFile('signature_path')) {
                $branch->update([
                    'signature_path' => $request->file('signature_path')->store('branches/signatures', 'public'),
                ]);
            }

            // Create branch user. We store TWO copies of the password:
            //   - `password`           — bcrypt hash, used for auth.
            //   - `password_encrypted` — reversibly encrypted (Crypt::encryptString)
            //     so Super Admin / Client Admin can read the original on edit.
            $branchUser = User::create([
                'name' => $request->user_name,
                'email' => $request->user_email,
                'password' => Hash::make($request->user_password),
                'password_encrypted' => Crypt::encryptString($request->user_password),
                'phone' => $request->user_phone,
                'user_type' => 'branch_user',
                'client_id' => $clientId,
                'branch_id' => $branch->id,
                'status' => $request->user_status ?? 'active',
                'designation' => $request->user_designation,
            ]);

            $branch->loadCount(['users', 'departments']);

            // Send welcome email — gated by Settings → Notifications →
            // newUser (and the master emailNotif). Non-fatal so branch
            // creation succeeds even if mail fails or is disabled. When it
            // DOES fail, the reason is bubbled up in $mailWarning so the UI
            // can tell the admin the credentials email didn't go out (and
            // why) instead of silently logging it.
            $mailWarning = null;
            if (Settings::shouldSendMail('newUser')) {
                try {
                    $clientName = \App\Models\Client::find($clientId)?->org_name ?? 'Your Organization';

                    /* Mail goes to the branch USER who'll actually log in
                     * (user_email), and is CC'd to the branch's own
                     * organisation inbox (the `email` field on the
                     * Branch Details form, e.g. ops@gurgaon.acme.com)
                     * when one was provided AND it's a different
                     * mailbox from the user. That gives the branch
                     * admin / operations inbox a record of the
                     * credentials handover without duplicating the
                     * message to the same address. */
                    $branchEmail = trim((string) $request->email);
                    $userEmail   = trim((string) $request->user_email);
                    $mail = Mail::to($userEmail);
                    if ($branchEmail !== '' && strcasecmp($branchEmail, $userEmail) !== 0) {
                        $mail = $mail->cc($branchEmail);
                    }
                    $mail->send(new WelcomeCredentialsMail(
                        $request->user_name,
                        $request->user_email,
                        $request->user_password,
                        'branch_user',
                        $clientName,
                        PasswordChangedMail::resolveLoginUrl($request),
                    ));
                } catch (\Exception $e) {
                    Log::warning('Branch welcome mail failed', [
                        'branch_id' => $branch->id,
                        'user_email' => $request->user_email,
                        'branch_email' => $request->email,
                        'error' => $e->getMessage(),
                    ]);
                    $mailWarning = 'Branch created, but the welcome email could not be sent to '
                        . $request->user_email . ': ' . $e->getMessage();
                }
            }

            return response()->json([
                'message' => 'Branch created successfully',
                'branch' => $branch,
                'branch_user' => $branchUser->only(['id', 'name', 'email', 'user_type', 'status']),
                // null when the mail sent fine (or notifications are off);
                // otherwise the exact reason the welcome email failed.
                'mail_warning' => $mailWarning,
            ], 201);
            });
        } catch (QueryException $e) {
            if ($this->isUniqueEmailViolation($e)) {
                throw ValidationException::withMessages([
                    'user_email' => ['This email is already registered. Please use a different email.'],
                ]);
            }
            throw $e;
        }
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

        // Super Admin AND the owning Client Admin (managing their own branches)
        // both get the decrypted password back so they can review/edit it.
        // Anyone else (other client_admin, branch_user, etc.) gets the
        // redacted payload — no cross-tenant credential leakage.
        $canReadPassword = $user && (
            $user->user_type === 'super_admin'
            || ($user->user_type === 'client_admin' && $user->client_id === $branch->client_id)
        );
        $userPayload = null;
        if ($branchUser) {
            $userPayload = $branchUser->only(['id', 'name', 'email', 'phone', 'designation', 'status']);
            if ($canReadPassword && $branchUser->password_encrypted) {
                try {
                    $userPayload['password_plain'] = Crypt::decryptString($branchUser->password_encrypted);
                } catch (\Throwable $e) {
                    // APP_KEY rotated since the value was stored — fall through
                    // and let the admin set a fresh password.
                    $userPayload['password_plain'] = null;
                }
            }
        }

        return response()->json([
            'branch' => $branch,
            'branch_user' => $userPayload,
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

        // Normalize GST/PAN to uppercase before validation so the unique
        // check matches case-insensitively (Indian GSTIN/PAN are uppercase).
        $this->normalizeGstPanInput($request);

        // Only enforce per-client name uniqueness when the user is actually
        // RENAMING the branch. If the name is unchanged we skip the check —
        // otherwise legacy duplicates (created before the rule existed) trap
        // users editing unrelated fields like country/state.
        $nameRules = ['required', 'string', 'max:255'];
        if ($request->input('name') !== $branch->name) {
            $nameRules[] = Rule::unique('branches', 'name')
                ->ignore($branch->id)
                ->where(fn ($q) => $q->where('client_id', $branch->client_id))
                ->whereNull('deleted_at');
        }

        $request->validate([
            'name' => $nameRules,
            'code' => 'nullable|string|max:50',
            'email' => 'nullable|email|max:255',
            'phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'website' => ['nullable', 'string', 'max:500', 'regex:/^(https?:\/\/)?(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/[^\s]*)?$/i'],
            'contact_person' => 'nullable|string|max:255',
            'branch_type' => 'nullable|string|max:50',
            'industry' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'gst_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/',
                Rule::unique('branches', 'gst_number')
                    ->ignore($branch->id)
                    ->where(fn ($q) => $q->where('client_id', $branch->client_id))
                    ->whereNull('deleted_at'),
            ],
            'pan_number' => [
                'nullable', 'string', 'max:20',
                'regex:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/',
                Rule::unique('branches', 'pan_number')
                    ->ignore($branch->id)
                    ->where(fn ($q) => $q->where('client_id', $branch->client_id))
                    ->whereNull('deleted_at'),
            ],
            'registration_number' => 'nullable|string|max:50',
            'gst_state_code'   => 'nullable|string|max:10',
            'cin'              => 'nullable|string|max:30',
            'iec'              => 'nullable|string|max:30',
            'drug_license'     => 'nullable|string|max:60',
            'pcpndt_no'        => 'nullable|string|max:60',
            'aeo_code'         => 'nullable|string|max:60',
            'one_star_file_no' => 'nullable|string|max:60',
            'one_star_udin_no' => 'nullable|string|max:60',
            'address' => 'nullable|string',
            'city' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'taluka' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'pincode' => 'nullable|string|max:10',
            'country' => 'nullable|string|max:100',
            'max_users' => 'nullable|integer|min:0',
            'established_at' => 'nullable|date',
            'status' => 'required|in:active,inactive',
            'notes' => 'nullable|string',
            // Work shifts repeater — JSON string on multipart, array on JSON.
            'shifts' => 'nullable',
            // Bank accounts repeater (Legal & Registration) — same transport.
            'bank_accounts' => 'nullable',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            // Authorised-signatory image (signature + stamp combined).
            // Goes on the with-signature PDF variant. PNG preferred so
            // transparent background blends with the branded footer.
            'signature_path' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:2048',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
            'user_name' => 'nullable|string|max:255',
            'user_email' => ['nullable', 'email', Rule::unique('users', 'email')->ignore($branchUser?->id)->where(fn ($q) => $q->where('client_id', $branch->client_id))->whereNull('deleted_at')],
            'user_phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'user_designation' => 'nullable|string|max:100',
            'user_password' => 'nullable|string|min:6',
            'user_status' => 'nullable|in:active,inactive,pending',
        ], [
            'gst_number.unique' => 'This GSTIN is already registered to another branch.',
            'gst_number.regex'  => 'Invalid GSTIN format. Example: 27AADCI6120M1ZH',
            'pan_number.unique' => 'This PAN is already registered to another branch.',
            'pan_number.regex'  => 'Invalid PAN format. Example: AADCI6120M',
        ]);

        try {
            return DB::transaction(function () use ($request, $branch, $branchUser) {
            // Detect status transition from active → inactive. Existing user
            // sessions need to be revoked otherwise the login guard only blocks
            // FRESH logins; users already logged in keep working with their
            // existing Sanctum tokens.
            $statusBecomingInactive = $request->filled('status')
                && $branch->status === 'active'
                && $request->input('status') !== 'active';

            // Reverse transition — when an admin flips an inactive branch
            // back to active we need to restore the users / employees
            // we soft-deleted during the deactivation cascade. Otherwise
            // the branch returns "live" but with zero people in it.
            $statusBecomingActive = $request->filled('status')
                && $branch->status !== 'active'
                && $request->input('status') === 'active';

            $branch->update($request->only([
                'name', 'code', 'email', 'phone', 'website', 'contact_person',
                'branch_type', 'industry', 'description',
                'gst_number', 'pan_number', 'registration_number',
                'gst_state_code', 'cin', 'iec',
                'drug_license', 'pcpndt_no', 'aeo_code',
                'one_star_file_no', 'one_star_udin_no',
                'address', 'city', 'district', 'taluka', 'state', 'pincode', 'country',
                'max_users', 'established_at', 'status', 'notes',
                'primary_color', 'secondary_color',
            ]));

            // Shifts / bank accounts handled separately — the array cast would
            // double-encode the JSON string that arrives on multipart uploads.
            if ($request->has('shifts')) {
                $branch->update(['shifts' => $this->normalizeShifts($request->input('shifts'))]);
            }
            if ($request->has('bank_accounts')) {
                $branch->update(['bank_accounts' => $this->normalizeBankAccounts($request->input('bank_accounts'))]);
            }

            if ($request->hasFile('logo')) {
                if ($branch->logo) {
                    \App\Services\LogoDarkVariantGenerator::delete($this->relativePath($branch->logo));
                    Storage::disk('public')->delete($this->relativePath($branch->logo));
                }
                $logoPath = $request->file('logo')->store('branches/logos', 'public');
                $branch->update(['logo' => $logoPath]);
                \App\Services\LogoDarkVariantGenerator::generate($logoPath);
            }
            if ($request->hasFile('profile_photo')) {
                if ($branch->profile_photo) {
                    Storage::disk('public')->delete($this->relativePath($branch->profile_photo));
                }
                $branch->update(['profile_photo' => $request->file('profile_photo')->store('branches/profile-photos', 'public')]);
            }
            // Replace the signature image when a new file comes in;
            // the old one is deleted from storage so we don't leak files.
            if ($request->hasFile('signature_path')) {
                if ($branch->signature_path) {
                    Storage::disk('public')->delete($this->relativePath($branch->signature_path));
                }
                $branch->update(['signature_path' => $request->file('signature_path')->store('branches/signatures', 'public')]);
            }

            if ($statusBecomingInactive) {
                $this->revokeAllUserTokensForBranch($branch->id);
                // Mirror the deactivation cascade so newly-disabled
                // branches don't leave their users / employees alive in
                // an inactive container.
                User::where('branch_id', $branch->id)->delete();
                Employee::where('branch_id', $branch->id)->delete();
            }

            if ($statusBecomingActive) {
                // Bring back the people who were soft-deleted when the
                // branch was deactivated. We can't tell apart "deleted
                // because the branch was deactivated" from "deleted for
                // their own reasons", so the restore is conservative:
                // only rows whose deleted_at falls within the branch's
                // current inactive window are restored.
                User::withTrashed()->where('branch_id', $branch->id)->restore();
                Employee::withTrashed()->where('branch_id', $branch->id)->restore();
            }

            // Update branch user if provided
            if ($branchUser && $request->user_name) {
                $userData = array_filter([
                    'name' => $request->user_name,
                    'email' => $request->user_email,
                    'phone' => $request->user_phone,
                    'designation' => $request->user_designation,
                    'status' => $request->user_status,
                ], fn($v) => $v !== null);

                $passwordChanged = false;
                if ($request->user_password) {
                    $userData['password'] = Hash::make($request->user_password);
                    // Keep the readable mirror in sync with the new password.
                    $userData['password_encrypted'] = Crypt::encryptString($request->user_password);
                    $passwordChanged = true;
                }

                $branchUser->update($userData);

                // Confirmation mail goes to the branch user whenever the
                // admin actually rotates their password from the Branch form.
                // Use the post-update email so a simultaneous email change
                // delivers to the new mailbox, not the stale one.
                if ($passwordChanged && Settings::shouldSendMail()) {
                    try {
                        Mail::to($branchUser->email)->send(new PasswordChangedMail(
                            $branchUser->name,
                            $branchUser->email,
                            $request->user_password,
                            PasswordChangedMail::resolveLoginUrl($request),
                            BrandingResolver::forUser($branchUser),
                        ));
                    } catch (\Throwable $e) {
                        Log::warning('Password-changed confirmation mail failed (branch update)', [
                            'user_id' => $branchUser->id,
                            'email'   => $branchUser->email,
                            'error'   => $e->getMessage(),
                        ]);
                    }
                }
            }

            $branch->loadCount(['users', 'departments']);

            return response()->json([
                'message' => 'Branch updated successfully',
                'branch' => $branch,
            ]);
            });
        } catch (QueryException $e) {
            if ($this->isUniqueEmailViolation($e)) {
                throw ValidationException::withMessages([
                    'user_email' => ['This email is already registered. Please use a different email.'],
                ]);
            }
            throw $e;
        }
    }

    private function isUniqueEmailViolation(QueryException $e): bool
    {
        return $e->getCode() === '23505'
            && str_contains($e->getMessage(), 'users_email_unique');
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
        if ($patch) $request->merge($patch);
    }

    public function destroy(Branch $branch, Request $request)
    {
        $user = $request->user();

        if ($user->client_id && $branch->client_id !== $user->client_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // "Delete" is now a soft *deactivate* — the branch row stays so
        // that historical records (employees, payroll, audit logs) keep
        // pointing at a real branch and the admin can re-enable later.
        // Concretely:
        //   - branch.status -> 'inactive' (still visible in the list,
        //     just badged Inactive)
        //   - login users on the branch are soft-deleted + tokens
        //     revoked so they can't sign back in
        //   - employees on the branch are soft-deleted so they land
        //     in the Disabled Employees tab instead of the Active one
        //
        // We deliberately do NOT soft-delete the branch itself; the
        // previous behaviour orphaned the employees (they kept their
        // branch_id pointing at a now-trashed branch) which is what
        // surfaced them under a freshly-created replacement branch.
        DB::transaction(function () use ($branch) {
            $this->revokeAllUserTokensForBranch($branch->id);
            $branch->users()->delete();              // soft-delete (User uses SoftDeletes)
            Employee::where('branch_id', $branch->id)->delete(); // soft-delete employees
            $branch->status = 'inactive';
            $branch->save();
        });

        return response()->json(['message' => 'Branch deactivated successfully']);
    }

   
    private function revokeAllUserTokensForBranch(int $branchId): int
    {
        $userIds = User::where('branch_id', $branchId)->pluck('id');
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

    /**
     * Normalise the shifts repeater payload into a clean array of
     * { name, start, end } rows. Accepts a JSON string (multipart uploads),
     * an already-decoded array (JSON requests), or null. Blank-named rows
     * are dropped so empty repeater rows never persist.
     */
    private function normalizeShifts($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) {
            return [];
        }
        return array_values(array_filter(array_map(function ($row) {
            if (!is_array($row)) {
                return null;
            }
            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                return null;
            }
            return [
                'name'  => $name,
                'start' => (string) ($row['start'] ?? ''),
                'end'   => (string) ($row['end'] ?? ''),
            ];
        }, $raw)));
    }

    /**
     * Normalise the bank-accounts repeater into clean
     * { bank_name, branch_name, account_number, ifsc_code, account_type,
     *   is_primary } rows. Same transport handling as normalizeShifts()
     * (JSON string on multipart, array on JSON, null when absent).
     *
     * A row with no bank name is dropped — the inline editor requires one, so
     * a nameless row can only be junk. IFSC is upper-cased to match the Legal
     * Entities master. Only the FIRST row flagged primary keeps the flag, so
     * the data can't end up with two primary accounts.
     */
    private function normalizeBankAccounts($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) {
            return [];
        }

        $primarySeen = false;

        return array_values(array_filter(array_map(function ($row) use (&$primarySeen) {
            if (!is_array($row)) {
                return null;
            }
            $bankName = trim((string) ($row['bank_name'] ?? ''));
            if ($bankName === '') {
                return null;
            }

            $flag = $row['is_primary'] ?? false;
            $isPrimary = $flag === true || $flag === 1 || $flag === '1'
                || (is_string($flag) && strcasecmp($flag, 'yes') === 0)
                || (is_string($flag) && strcasecmp($flag, 'true') === 0);
            if ($isPrimary && $primarySeen) {
                $isPrimary = false;
            } elseif ($isPrimary) {
                $primarySeen = true;
            }

            return [
                'bank_name'      => $bankName,
                'branch_name'    => trim((string) ($row['branch_name'] ?? '')),
                'account_number' => trim((string) ($row['account_number'] ?? '')),
                'ifsc_code'      => strtoupper(trim((string) ($row['ifsc_code'] ?? ''))),
                'account_type'   => trim((string) ($row['account_type'] ?? '')),
                'is_primary'     => $isPrimary,
            ];
        }, $raw)));
    }



    /**
     * Legal-entity options for the Employee / Onboarding forms.
     *
     * The branch IS the registered legal entity for a tenant — it carries the
     * GST, PAN, CIN, IEC and bank accounts — so the "Legal Entity" dropdown
     * lists branch names and the read-only "Location" beside it is the branch's
     * own city + country. `location` is pre-composed here so every consumer
     * (Employee form, HR onboarding, public onboarding) shows the same string.
     *
     * Branch resolution mirrors shiftOptions(): a branch_user only ever sees
     * their own branch; a client_admin sees the BranchSwitcher's branch, or all
     * of the client's branches when "All Branches" is selected.
     *
     * Deliberately not behind the Branches module permission — it's a form
     * lookup, and HR staff who can add an employee may not be able to manage
     * branches.
     */
    public function legalEntityOptions(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) {
            return response()->json(['legal_entities' => []]);
        }

        $branchId = $user->user_type === 'branch_user'
            ? $user->branch_id
            : ($request->integer('branch_id') ?: null);

        $query = Branch::where('client_id', $user->client_id);
        if ($branchId) {
            // Ignore a branch_id that isn't this client's (no cross-tenant leak).
            $query->where('id', $branchId);
        }

        $rows = $query->orderBy('name')->get(['id', 'name', 'code', 'city', 'state', 'country']);

        return response()->json([
            'legal_entities' => $rows->map(fn (Branch $b) => [
                'id'       => $b->id,
                'name'     => $b->name,
                'code'     => $b->code,
                'city'     => $b->city,
                'state'    => $b->state,
                'country'  => $b->country,
                'location' => self::composeBranchLocation($b),
            ])->values(),
        ]);
    }

    /**
     * The employee "Location" string for a branch: "Pune, India". Skips blanks
     * so a branch with no city doesn't render a leading comma.
     */
    public static function composeBranchLocation(?Branch $branch): string
    {
        if (!$branch) {
            return '';
        }
        return implode(', ', array_filter([
            trim((string) $branch->city),
            trim((string) $branch->country),
        ], fn ($v) => $v !== ''));
    }

    public function nextCode(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;
        if (!$clientId) {
            return response()->json(['code' => 'BR-001', 'prefix' => 'BR-']);
        }
        return response()->json([
            'code'   => $this->peekNextBranchCode($clientId),
            'prefix' => 'BR-',
        ]);
    }

    /**
     * Work-shift options for the Employee form's Shift dropdown.
     *
     * Resolves the branch the same way employee creation does:
     *  - branch_user  → their own branch's shifts
     *  - client_admin → the branch the BranchSwitcher points at (?branch_id);
     *    with "All Branches" selected there is no single branch, so we return
     *    the union of every branch's shifts (deduped by name).
     *  - super_admin  → the requested branch_id.
     *
     * Response: { shifts: [{ name, start, end }, ...] }. Empty when nothing is
     * configured — the frontend then falls back to its default list.
     */
    public function shiftOptions(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) {
            return response()->json(['shifts' => []]);
        }

        $branchId = $user->user_type === 'branch_user'
            ? $user->branch_id
            : ($request->integer('branch_id') ?: null);

        $query = Branch::where('client_id', $user->client_id);
        if ($branchId) {
            // Ignore a branch_id that isn't this client's (no cross-tenant leak).
            $query->where('id', $branchId);
        }

        $rows = $query->get(['id', 'shifts']);

        // Flatten + dedupe by name (first occurrence wins) preserving order.
        $seen = [];
        $shifts = [];
        foreach ($rows as $branch) {
            foreach ((array) ($branch->shifts ?? []) as $s) {
                $name = trim((string) ($s['name'] ?? ''));
                if ($name === '') continue;
                $key = mb_strtolower($name);
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $shifts[] = [
                    'name'  => $name,
                    'start' => (string) ($s['start'] ?? ''),
                    'end'   => (string) ($s['end'] ?? ''),
                ];
            }
        }

        return response()->json(['shifts' => $shifts]);
    }

    private function allocateBranchCode($clientId): string
    {
        $q = Branch::withTrashed()->where('client_id', $clientId)->lockForUpdate();
        return $this->buildNextBranchCode($q->pluck('code'));
    }

    private function peekNextBranchCode($clientId): string
    {
        $q = Branch::withTrashed()->where('client_id', $clientId);
        return $this->buildNextBranchCode($q->pluck('code'));
    }

    private function buildNextBranchCode($codes): string
    {
        $max = 0;
        foreach ($codes as $c) {
            // Only count codes that match our auto-generated pattern.
            // Legacy / manually-entered codes (e.g. 'HO', 'MUM-WH-01')
            // are ignored so they don't poison the sequence.
            if (preg_match('/^BR-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'BR-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    
    public function formBundle(Request $request)
    {
        $user = $request->user();
        $cacheKey = \App\Support\MasterBundleCache::key('branch:form-bundle:masters', $user?->id);

       
        $masters = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            $scope = fn ($q) => \App\Support\MasterVisibility::applyReadScope($q, $user);
            return [
                'countries' => Countries::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('name')
                    ->get(['id', 'name', 'iso_code', 'status']),
                'states' => States::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('name')
                    ->get(['id', 'country_id', 'name', 'status']),
            ];
        });

       
        $clientId = $user?->client_id;
        $nextCode = $clientId
            ? $this->peekNextBranchCode($clientId)
            : 'BR-001';

        return response()->json([
            'countries' => $masters['countries'],
            'states'    => $masters['states'],
            'next_code' => $nextCode,
            'prefix'    => 'BR-',
        ]);
    }
    
}
