<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\OnboardingInviteMail;
use App\Mail\WelcomeCredentialsMail;
use App\Models\Client;
use App\Models\Employee;
use App\Models\EmployeeOnboardingInvite;
use App\Models\Masters\Departments;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Self-service onboarding flow.
 *
 *   1. Admin POSTs to /employees/onboarding-invite with the candidate's
 *      basic details + expiry. We mint a one-shot token, email the link.
 *   2. Candidate GETs /onboarding/{token} — public, returns invite preview
 *      + master dropdowns scoped to the inviting tenant so the form has
 *      the same lists the admin would see.
 *   3. Candidate POSTs /onboarding/{token}/complete with the full form.
 *      We create the Employee + paired User + send the welcome credentials
 *      email, then flip the invite to `completed`.
 */
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
            'expected_join_date' => 'nullable|date',
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

        try {
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

        // Inviter context — tenant name shown in the form header.
        $orgName = Client::find($invite->client_id)?->org_name ?? 'Your Organization';

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
            return DB::transaction(function () use ($invite, $data) {
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

                // Welcome email with credentials so the new hire can log in.
                try {
                    $orgName = Client::find($invite->client_id)?->org_name ?? 'Your Organization';
                    Mail::to($invite->invitee_email)->send(new WelcomeCredentialsMail(
                        $loginUser->name,
                        $invite->invitee_email,
                        $rawPassword,
                        'employee',
                        $orgName,
                    ));
                } catch (\Throwable $e) {
                    Log::warning('Onboarding welcome mail failed', [
                        'employee_id' => $employee->id,
                        'email'       => $invite->invitee_email,
                        'error'       => $e->getMessage(),
                    ]);
                }

                return response()->json([
                    'message' => 'Onboarding complete. Login credentials sent to your email.',
                    'employee' => [
                        'id'           => $employee->id,
                        'emp_code'     => $employee->emp_code,
                        'display_name' => $employee->display_name,
                    ],
                ]);
            });
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
        // Caller-supplied origin wins (it knows where the SPA actually
        // serves). Falls back to APP_URL for non-browser callers (cron,
        // queue jobs) that have no Origin header.
        $base = rtrim($appOrigin ?: config('app.url'), '/');
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
                ->whereHas('module', fn ($q) => $q->where('slug', 'like', 'master.%'))
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
        return $request->validate([
            'first_name'   => 'required|string|max:100',
            'middle_name'  => 'nullable|string|max:100',
            'last_name'    => 'nullable|string|max:100',
            'gender'       => 'nullable|in:Male,Female,Other',
            'date_of_birth' => 'nullable|date',
            'nationality_country_id' => 'nullable|integer',
            'work_country_id'        => 'nullable|integer',
            'mobile'       => 'nullable|string|max:30',
            'alt_mobile'   => 'nullable|string|max:30',

            // Current address
            'country_id'   => 'nullable|integer',
            'state_id'     => 'nullable|integer',
            'city'         => 'nullable|string|max:100',
            'address_line1' => 'nullable|string|max:255',
            'address_line2' => 'nullable|string|max:255',
            'pincode'      => 'nullable|string|max:20',

            // Permanent address
            'perm_country_id'    => 'nullable|integer',
            'perm_state_id'      => 'nullable|integer',
            'perm_city'          => 'nullable|string|max:100',
            'perm_address_line1' => 'nullable|string|max:255',
            'perm_address_line2' => 'nullable|string|max:255',
            'perm_pincode'       => 'nullable|string|max:20',

            // Job — defaults from invite when omitted
            'department_id'   => 'nullable|integer',
            'designation_id'  => 'nullable|integer',
            'primary_role_id' => 'nullable|integer',
            'ancillary_role_id' => 'nullable|integer',
            'legal_entity_id' => 'nullable|integer',
            'location'        => 'nullable|string|max:191',
            'date_of_joining' => 'nullable|date',
        ]);
    }
}
