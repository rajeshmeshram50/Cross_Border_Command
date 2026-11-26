<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\OnboardingInviteMail;
use App\Mail\PasswordChangedMail;
use App\Mail\WelcomeCredentialsMail;
use App\Models\Client;
use App\Models\Employee;
use App\Models\EmployeeOnboardingInvite;
use App\Models\Masters\Departments;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class OnboardingController extends Controller
{
    public function createInvite(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        $this->authorizeInvite($user);

        $data = $request->validate([
            'invitee_name'       => 'required|string|max:255',
            'invitee_email'      => 'required|email|max:191',
            'department_id'      => 'nullable|integer|exists:master_departments,id',
            'designation_id'     => 'nullable|integer|exists:master_designations,id',
            'primary_role_id'    => 'nullable|integer|exists:master_roles,id',
            'expected_join_date' => 'nullable|date|after_or_equal:' . now()->subYear()->toDateString() . '|before_or_equal:' . now()->addYears(2)->toDateString(),
            'expiry_days'        => 'nullable|integer|in:3,7,15,30',
            'app_origin'         => 'nullable|url|max:255',
        ]);

        [$clientId, $branchId] = $this->resolveOwnership($user);

        $data['invitee_email'] = mb_strtolower(trim($data['invitee_email']));

        $existingUser = User::whereRaw('LOWER(email) = ?', [$data['invitee_email']])
            ->where('client_id', $clientId)
            ->whereNull('deleted_at')->first();
        if ($existingUser) {
            throw ValidationException::withMessages([
                'invitee_email' => ['This email already has an account in this organization. Use the regular Add Employee flow instead.'],
            ]);
        }

        $expiryDays = (int) ($data['expiry_days'] ?? 15);
        $token      = $this->generateToken();
        $slug       = $this->generateSlug();
        $invite = EmployeeOnboardingInvite::create([
            'client_id'          => $clientId,
            'branch_id'          => $branchId,
            'created_by'         => $user->id,
            'invitee_name'       => $data['invitee_name'],
            'invitee_email'      => $data['invitee_email'],
            'department_id'      => $data['department_id'] ?? null,
            'designation_id'     => $data['designation_id'] ?? null,
            'primary_role_id'    => $data['primary_role_id'] ?? null,
            'expected_join_date' => $data['expected_join_date'] ?? null,
            'token'              => $token,
            'slug'               => $slug,
            'expires_at'         => now()->addDays($expiryDays),
            'status'             => 'pending',
        ]);

        $url = $this->buildShortUrl($slug, $data['app_origin'] ?? null);

        if (Settings::shouldSendMail('newUser')) try {
            $orgName = Client::find($clientId)?->org_name ?: config('mail.from.name', 'Cross Border Command');
            $deptName = $invite->department_id ? Departments::find($invite->department_id)?->name : null;
            Mail::to($invite->invitee_email)->send(new OnboardingInviteMail(
                $invite->invitee_name,
                $invite->invitee_email,
                $orgName,
                $deptName,
                $invite->expected_join_date?->format('M d, Y'),
                $expiryDays,
                $url,
            ));
        } catch (\Throwable $e) {
            Log::warning('Onboarding invite mail could not be queued', [
                'invite_id' => $invite->id,
                'email'     => $invite->invitee_email,
                'error'     => $e->getMessage(),
            ]);
        }

        return response()->json([
            'message' => "Onboarding link sent to {$invite->invitee_email}.",
            'invite'  => [
                'id'                 => $invite->id,
                'invitee_email'      => $invite->invitee_email,
                'invitee_name'       => $invite->invitee_name,
                'department_id'      => $invite->department_id,
                'designation_id'     => $invite->designation_id,
                'primary_role_id'    => $invite->primary_role_id,
                'expected_join_date' => $invite->expected_join_date?->toDateString(),
                'expires_at'         => $invite->expires_at?->toIso8601String(),
                'url'                => $url,
                'status'             => $invite->status,
            ],
        ], 201);
    }

    public function show(string $token)
    {
        $invite = EmployeeOnboardingInvite::where('token', $token)->first();
        if (!$invite) {
            return response()->json(['message' => 'Invalid onboarding link.'], 404);
        }
        if ($invite->status === 'completed') {
            return response()->json(['message' => 'This onboarding link has already been used.'], 410);
        }
        if ($invite->status === 'cancelled') {
            return response()->json(['message' => 'This onboarding link was cancelled.'], 410);
        }
        if ($invite->expires_at?->isPast()) {
            if ($invite->status !== 'expired') {
                $invite->update(['status' => 'expired']);
            }
            return response()->json(['message' => 'This onboarding link has expired.'], 410);
        }

        $client  = Client::find($invite->client_id);
        $orgName = $client?->org_name ?? 'Your Organization';
        $logoUrl = $client?->logo_url;
        $website = $client?->website;

        $tenantScope = function ($q) use ($invite) {
            $q->where(function ($w) use ($invite) {
                $w->whereNull('client_id');
                if ($invite->client_id) $w->orWhere('client_id', $invite->client_id);
            });
        };

        return response()->json([
            'invite' => [
                'invitee_name'       => $invite->invitee_name,
                'invitee_email'      => $invite->invitee_email,
                'department_id'      => $invite->department_id,
                'designation_id'     => $invite->designation_id,
                'primary_role_id'    => $invite->primary_role_id,
                'expected_join_date' => $invite->expected_join_date?->toDateString(),
                'expires_at'         => $invite->expires_at?->toIso8601String(),
                'org_name'           => $orgName,
                'logo_url'           => $logoUrl,
                'website'            => $website,
            ],
            'masters' => [
                // Active only — a disabled country/state must not be offered on
                // the public onboarding form (this bundle feeds those pickers).
                'countries'    => \App\Models\Masters\Countries::whereRaw("LOWER(COALESCE(status,'active')) = 'active'")->orderBy('name')->get(['id', 'name']),
                'states'       => \App\Models\Masters\States::whereRaw("LOWER(COALESCE(status,'active')) = 'active'")->orderBy('name')->get(['id', 'name', 'country_id']),
                'departments'  => Departments::where($tenantScope)->orderBy('name')->get(['id', 'name']),
                'designations' => \App\Models\Masters\Designations::where($tenantScope)->orderBy('name')->get(['id', 'name']),
                'roles'        => \App\Models\Masters\Roles::where($tenantScope)->orderBy('name')->get(['id', 'name']),
                'legal_entities' => \App\Models\Branch::where('client_id', $invite->client_id)
                    ->when($invite->branch_id, fn ($q) => $q->where('id', $invite->branch_id))
                    ->orderBy('name')
                    ->get(['id', 'name', 'city', 'country'])
                    ->map(fn ($b) => [
                        'id'          => $b->id,
                        'entity_name' => $b->name,
                        'city'        => $b->city,
                        'country'     => $b->country,
                        'location'    => \App\Http\Controllers\Api\BranchController::composeBranchLocation($b),
                    ])->values(),
            ],
        ]);
    }

    public function complete(Request $request, string $token)
    {
        $invite = EmployeeOnboardingInvite::where('token', $token)->first();
        if (!$invite || $invite->status !== 'pending' || $invite->expires_at?->isPast()) {
            return response()->json(['message' => 'Onboarding link is no longer usable.'], 410);
        }

        $data = $this->validateOnboardingPayload($request, $invite);

        try {
            $result = DB::transaction(function () use ($invite, $data) {
                $invite = EmployeeOnboardingInvite::whereKey($invite->id)->lockForUpdate()->first();
                if (!$invite || $invite->status !== 'pending') {
                    abort(409, 'This onboarding link has already been completed.');
                }

                $rawPassword = $this->generatePassword();
                $loginUser = User::create([
                    'name'        => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'email'       => $invite->invitee_email,
                    'password'    => Hash::make($rawPassword),
                    'phone'       => $data['mobile'] ?? null,
                    'user_type'   => 'employee',
                    'client_id'   => $invite->client_id,
                    'branch_id'   => $invite->branch_id,
                    'status'      => 'active',
                    'designation' => null,
                ]);

                $empCode = $this->allocateEmpCode($invite->client_id, $invite->branch_id);

                $employee = Employee::create(array_merge($data, [
                    'client_id'    => $invite->client_id,
                    'branch_id'    => $invite->branch_id,
                    'created_by'   => $invite->created_by,
                    'user_id'      => $loginUser->id,
                    'emp_code'     => $empCode,
                    'display_name' => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'email'        => $invite->invitee_email,
                    'department_id' => $data['department_id'] ?? $invite->department_id,
                    'designation_id'  => $invite->designation_id,
                    'primary_role_id' => $invite->primary_role_id,
                    'date_of_joining' => $data['date_of_joining'] ?? $invite->expected_join_date,
                ]));

                $loginUser->update(['employee_code' => $empCode]);

                $this->grantSelfServicePermissions($loginUser, $invite->client_id, $invite->branch_id, $invite->created_by);

                $invite->update([
                    'status'       => 'completed',
                    'completed_at' => now(),
                    'employee_id'  => $employee->id,
                ]);

                return ['employee' => $employee, 'loginUser' => $loginUser, 'rawPassword' => $rawPassword];
            });

            $employee    = $result['employee'];
            $loginUser   = $result['loginUser'];
            $rawPassword = $result['rawPassword'];

            if (Settings::shouldSendMail('newUser')) try {
                $orgName = Client::find($invite->client_id)?->org_name ?? 'Your Organization';
                Mail::to($invite->invitee_email)->send(new WelcomeCredentialsMail(
                    $loginUser->name,
                    $invite->invitee_email,
                    $rawPassword,
                    'employee',
                    $orgName,
                    PasswordChangedMail::resolveLoginUrl($request),
                ));
            } catch (\Throwable $e) {
                Log::warning('Onboarding welcome mail failed to queue', [
                    'employee_id' => $employee->id,
                    'email'       => $invite->invitee_email,
                    'error'       => $e->getMessage(),
                ]);
            }

            return response()->json([
                'message' => 'Onboarding complete. Your login credentials will be emailed to you.',
                'employee' => [
                    'id'           => $employee->id,
                    'emp_code'     => $employee->emp_code,
                    'display_name' => $employee->display_name,
                ],
            ]);
        } catch (QueryException $e) {
            if ($e->getCode() === '23505') {
                throw ValidationException::withMessages([
                    'email' => ['This email already has an account in this organization. Each email can be used only once per organization.'],
                ]);
            }
            throw $e;
        }
    }

    private function authorizeInvite($user): void
    {
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            return;
        }

        $moduleId = Module::where('slug', 'hr.onboarding')->value('id');
        if ($moduleId && Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_add', true)
            ->exists()) {
            return;
        }

        abort(403, 'You do not have permission to issue onboarding invites. Ask an admin to grant you "Add" on Employee Onboarding.');
    }

    private function resolveOwnership($user): array
    {
        if ($user->user_type === 'super_admin') return [null, null];
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) return [$user->client_id, null];
        if ($user->user_type === 'branch_user') return [$user->client_id, $user->branch_id];
        return [$user->client_id ?? null, $user->branch_id ?? null];
    }

    private function generateToken(): string
    {
        do {
            $token = Str::random(64);
        } while (EmployeeOnboardingInvite::where('token', $token)->exists());
        return $token;
    }

    private function generateSlug(): string
    {
        do {
            $slug = Str::random(10);
        } while (EmployeeOnboardingInvite::where('slug', $slug)->exists());
        return $slug;
    }

    private function resolveShareBase(?string $appOrigin = null): string
    {
        $base = rtrim((string) config('app.frontend_url'), '/');
        if ($appOrigin) {
            $loopback = ['localhost', '127.0.0.1', '::1'];
            $norm = fn (?string $h) => in_array(strtolower((string) $h), $loopback, true)
                ? 'localhost'
                : strtolower((string) $h);
            $allowedHosts = array_filter([
                $norm(parse_url((string) config('app.frontend_url'), PHP_URL_HOST)),
                $norm(parse_url((string) config('app.url'), PHP_URL_HOST)),
            ]);
            $originHost = $norm(parse_url($appOrigin, PHP_URL_HOST));
            if ($originHost && in_array($originHost, $allowedHosts, true)) {
                $base = rtrim($appOrigin, '/');
            }
        }
        return $base;
    }

    private function buildShortUrl(string $slug, ?string $appOrigin = null): string
    {
        return $this->resolveShareBase($appOrigin) . "/o/{$slug}";
    }

    private function generatePassword(): string
    {
        $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        $digit = '23456789';
        $sym   = '@#$%';
        $pool  = $alpha . $digit . $sym;
        $out   = '';
        for ($i = 0; $i < 12; $i++) $out .= $pool[random_int(0, strlen($pool) - 1)];
        return $out;
    }

    private function allocateEmpCode($clientId, $branchId): string
    {
        $q = Employee::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        $max = 0;
        foreach ($q->pluck('emp_code') as $c) {
            if (preg_match('/^EMP-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'EMP-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    private function grantSelfServicePermissions(User $user, $clientId, $branchId, $grantedBy): void
    {
        $alwaysOnSlugs = ['profile', 'dashboard'];
        $adminMasterIds = [];
        if ($grantedBy) {
            $adminMasterIds = Permission::where('user_id', $grantedBy)
                ->where('can_view', true)
                ->whereHas('module', fn($q) => $q->where('slug', 'like', 'master.%'))
                ->pluck('module_id')
                ->all();
        }
        $modules = Module::where(function ($q) use ($alwaysOnSlugs, $adminMasterIds) {
            $q->whereIn('slug', $alwaysOnSlugs);
            if (!empty($adminMasterIds)) $q->orWhereIn('id', $adminMasterIds);
        })->get();
        foreach ($modules as $m) {
            Permission::firstOrCreate(
                ['user_id' => $user->id, 'module_id' => $m->id],
                [
                    'client_id'   => $clientId,
                    'branch_id'   => $branchId,
                    'role'        => 'employee',
                    'can_view'    => true,
                    'can_add'     => false,
                    'can_edit'    => false,
                    'can_delete'  => false,
                    'can_export'  => false,
                    'can_import'  => false,
                    'can_approve' => false,
                    'granted_by'  => $grantedBy,
                ],
            );
        }
    }

    private function validateOnboardingPayload(Request $request, EmployeeOnboardingInvite $invite): array
    {
        $nameRule = ['regex:/^[A-Za-z][A-Za-z\s\'\-.]*$/'];
        $mobileRule = ['regex:/^[+\d\s\-()]{7,20}$/'];
        $pincodeRule = ['regex:/^\d{4,10}$/'];
        $noTags = ['not_regex:/[<>]/'];
        $addressRule = ['regex:/^(?=.*[A-Za-z])(?=.*[\s\d]).{5,}$/'];

        $tenantFk = fn (string $table) => Rule::exists($table, 'id')->where(function ($q) use ($invite) {
            $q->whereNull('client_id')->orWhere('client_id', $invite->client_id);
        });

        return $request->validate([
            'first_name'   => array_merge(['required', 'string', 'min:3', 'max:100'], $nameRule),
            'middle_name'  => array_merge(['nullable', 'string', 'max:100'], $nameRule),
            'last_name'    => array_merge(['nullable', 'string', 'max:100'], $nameRule),
            'gender'       => 'nullable|in:Male,Female,Other',
            'date_of_birth' => 'nullable|date|before_or_equal:' . now()->subYears(18)->toDateString(),
            'nationality_country_id' => ['nullable', 'integer', $tenantFk('master_countries')],
            'work_country_id'        => ['nullable', 'integer', $tenantFk('master_countries')],
            'mobile'       => array_merge(['nullable', 'string', 'max:30'], $mobileRule),
            'alt_mobile'   => array_merge(['nullable', 'string', 'max:30'], $mobileRule),

            'country_id'   => ['nullable', 'integer', $tenantFk('master_countries')],
            'state_id'     => ['nullable', 'integer', $tenantFk('master_states')],
            'city'         => array_merge(['nullable', 'string', 'max:100'], $nameRule),
            'address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags, $addressRule),
            'address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags, $addressRule),
            'pincode'      => array_merge(['nullable', 'string', 'max:20'], $pincodeRule),

            'perm_country_id'    => ['nullable', 'integer', $tenantFk('master_countries')],
            'perm_state_id'      => ['nullable', 'integer', $tenantFk('master_states')],
            'perm_city'          => array_merge(['nullable', 'string', 'max:100'], $nameRule),
            'perm_address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags, $addressRule),
            'perm_address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags, $addressRule),
            'perm_pincode'       => array_merge(['nullable', 'string', 'max:20'], $pincodeRule),

            'department_id'   => ['nullable', 'integer', $tenantFk('master_departments')],
            'designation_id'  => ['nullable', 'integer', $tenantFk('master_designations')],
            'primary_role_id' => ['nullable', 'integer', $tenantFk('master_roles')],
            'ancillary_role_id' => ['nullable', 'integer', $tenantFk('master_roles')],
            'legal_entity_id' => [
                'nullable', 'integer',
                Rule::exists('branches', 'id')
                    ->where(fn ($q) => $q->where('client_id', $invite->client_id)->whereNull('deleted_at')),
            ],
            'location'        => 'nullable|string|max:191',
            'date_of_joining' => 'nullable|date|after_or_equal:' . now()->subYear()->toDateString() . '|before_or_equal:' . now()->addYears(2)->toDateString(),
        ], [
            'city.regex'                   => 'Enter a valid city name (letters only — no numbers or special characters).',
            'address_line1.not_regex'      => 'Address cannot contain < or > characters.',
            'address_line2.not_regex'      => 'Address cannot contain < or > characters.',
            'address_line1.regex'          => 'Enter a valid address — include a house/building number and street name.',
            'address_line2.regex'          => 'Enter a valid address — include a house/building number and street name.',
            'perm_city.regex'              => 'Enter a valid city name (letters only — no numbers or special characters).',
            'perm_address_line1.not_regex' => 'Address cannot contain < or > characters.',
            'perm_address_line2.not_regex' => 'Address cannot contain < or > characters.',
            'perm_address_line1.regex'     => 'Enter a valid address — include a house/building number and street name.',
            'perm_address_line2.regex'     => 'Enter a valid address — include a house/building number and street name.',
            'location.not_regex'           => 'Location cannot contain < or > characters.',
            'first_name.min'     => 'First name must be at least 3 characters.',
            'first_name.regex'   => 'First name cannot contain numbers.',
            'middle_name.regex'  => 'Middle name cannot contain numbers.',
            'last_name.regex'    => 'Last name cannot contain numbers.',
            'mobile.regex'       => 'Mobile must be 7–15 digits.',
            'alt_mobile.regex'   => 'Alternate mobile must be 7–15 digits.',
            'pincode.regex'      => 'Pincode must be 4–10 digits.',
            'perm_pincode.regex' => 'Pincode must be 4–10 digits.',
            'date_of_joining.after_or_equal'  => 'Joining date is too far in the past — enter a realistic joining date.',
            'date_of_joining.before_or_equal' => 'Joining date is too far in the future — enter a realistic joining date.',
            'date_of_birth.before_or_equal' => 'You must be at least 18 years old.',
        ]);
    }
}
