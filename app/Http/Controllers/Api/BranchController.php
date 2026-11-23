<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Masters\Countries;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Models\User;
use App\Support\Gst;
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
    private const EMAIL_REGEX = '/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/';

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
                : true;
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

        $this->normalizeIdentifierCasing($request);

        $request->validate([
            'name' => [
                'required',
                'string',
                'max:255',
                Rule::unique('branches', 'name')
                    ->where(fn($q) => $q->where('client_id', $clientId))
                    ->whereNull('deleted_at'),
            ],
            'code' => 'nullable|string|max:50',
            'email' => ['required', 'email', 'max:255', 'regex:' . self::EMAIL_REGEX, new \App\Rules\UniqueSystemEmail('person', $clientId)],

            'phone' => ['required', 'string', 'max:20', 'regex:/^(?=(?:\D*\d){7,13}\D*$)[+\d\s\-()]+$/'],
            'website' => ['nullable', 'string', 'max:500', 'regex:/^(https?:\/\/)?(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/[^\s]*)?$/i'],
            'contact_person' => 'nullable|string|min:2|max:255',
            'branch_type' => 'nullable|string|max:50',
            'sandwich_policy' => 'required|boolean',
            'lop_basis'   => ['nullable', Rule::in(Branch::LOP_BASES)],
            'lop_divisor' => ['nullable', Rule::in(Branch::LOP_DIVISORS)],
            'industry' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'gst_number' => array_merge([
                'required',
                'string',
                'max:20',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/',
                Rule::unique('branches', 'gst_number')
                    ->where(fn($q) => $q->where('client_id', $clientId))
                    ->whereNull('deleted_at'),
            ], $this->gstNumberConsistencyRules($request)),
            'pan_number' => [
                'required',
                'string',
                'max:20',
                'regex:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/',
                Rule::unique('branches', 'pan_number')
                    ->where(fn($q) => $q->where('client_id', $clientId))
                    ->whereNull('deleted_at'),
            ],
            'registration_number' => 'required|string|max:50',
            'gst_state_code'   => array_merge(
                ['required', 'string', 'max:10'],
                $this->gstStateCodeConsistencyRules($request),
            ),
            'cin'              => 'required|string|max:30',
            'iec'              => 'required|string|max:30',
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
            'shifts' => 'nullable',
            'late_mark_policy' => 'nullable',
            'late_mark_policy.count' => 'sometimes|integer|min:1|max:31',
            'late_mark_policy.deduction' => 'sometimes|in:half_day,full_day',
            'late_mark_policy.consecutive' => 'sometimes|boolean',
            'bank_accounts' => 'nullable',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            'signature_path' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:2048',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',

            'user_name' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z ]+$/'],
            'user_email' => ['required', 'email', 'regex:' . self::EMAIL_REGEX, Rule::unique('users', 'email')->whereNull('deleted_at')],
            'user_phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'user_designation' => 'nullable|string|max:100',
            'user_password' => 'required|string|min:6',
            'user_status' => 'nullable|in:active,inactive,pending',
        ], [
            'email.regex'       => 'Enter a valid email like branch@company.com — a domain ending such as .com is required.',
            'user_email.regex'  => 'Enter a valid email like admin@company.com — a domain ending such as .com is required.',
            'gst_number.unique' => 'This GSTIN is already registered to another branch.',
            'gst_number.regex'  => 'Invalid GSTIN format. Example: 27AADCI6120M1ZH',
            'pan_number.unique' => 'This PAN is already registered to another branch.',
            'pan_number.regex'  => 'Invalid PAN format. Example: AADCI6120M',
        ]);

        $this->assertHasBankAccount($request);

        $this->assertHasShift($request);

        try {
            return DB::transaction(function () use ($request, $clientId, $user) {
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
                    'sandwich_policy' => $request->boolean('sandwich_policy'),
                    'lop_policy' => Branch::normalizeLopPolicy([
                        'basis'   => $request->input('lop_basis'),
                        'divisor' => $request->input('lop_divisor'),
                    ]),
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
                    'late_mark_policy' => Branch::normalizeLateMarkPolicy($request->input('late_mark_policy')),
                    'bank_accounts' => $this->normalizeBankAccounts($request->input('bank_accounts')),
                    'primary_color' => $request->primary_color,
                    'secondary_color' => $request->secondary_color,
                    'created_by' => $user->id,
                ]);

                if ($request->hasFile('logo')) {
                    $logoPath = $request->file('logo')->storeAs("branches/logos/{$branch->id}", $this->uploadFileName($request->file('logo')), 'public');
                    $branch->update(['logo' => $logoPath]);
                    \App\Services\LogoDarkVariantGenerator::generate($logoPath);
                    \App\Services\LogoWebVariantGenerator::generate($logoPath);
                }
                if ($request->hasFile('profile_photo')) {
                    $branch->update([
                        'profile_photo' => $request->file('profile_photo')->storeAs("branches/profile-photos/{$branch->id}", $this->uploadFileName($request->file('profile_photo')), 'public'),
                    ]);
                }
                if ($request->hasFile('signature_path')) {
                    $branch->update([
                        'signature_path' => $request->file('signature_path')->storeAs("branches/signatures/{$branch->id}", $this->uploadFileName($request->file('signature_path')), 'public'),
                    ]);
                }

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

                $mailWarning = null;
                if (Settings::shouldSendMail('newUser')) {
                    try {
                        $clientName = \App\Models\Client::find($clientId)?->org_name ?? 'Your Organization';

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

        $branchUser = User::where('branch_id', $branch->id)
            ->where('user_type', 'branch_user')
            ->first();

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
                    $userPayload['password_plain'] = null;
                }
            }
        }

        $shiftUsage = [];
        foreach ((array) ($branch->shifts ?? []) as $shift) {
            $name = trim((string) ($shift['name'] ?? ''));
            if ($name === '') continue;
            $shiftUsage[$name] = Employee::withTrashed()
                ->where('branch_id', $branch->id)
                ->where(function ($w) {
                    $w->whereNull('status')
                        ->orWhereNotIn('status', ['Resigned', 'Terminated']);
                })
                ->whereRaw('LOWER(TRIM(shift)) = ?', [mb_strtolower($name)])
                ->count();
        }

        return response()->json([
            'branch' => $branch,
            'branch_user' => $userPayload,
            'shift_usage' => $shiftUsage,
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

        $this->normalizeIdentifierCasing($request);

        $nameRules = ['required', 'string', 'max:255'];
        if ($request->input('name') !== $branch->name) {
            $nameRules[] = Rule::unique('branches', 'name')
                ->ignore($branch->id)
                ->where(fn($q) => $q->where('client_id', $branch->client_id))
                ->whereNull('deleted_at');
        }

        $request->validate([
            'name' => $nameRules,
            'code' => 'nullable|string|max:50',
            'email' => ['required', 'email', 'max:255', 'regex:' . self::EMAIL_REGEX, new \App\Rules\UniqueSystemEmail('person', $branch->client_id)],

            'phone' => ['required', 'string', 'max:20', 'regex:/^(?=(?:\D*\d){7,13}\D*$)[+\d\s\-()]+$/'],
            'website' => ['nullable', 'string', 'max:500', 'regex:/^(https?:\/\/)?(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/[^\s]*)?$/i'],
            'contact_person' => 'nullable|string|min:2|max:255',
            'branch_type' => 'nullable|string|max:50',
            'sandwich_policy' => 'required|boolean',
            'lop_basis'   => ['nullable', Rule::in(Branch::LOP_BASES)],
            'lop_divisor' => ['nullable', Rule::in(Branch::LOP_DIVISORS)],
            'industry' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'gst_number' => array_merge([
                'required',
                'string',
                'max:20',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/',
                Rule::unique('branches', 'gst_number')
                    ->ignore($branch->id)
                    ->where(fn($q) => $q->where('client_id', $branch->client_id))
                    ->whereNull('deleted_at'),
            ], $this->gstNumberConsistencyRules($request, $branch->state)),
            'pan_number' => [
                'required',
                'string',
                'max:20',
                'regex:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/',
                Rule::unique('branches', 'pan_number')
                    ->ignore($branch->id)
                    ->where(fn($q) => $q->where('client_id', $branch->client_id))
                    ->whereNull('deleted_at'),
            ],
            'registration_number' => 'required|string|max:50',
            'gst_state_code'   => array_merge(
                ['required', 'string', 'max:10'],
                $this->gstStateCodeConsistencyRules($request, $branch->state),
            ),
            'cin'              => 'required|string|max:30',
            'iec'              => 'required|string|max:30',
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
            'shifts' => 'nullable',
            'late_mark_policy' => 'nullable',
            'late_mark_policy.count' => 'sometimes|integer|min:1|max:31',
            'late_mark_policy.deduction' => 'sometimes|in:half_day,full_day',
            'late_mark_policy.consecutive' => 'sometimes|boolean',
            'bank_accounts' => 'nullable',
            'logo' => 'nullable|image|mimes:jpg,jpeg,png,svg,webp|max:2048',
            'profile_photo' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            'signature_path' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:2048',
            'primary_color' => 'nullable|string|max:7',
            'secondary_color' => 'nullable|string|max:7',
            'user_name' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z ]+$/'],
            'user_email' => ['nullable', 'email', 'regex:' . self::EMAIL_REGEX, Rule::unique('users', 'email')->ignore($branchUser?->id)->whereNull('deleted_at')],
            'user_phone' => ['nullable', 'string', 'max:20', 'regex:/^[+\d\s\-()]{7,20}$/'],
            'user_designation' => 'nullable|string|max:100',
            'user_password' => 'nullable|string|min:6',
            'user_status' => 'nullable|in:active,inactive,pending',
        ], [
            'email.regex'       => 'Enter a valid email like branch@company.com — a domain ending such as .com is required.',
            'user_email.regex'  => 'Enter a valid email like admin@company.com — a domain ending such as .com is required.',
            'gst_number.unique' => 'This GSTIN is already registered to another branch.',
            'gst_number.regex'  => 'Invalid GSTIN format. Example: 27AADCI6120M1ZH',
            'pan_number.unique' => 'This PAN is already registered to another branch.',
            'pan_number.regex'  => 'Invalid PAN format. Example: AADCI6120M',
        ]);

        $this->assertHasBankAccount($request, true);
        $this->assertHasShift($request, true);

        try {
            return DB::transaction(function () use ($request, $branch, $branchUser) {
                $statusBecomingInactive = $request->filled('status')
                    && $branch->status === 'active'
                    && $request->input('status') !== 'active';

                $statusBecomingActive = $request->filled('status')
                    && $branch->status !== 'active'
                    && $request->input('status') === 'active';

                $branch->update($request->only([
                    'name',
                    'code',
                    'email',
                    'phone',
                    'website',
                    'contact_person',
                    'branch_type',
                    'industry',
                    'description',
                    'gst_number',
                    'pan_number',
                    'registration_number',
                    'gst_state_code',
                    'cin',
                    'iec',
                    'drug_license',
                    'pcpndt_no',
                    'aeo_code',
                    'one_star_file_no',
                    'one_star_udin_no',
                    'address',
                    'city',
                    'district',
                    'taluka',
                    'state',
                    'pincode',
                    'country',
                    'max_users',
                    'established_at',
                    'status',
                    'notes',
                    'primary_color',
                    'secondary_color',
                ]));

                if ($request->has('sandwich_policy')) {
                    $sandwichBefore = (bool) $branch->sandwich_policy;
                    $sandwichAfter  = $request->boolean('sandwich_policy');
                    $branch->update(['sandwich_policy' => $sandwichAfter]);

                    if ($sandwichBefore !== $sandwichAfter) {
                        \App\Support\SandwichPolicy::flushCache();
                        $this->recomputeBranchPayslips($branch);
                    }
                }

                if ($request->has('lop_basis') || $request->has('lop_divisor')) {
                    $lopBefore = $branch->lopPolicy();
                    $lopAfter  = Branch::normalizeLopPolicy([
                        'basis'   => $request->input('lop_basis',   $lopBefore['basis']),
                        'divisor' => $request->input('lop_divisor', $lopBefore['divisor']),
                    ]);

                    if ($lopBefore !== $lopAfter) {
                        $branch->update(['lop_policy' => $lopAfter]);
                        $this->recomputeBranchPayslips($branch);
                    }
                }

                if ($request->has('shifts')) {
                    $incoming = $this->normalizeShifts($request->input('shifts'));

                    $inUse = $this->shiftsInUse($branch, $incoming);
                    if (!empty($inUse)) {
                        $parts = [];
                        foreach ($inUse as $name => $count) {
                            $parts[] = "\"{$name}\" ({$count} employee" . ($count === 1 ? '' : 's') . ')';
                        }
                        return response()->json([
                            'message' => 'Cannot remove ' . implode(', ', $parts)
                                . ' — reassign those employees to another shift first.',
                            'errors'  => ['shifts' => ['This shift is assigned to employees in this branch.']],
                        ], 422);
                    }

                    $branch->update(['shifts' => $incoming]);
                }
                if ($request->has('bank_accounts')) {
                    $branch->update(['bank_accounts' => $this->normalizeBankAccounts($request->input('bank_accounts'))]);
                }
                if ($request->has('late_mark_policy')) {
                    $before = Branch::normalizeLateMarkPolicy($branch->late_mark_policy);
                    $after  = Branch::normalizeLateMarkPolicy($request->input('late_mark_policy'));
                    $branch->update(['late_mark_policy' => $after]);

                    if ($before !== $after) {
                        $this->recomputeBranchPayslips($branch);
                    }
                }

                if ($request->hasFile('logo')) {
                    if ($branch->logo) {
                        \App\Services\LogoDarkVariantGenerator::delete($this->relativePath($branch->logo));
                        \App\Services\LogoWebVariantGenerator::delete($this->relativePath($branch->logo));
                        Storage::disk('public')->delete($this->relativePath($branch->logo));
                    }
                    $logoPath = $request->file('logo')->storeAs("branches/logos/{$branch->id}", $this->uploadFileName($request->file('logo')), 'public');
                    $branch->update(['logo' => $logoPath]);
                    \App\Services\LogoDarkVariantGenerator::generate($logoPath);
                    \App\Services\LogoWebVariantGenerator::generate($logoPath);
                }
                if ($request->hasFile('profile_photo')) {
                    if ($branch->profile_photo) {
                        Storage::disk('public')->delete($this->relativePath($branch->profile_photo));
                    }
                    $branch->update(['profile_photo' => $request->file('profile_photo')->storeAs("branches/profile-photos/{$branch->id}", $this->uploadFileName($request->file('profile_photo')), 'public')]);
                }
                if ($request->hasFile('signature_path')) {
                    if ($branch->signature_path) {
                        Storage::disk('public')->delete($this->relativePath($branch->signature_path));
                    }
                    $branch->update(['signature_path' => $request->file('signature_path')->storeAs("branches/signatures/{$branch->id}", $this->uploadFileName($request->file('signature_path')), 'public')]);
                }

                if ($statusBecomingInactive) {
                    $this->revokeAllUserTokensForBranch($branch->id);
                    User::where('branch_id', $branch->id)->delete();
                    Employee::where('branch_id', $branch->id)->delete();
                }

                if ($statusBecomingActive) {
                    User::withTrashed()->where('branch_id', $branch->id)->restore();
                    Employee::withTrashed()->where('branch_id', $branch->id)->restore();
                }

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
                        $userData['password_encrypted'] = Crypt::encryptString($request->user_password);
                        $passwordChanged = true;
                    }

                    $branchUser->update($userData);

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

    private function normalizeIdentifierCasing(Request $request): void
    {
        $patch = [];
        foreach (['gst_number', 'pan_number'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = strtoupper(trim($val));
            }
        }
        foreach (['email', 'user_email'] as $field) {
            $val = $request->input($field);
            if (is_string($val) && $val !== '') {
                $patch[$field] = strtolower(trim($val));
            }
        }
        if ($patch) $request->merge($patch);
    }

    private function gstNumberConsistencyRules(Request $request, ?string $fallbackState = null): array
    {
        return [
            function ($attribute, $value, $fail) use ($request) {
                $gstin = strtoupper(trim((string) $value));
                $pan   = strtoupper(trim((string) $request->input('pan_number')));
                if ($pan === '' || !preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $pan)) return;
                if (!preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/', $gstin)) return;

                $embedded = substr($gstin, 2, 10);
                if ($embedded !== $pan) {
                    $fail("The PAN inside this GSTIN ({$embedded}) does not match the PAN Number entered ({$pan}). A GSTIN's characters 3-12 are the PAN of the same entity.");
                }
            },
            function ($attribute, $value, $fail) use ($request, $fallbackState) {
                $gstin = strtoupper(trim((string) $value));
                $prefix = Gst::stateCodeFromGstin($gstin);
                if ($prefix === null) return;

                $state = $request->has('state') ? $request->input('state') : $fallbackState;
                $expected = Gst::stateCodeFor($state);
                if ($expected && $prefix !== $expected) {
                    $fail("This GSTIN is registered in state code {$prefix}, but the address state is " . trim((string) $state) . " ({$expected}). Correct the GSTIN or the state.");
                }
            },
        ];
    }

    private function gstStateCodeConsistencyRules(Request $request, ?string $fallbackState = null): array
    {
        return [
            function ($attribute, $value, $fail) use ($request, $fallbackState) {
                $code = trim((string) $value);
                if ($code === '') return;

                if (!preg_match('/^[0-9]{2}$/', $code)) {
                    $fail('GST State Code must be exactly 2 digits. Example: 27 for Maharashtra.');
                    return;
                }

                $prefix = Gst::stateCodeFromGstin($request->input('gst_number'));
                if ($prefix && $prefix !== $code) {
                    $fail("GST State Code ({$code}) must match the first two digits of the GST Number ({$prefix}).");
                    return;
                }

                $state = $request->has('state') ? $request->input('state') : $fallbackState;
                $expected = Gst::stateCodeFor($state);
                if ($expected && $expected !== $code) {
                    $fail("GST State Code ({$code}) does not match the address state " . trim((string) $state) . ", whose code is {$expected}.");
                }
            },
        ];
    }

    public function destroy(Branch $branch, Request $request)
    {
        $user = $request->user();

        if ($user->client_id && $branch->client_id !== $user->client_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        DB::transaction(function () use ($branch) {
            $this->revokeAllUserTokensForBranch($branch->id);
            $branch->users()->delete();
            Employee::where('branch_id', $branch->id)->delete();
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

    private function uploadFileName(\Illuminate\Http\UploadedFile $file): string
    {
        $slug = \Illuminate\Support\Str::slug(
            pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME)
        );
        if ($slug === '') {
            $slug = 'file';
        }
        $slug = substr($slug, 0, 60);

        $ext = strtolower($file->getClientOriginalExtension() ?: $file->guessExtension() ?: 'png');

        return $slug . '.' . $ext;
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

    private function shiftsInUse(Branch $branch, array $incoming): array
    {
        $names = fn(array $rows) => collect($rows)
            ->pluck('name')
            ->filter(fn($n) => trim((string) $n) !== '')
            ->map(fn($n) => trim((string) $n))
            ->values();

        $keptLower = $names($incoming)->map(fn($n) => mb_strtolower($n))->all();
        $dropped   = $names((array) ($branch->shifts ?? []))
            ->reject(fn($n) => in_array(mb_strtolower($n), $keptLower, true))
            ->values();

        if ($dropped->isEmpty()) {
            return [];
        }

        $inUse = [];
        foreach ($dropped as $name) {
            $count = Employee::withTrashed()
                ->where('branch_id', $branch->id)
                ->where(function ($w) {
                    $w->whereNull('status')
                        ->orWhereNotIn('status', ['Resigned', 'Terminated']);
                })
                ->whereRaw('LOWER(TRIM(shift)) = ?', [mb_strtolower($name)])
                ->count();

            if ($count > 0) {
                $inUse[$name] = $count;
            }
        }

        return $inUse;
    }

    private function recomputeBranchPayslips(Branch $branch): void
    {
        try {
            $employeeIds = \App\Models\Payslip::query()
                ->whereHas('run', fn($q) => $q->whereIn('status', ['draft', 'generated']))
                ->whereIn('employee_id', Employee::where('branch_id', $branch->id)->pluck('id'))
                ->distinct()
                ->pluck('employee_id');

            $payroll = app(\App\Services\PayrollService::class);
            foreach ($employeeIds as $id) {
                $payroll->recomputeEmployeePayslips((int) $id);
            }
        } catch (\Throwable $e) {
            Log::warning('Branch policy payslip recompute failed for branch ' . $branch->id . ': ' . $e->getMessage());
        }
    }

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

    private function assertHasShift(Request $request, bool $onlyIfPresent = false): void
    {
        if ($onlyIfPresent && !$request->has('shifts')) {
            return;
        }
        $complete = collect($this->normalizeShifts($request->input('shifts')))
            ->contains(fn($row) => $row['start'] !== '' && $row['end'] !== '');

        if (!$complete) {
            throw ValidationException::withMessages([
                'shifts' => ['Add at least one shift with a name, start time and end time.'],
            ]);
        }
    }

    private function assertHasBankAccount(Request $request, bool $onlyIfPresent = false): void
    {
        if ($onlyIfPresent && !$request->has('bank_accounts')) {
            return;
        }
        if (empty($this->normalizeBankAccounts($request->input('bank_accounts')))) {
            throw ValidationException::withMessages([
                'bank_accounts' => ['Add at least one bank account for this branch.'],
            ]);
        }
    }

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

    public function ctcOrganisationOptions(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) {
            return response()->json(['data' => []]);
        }

        $query = Branch::where('client_id', $user->client_id)
            ->where('code', '!=', 'HO')
            ->where('name', 'not ilike', '% — Head Office');

        $rows = $query->orderBy('name')->get([
            'id',
            'name',
            'code',
            'city',
            'state',
            'country',
            'gst_number',
            'pan_number',
            'email',
            'phone',
            'logo',
        ]);

        return response()->json([
            'data' => $rows->map(fn(Branch $b) => [
                'id'         => $b->id,
                'name'       => $b->name,
                'code'       => $b->code,
                'city'       => $b->city,
                'state'      => $b->state,
                'country'    => $b->country ?: 'India',
                'gst_number' => $b->gst_number,
                'pan_number' => $b->pan_number,
                'email'      => $b->email,
                'phone'      => $b->phone,
                'location'   => self::composeBranchLocation($b),
                'logo'       => $b->logo,
                'logo_url'   => $b->logo_url,
            ])->values(),
        ]);
    }

    public function legalEntityOptions(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) {
            return response()->json(['legal_entities' => []]);
        }

        $branchId = self::callerBranchId($request);

        $query = Branch::where('client_id', $user->client_id);
        if ($branchId) {
            $query->where('id', $branchId);
        }

        $rows = $query->orderBy('name')->get(['id', 'name', 'code', 'city', 'state', 'country']);

        return response()->json([
            'legal_entities' => $rows->map(fn(Branch $b) => [
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

    private static function callerBranchId(Request $request): ?int
    {
        $user = $request->user();
        if ($user && $user->branch_id) {
            return (int) $user->branch_id;
        }
        return $request->integer('branch_id') ?: null;
    }

    public static function composeBranchLocation(?Branch $branch): string
    {
        if (!$branch) {
            return '';
        }
        return implode(', ', array_filter([
            trim((string) $branch->city),
            trim((string) $branch->country),
        ], fn($v) => $v !== ''));
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

    public function shiftOptions(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) {
            return response()->json(['shifts' => []]);
        }

        $branchId = self::callerBranchId($request);

        $query = Branch::where('client_id', $user->client_id);
        if ($branchId) {
            $query->where('id', $branchId);
        }

        $rows = $query->get(['id', 'shifts']);

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
            $scope = fn($q) => \App\Support\MasterVisibility::applyReadScope($q, $user);
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

                'state_codes' => StateCodes::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->statutoryFirst()
                    ->get(['state_id', 'state_code']),
            ];
        });

        $clientId = $user?->client_id;
        $nextCode = $clientId
            ? $this->peekNextBranchCode($clientId)
            : 'BR-001';

        return response()->json([
            'countries'   => $masters['countries'],
            'states'      => $masters['states'],
            'state_codes' => $masters['state_codes'] ?? [],
            'next_code' => $nextCode,
            'prefix'    => 'BR-',
        ]);
    }
}
