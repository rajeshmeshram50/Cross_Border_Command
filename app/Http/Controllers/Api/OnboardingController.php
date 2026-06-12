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
    /* ─────────────────────────────────────────────────────────────────
     *  ADMIN — create invite + send email
     * ───────────────────────────────────────────────────────────────── */

    public function createInvite(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if (!in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            abort(403, 'Only admins can issue onboarding invites.');
        }

        $data = $request->validate([
            'invitee_name'       => 'required|string|max:255',
            'invitee_email'      => 'required|email|max:191',
            'department_id'      => 'nullable|integer|exists:master_departments,id',
            // Realistic window for a new joiner — no absurd historical dates,
            // no far-future. Mirrors validateOnboardingPayload's date_of_joining.
            'expected_join_date' => 'nullable|date|after_or_equal:' . now()->subYear()->toDateString() . '|before_or_equal:' . now()->addYears(2)->toDateString(),
            'expiry_days'        => 'nullable|integer|in:3,7,15,30',
            // Optional caller-supplied origin (e.g. http://127.0.0.1:8000)
            // so the invite link points at the SPA the admin is using right
            // now, not whatever APP_URL happens to be set to in .env. Falls
            // back to APP_URL when omitted.
            'app_origin'         => 'nullable|url|max:255',
        ]);

        // Resolve tenant tuple from the authenticated user — same rule the
        // EmployeeController uses for stamp-time ownership.
        [$clientId, $branchId] = $this->resolveOwnership($user);

        // Fail fast if the email is already on a real user account — no
        // point inviting someone whose login already exists.
        $existingUser = User::where('email', $data['invitee_email'])->whereNull('deleted_at')->first();
        if ($existingUser) {
            throw ValidationException::withMessages([
                'invitee_email' => ['This email already has an account. Use the regular Add Employee flow.'],
            ]);
        }

        $expiryDays = (int) ($data['expiry_days'] ?? 15);
        $token      = $this->generateToken();
        $invite = EmployeeOnboardingInvite::create([
            'client_id'          => $clientId,
            'branch_id'          => $branchId,
            'created_by'         => $user->id,
            'invitee_name'       => $data['invitee_name'],
            'invitee_email'      => $data['invitee_email'],
            'department_id'      => $data['department_id'] ?? null,
            'expected_join_date' => $data['expected_join_date'] ?? null,
            'token'              => $token,
            'expires_at'         => now()->addDays($expiryDays),
            'status'             => 'pending',
        ]);

        // Prefer the SPA's own origin (sent by the frontend) so the link
        // actually opens the React app the admin is using right now. Strip
        // any trailing slash before composing the final URL.
        $url = $this->buildOnboardingUrl($token, $data['app_origin'] ?? null);

        // Onboarding invite mail — gated by Settings → Notifications → newUser
        if (Settings::shouldSendMail('newUser')) try {
            $orgName = Client::find($clientId)?->org_name ?? config('mail.from.name', 'Cross Border Command');
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
            Log::warning('Onboarding invite mail failed', [
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
                'expected_join_date' => $invite->expected_join_date?->toDateString(),
                'expires_at'         => $invite->expires_at?->toIso8601String(),
                'url'                => $url,
                'status'             => $invite->status,
            ],
        ], 201);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  PUBLIC — show invite (preview the form)
     * ───────────────────────────────────────────────────────────────── */

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
            // Auto-mark expired so it can't be used even if status was still
            // 'pending' from a stale row.
            if ($invite->status !== 'expired') {
                $invite->update(['status' => 'expired']);
            }
            return response()->json(['message' => 'This onboarding link has expired.'], 410);
        }

        // Inviter context — tenant name, logo and website shown in the form sidebar.
        $client  = Client::find($invite->client_id);
        $orgName = $client?->org_name ?? 'Your Organization';
        $logoUrl = $client?->logo_url;
        $website = $client?->website;

        // Master lists scoped to the inviting tenant. Public endpoint, so we
        // construct the queries manually rather than going through MasterController
        // (which requires auth).
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
                'expected_join_date' => $invite->expected_join_date?->toDateString(),
                'expires_at'         => $invite->expires_at?->toIso8601String(),
                'org_name'           => $orgName,
                'logo_url'           => $logoUrl,
                'website'            => $website,
            ],
            'masters' => [
                'countries'    => \App\Models\Masters\Countries::orderBy('name')->get(['id', 'name']),
                'states'       => \App\Models\Masters\States::orderBy('name')->get(['id', 'name', 'country_id']),
                'departments'  => Departments::where($tenantScope)->orderBy('name')->get(['id', 'name']),
                'designations' => \App\Models\Masters\Designations::where($tenantScope)->orderBy('name')->get(['id', 'name']),
                'roles'        => \App\Models\Masters\Roles::where($tenantScope)->orderBy('name')->get(['id', 'name']),
                'legal_entities' => \App\Models\Masters\LegalEntities::where($tenantScope)->orderBy('entity_name')->get(['id', 'entity_name', 'city']),
            ],
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  PUBLIC — submit the completed form
     * ───────────────────────────────────────────────────────────────── */

    public function complete(Request $request, string $token)
    {
        $invite = EmployeeOnboardingInvite::where('token', $token)->first();
        if (!$invite || $invite->status !== 'pending' || $invite->expires_at?->isPast()) {
            return response()->json(['message' => 'Onboarding link is no longer usable.'], 410);
        }

        $data = $this->validateOnboardingPayload($request, $invite);

        try {
            // Only the DB writes run inside the transaction. The welcome
            // email is deliberately kept OUT of it (and queued) — sending it
            // synchronously over SMTP was holding the transaction (and the
            // allocateEmpCode row lock) open for the full ~15s SMTP round-trip,
            // which is what made this endpoint slow. See the queue() call below.
            $result = DB::transaction(function () use ($invite, $data) {
                // OB-08: re-fetch + row-lock the invite INSIDE the transaction and
                // re-check it's still pending. Without this, a double-click / two
                // tabs both passed the earlier status check and provisioned two
                // Users + Employees from a single invite.
                $invite = EmployeeOnboardingInvite::whereKey($invite->id)->lockForUpdate()->first();
                if (!$invite || $invite->status !== 'pending') {
                    abort(409, 'This onboarding link has already been completed.');
                }

                // Provision the User row first (login account). Same shape as
                // EmployeeController::store but tenant comes from the invite,
                // not the request user (which doesn't exist on this public
                // endpoint).
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
                    // Department defaults to the one the admin pre-set on the
                    // invite if the candidate didn't override.
                    'department_id' => $data['department_id'] ?? $invite->department_id,
                    'date_of_joining' => $data['date_of_joining'] ?? $invite->expected_join_date,
                ]));

                $loginUser->update(['employee_code' => $empCode]);

                // Default permissions — same self-service pack a regular
                // create gets, plus inherited master view perms.
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

            // Welcome email — gated by Settings → Notifications → newUser.
            // QUEUED (not ->send()) and run AFTER the transaction commits so
            // the HTTP response returns immediately instead of blocking on the
            // SMTP send. Requires the queue worker (database queue) to be
            // running to actually dispatch the mail.
            if (Settings::shouldSendMail('newUser')) try {
                $orgName = Client::find($invite->client_id)?->org_name ?? 'Your Organization';
                // OB-12: send SYNCHRONOUSLY — there is no queue worker running, so
                // a ->queue()'d credentials mail would sit undelivered forever and
                // the new employee could never log in. Costs a little request
                // latency, but the credentials actually arrive.
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
                    'email' => ['This email already has an account.'],
                ]);
            }
            throw $e;
        }
    }

    /* ─────────────────────────────────────────────────────────────────
     *  Helpers
     * ───────────────────────────────────────────────────────────────── */

    private function resolveOwnership($user): array
    {
        if ($user->user_type === 'super_admin') return [null, null];
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) return [$user->client_id, null];
        if ($user->user_type === 'branch_user') return [$user->client_id, $user->branch_id];
        return [$user->client_id ?? null, $user->branch_id ?? null];
    }

    private function generateToken(): string
    {
        // 64-char URL-safe token. Loop on the (extremely improbable) collision.
        do {
            $token = Str::random(64);
        } while (EmployeeOnboardingInvite::where('token', $token)->exists());
        return $token;
    }

    private function buildOnboardingUrl(string $token, ?string $appOrigin = null): string
    {
        // Caller-supplied Origin wins (it knows where the SPA actually
        // served the request from). Falls back to app.frontend_url for
        // non-browser callers (cron, queue jobs) that have no Origin —
        // and finally APP_URL as a last-resort floor inside frontend_url's
        // env() chain. The candidate opens this in a browser, so it MUST
        // resolve to the SPA host, not the Laravel API host.
        // OB-21: only honour a caller-supplied origin if its host is one we
        // trust (the configured frontend / app URL). Otherwise an attacker who
        // can reach createInvite could plant a phishing host in the emailed link.
        $base = rtrim((string) config('app.frontend_url'), '/');
        if ($appOrigin) {
            $allowedHosts = array_filter([
                parse_url((string) config('app.frontend_url'), PHP_URL_HOST),
                parse_url((string) config('app.url'), PHP_URL_HOST),
            ]);
            $originHost = parse_url($appOrigin, PHP_URL_HOST);
            if ($originHost && in_array($originHost, $allowedHosts, true)) {
                $base = rtrim($appOrigin, '/');
            }
        }
        return "{$base}/onboarding/{$token}";
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

    /**
     * Mirrors EmployeeController::grantSelfServicePermissions but inheritance
     * source is the invite's creator (since this endpoint is unauthenticated).
     */
    private function grantSelfServicePermissions(User $user, $clientId, $branchId, $grantedBy): void
    {
        $alwaysOnSlugs = ['profile', 'dashboard', 'master.employees'];
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

    /**
     * Validation rules for the candidate-submitted onboarding form. Subset
     * of the admin Add Employee form — job-related fields stay nullable
     * because the admin pre-set them on the invite.
     */
    private function validateOnboardingPayload(Request $request, EmployeeOnboardingInvite $invite): array
    {
        // Names accept letters/space/apostrophe/hyphen/period only — digits
        // and other punctuation are rejected (mirrors the frontend nameRe).
        $nameRule = ['regex:/^[A-Za-z][A-Za-z\s\'\-.]*$/'];
        // E.164-style mobile: 7-15 digits after stripping +/0/spaces is what
        // the frontend allows; here we accept the raw input and normalize.
        $mobileRule = ['regex:/^[+\d\s\-()]{7,20}$/'];
        // Pincode: 4-10 digits.
        $pincodeRule = ['regex:/^\d{4,10}$/'];
        // Free-text address fields must not carry HTML/script markup — reject
        // any angle brackets so `<script>`/tag-injection can never be stored
        // (XSS defence). SQL injection is already neutralised by Eloquent's
        // parameter binding, so we deliberately do NOT blacklist SQL keywords,
        // which would wrongly reject legitimate values like "123 Drop Lane".
        $noTags = ['not_regex:/[<>]/'];

        // OB-01 fix: every FK below must reference a master that belongs to THIS
        // invite's tenant (or a global/null-client row), so a public submitter
        // can't inject another tenant's department/legal-entity/role/geography id.
        $tenantFk = fn (string $table) => Rule::exists($table, 'id')->where(function ($q) use ($invite) {
            $q->whereNull('client_id')->orWhere('client_id', $invite->client_id);
        });

        return $request->validate([
            'first_name'   => array_merge(['required', 'string', 'max:100'], $nameRule),
            'middle_name'  => array_merge(['nullable', 'string', 'max:100'], $nameRule),
            'last_name'    => array_merge(['nullable', 'string', 'max:100'], $nameRule),
            'gender'       => 'nullable|in:Male,Female,Other',
            // Onboardee must be at least 18 (matches the frontend validator).
            'date_of_birth' => 'nullable|date|before_or_equal:' . now()->subYears(18)->toDateString(),
            'nationality_country_id' => ['nullable', 'integer', $tenantFk('master_countries')],
            'work_country_id'        => ['nullable', 'integer', $tenantFk('master_countries')],
            'mobile'       => array_merge(['nullable', 'string', 'max:30'], $mobileRule),
            'alt_mobile'   => array_merge(['nullable', 'string', 'max:30'], $mobileRule),

            // Current address
            'country_id'   => ['nullable', 'integer', $tenantFk('master_countries')],
            'state_id'     => ['nullable', 'integer', $tenantFk('master_states')],
            'city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'pincode'      => array_merge(['nullable', 'string', 'max:20'], $pincodeRule),

            // Permanent address
            'perm_country_id'    => ['nullable', 'integer', $tenantFk('master_countries')],
            'perm_state_id'      => ['nullable', 'integer', $tenantFk('master_states')],
            'perm_city'          => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'perm_address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_pincode'       => array_merge(['nullable', 'string', 'max:20'], $pincodeRule),

            // Job — defaults from invite when omitted
            'department_id'   => ['nullable', 'integer', $tenantFk('master_departments')],
            'designation_id'  => ['nullable', 'integer', $tenantFk('master_designations')],
            'primary_role_id' => ['nullable', 'integer', $tenantFk('master_roles')],
            'ancillary_role_id' => ['nullable', 'integer', $tenantFk('master_roles')],
            'legal_entity_id' => ['nullable', 'integer', $tenantFk('master_legal_entities')],
            'location'        => 'nullable|string|max:191',
            // Joining date must be realistic for a NEW joiner — not an absurd
            // historical date (e.g. 1900) and not far in the future. Window:
            // up to 1 year in the past (covers late onboarding) through 2 years
            // ahead (covers scheduled future starts).
            'date_of_joining' => 'nullable|date|after_or_equal:' . now()->subYear()->toDateString() . '|before_or_equal:' . now()->addYears(2)->toDateString(),
        ], [
            'city.not_regex'               => 'City cannot contain < or > characters.',
            'address_line1.not_regex'      => 'Address cannot contain < or > characters.',
            'address_line2.not_regex'      => 'Address cannot contain < or > characters.',
            'perm_city.not_regex'          => 'City cannot contain < or > characters.',
            'perm_address_line1.not_regex' => 'Address cannot contain < or > characters.',
            'perm_address_line2.not_regex' => 'Address cannot contain < or > characters.',
            'location.not_regex'           => 'Location cannot contain < or > characters.',
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
