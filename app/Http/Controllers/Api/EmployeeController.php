<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\WelcomeCredentialsMail;
use App\Models\Branch;
use App\Models\Employee;
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

class EmployeeController extends Controller
{
    /**
     * Eager-loads used by every read endpoint so the SPA gets nested names
     * (department.name, designation.name, manager.display_name, …) without
     * extra round-trips. Each "with" pair is a (relation, columns) tuple to
     * avoid pulling huge rows.
     */
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
        'creator:id,name,user_type',
        'user:id,name,email,status,last_login_at',
        'department:id,name,code',
        'designation:id,name',
        'primaryRole:id,name',
        'ancillaryRole:id,name',
        'legalEntity:id,entity_name,city,state_id,country_id',
        'workCountry:id,name',
        'nationalityCountry:id,name',
        'country:id,name',
        'state:id,name,country_id',
        'reportingManager:id,first_name,middle_name,last_name,display_name,emp_code',
    ];

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Employee::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('display_name', 'ilike', "%{$search}%")
                  ->orWhere('emp_code', 'ilike', "%{$search}%")
                  ->orWhere('email', 'ilike', "%{$search}%")
                  ->orWhere('mobile', 'ilike', "%{$search}%");
            });
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }
        if ($dept = $request->query('department_id')) {
            $q->where('department_id', $dept);
        }

        return response()->json($q->orderByDesc('id')->get());
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($row);
    }

    /**
     * Eligible managers picker — used by the Add/Edit Employee wizard so the
     * user can assign a Reporting Manager even before any employees exist.
     *
     * Returns existing employees first (FK-clean), then the tenant's other
     * login users (client_admin, client_user, branch_user) so a brand-new
     * org can still pick a manager. Each row is tagged with `kind` so the
     * frontend can label it (e.g. "Atharv Patekar — Designer (Employee)"
     * vs "QA Admin — Client Admin").
     */
    public function managers(Request $request)
    {
        $this->authorize($request, 'can_view');
        $user = $request->user();

        // Same scope rules as the employee list — employees see managers in
        // their own tenant, super_admins see everything.
        $eq = Employee::query()->whereNotNull('id');
        $this->applyScope($eq, $user);
        $employees = $eq
            ->select(['id', 'emp_code', 'display_name', 'first_name', 'last_name'])
            ->with(['designation:id,name'])
            ->orderBy('display_name')
            ->get()
            ->map(fn ($e) => [
                'id'    => $e->id,
                'kind'  => 'employee',
                'label' => trim(($e->display_name ?: trim($e->first_name . ' ' . $e->last_name))
                          . ($e->designation?->name ? ' — ' . $e->designation->name : '')
                          . ' (Employee)'),
            ]);

        // Tenant login users that could plausibly act as managers — only
        // returned for client/branch admins so a non-super-admin still scopes
        // to their own org.
        $uq = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user'])
            ->where('status', 'active');
        if (!$user->isSuperAdmin()) {
            $uq->where('client_id', $user->client_id);
            if ($user->user_type === 'branch_user') {
                $uq->where(function ($q) use ($user) {
                    $q->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }
        $loginUsers = $uq
            ->select(['id', 'name', 'user_type', 'designation'])
            ->orderBy('name')
            ->get()
            ->map(fn ($u) => [
                'id'    => $u->id,
                'kind'  => $u->user_type,
                'label' => trim($u->name
                          . ($u->designation ? ' — ' . $u->designation : '')
                          . ' (' . ucfirst(str_replace('_', ' ', $u->user_type)) . ')'),
            ]);

        return response()->json([
            'employees'   => $employees->values(),
            'login_users' => $loginUsers->values(),
        ]);
    }

    /**
     * Returns the next EMP-### code for the tenant the new row would be
     * stamped under. Keeps the sequence isolated per (client_id, branch_id),
     * mirroring how MasterController generates DEPT-###.
     */
    public function nextCode(Request $request)
    {
        $this->authorize($request, 'can_view');
        [$clientId, $branchId] = $this->resolveOwnership($request);

        $q = Employee::query()->withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck('emp_code') as $code) {
            if (preg_match('/^EMP-(\d+)$/i', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return response()->json([
            'code'   => 'EMP-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT),
            'prefix' => 'EMP-',
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  STORE — creates Employee + paired User login + sends welcome mail
     * ───────────────────────────────────────────────────────────────── */

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);

        try {
            return DB::transaction(function () use ($request, $data) {
                $auth = $request->user();
                [$clientId, $branchId] = $this->resolveOwnership($request);

                // Provision the login account first — if the email collides we
                // want the whole txn to roll back before writing the employee row.
                $rawPassword = $this->generatePassword();
                $loginUser = User::create([
                    'name'          => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'email'         => $data['email'],
                    'password'      => Hash::make($rawPassword),
                    'phone'         => $data['mobile'] ?? null,
                    'user_type'     => 'employee',
                    'client_id'     => $clientId,
                    'branch_id'     => $branchId,
                    'status'        => 'active',
                    'designation'   => $request->input('designation_name'),
                    'employee_code' => null, // populated after we know emp_code
                ]);

                $empCode = $this->allocateCode($clientId, $branchId);

                // Wizard now saves per-step. The frontend ships the step
                // number it just completed (1-4); we record it so Edit can
                // resume at the right step. Default to 1 because the very
                // first save corresponds to step 1 of the wizard.
                $stepCompleted = max(1, min(4, (int) $request->input('wizard_step_completed', 1)));

                // Force `Inactive` for wizard-created employees regardless of
                // what the frontend sent. The 4-step wizard captures only
                // half the data we eventually want — admin must explicitly
                // flip the row to Active once the rest of the onboarding
                // (assets, payroll review, etc.) is done.
                $payload = array_merge($data, [
                    'client_id'             => $clientId,
                    'branch_id'             => $branchId,
                    'created_by'            => $auth?->id,
                    'user_id'               => $loginUser->id,
                    'emp_code'              => $empCode,
                    'display_name'          => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'status'                => 'Inactive',
                    'wizard_step_completed' => $stepCompleted,
                ]);
                $employee = Employee::create($payload);

                // Backfill emp_code onto the user row so legacy code that reads
                // user.employee_code keeps working.
                $loginUser->update(['employee_code' => $empCode]);

                // Seed the standard "self-service" permission row so the new
                // hire can at least sign in and see their own profile module.
                // Admin can grant additional modules from the UI later.
                $this->grantSelfServicePermissions($loginUser, $clientId, $branchId, $auth?->id);

                $employee->load(self::WITH);

                // Welcome email with credentials — non-fatal on failure so the
                // employee record still saves if SMTP is down.
                try {
                    $clientName = \App\Models\Client::find($clientId)?->org_name ?? 'Your Organization';
                    Mail::to($data['email'])->send(new WelcomeCredentialsMail(
                        $loginUser->name,
                        $data['email'],
                        $rawPassword,
                        'employee',
                        $clientName,
                    ));
                } catch (\Throwable $e) {
                    Log::warning('Employee welcome mail failed', [
                        'employee_id' => $employee->id,
                        'email'       => $data['email'],
                        'error'       => $e->getMessage(),
                    ]);
                }

                return response()->json([
                    'message'  => 'Employee created. Welcome email sent with login credentials.',
                    'employee' => $employee,
                ], 201);
            });
        } catch (QueryException $e) {
            // Postgres unique violation (23505) on users.email — surface as a
            // friendly field error instead of a 500.
            if ($e->getCode() === '23505') {
                throw ValidationException::withMessages([
                    'email' => ['This email is already registered.'],
                ]);
            }
            throw $e;
        }
    }

    /* ─────────────────────────────────────────────────────────────────
     *  UPDATE / DESTROY
     * ───────────────────────────────────────────────────────────────── */

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);
        // Hierarchical edit guard intentionally removed: per product call,
        // anyone the admin grants `can_edit` on master.employees should be
        // able to update any row in their tenant — including ones created
        // by the admin themselves. Delete still preserves the guard since
        // it's destructive.

        $data = $this->validatePayload($request, $row->id);

        // Track wizard progress as a high-watermark — never decrease it.
        // The frontend posts the step number it just completed; we keep
        // the maximum so a user editing an already-finished employee
        // can't accidentally roll the progress meter backwards.
        $stepFromRequest = (int) $request->input('wizard_step_completed', 0);
        $newStep = max((int) $row->wizard_step_completed, $stepFromRequest);

        DB::transaction(function () use ($row, $data, $newStep) {
            // first_name might not be in $data on a partial step-3/step-4
            // PATCH (the frontend only sends the fields for the step it
            // just saved). Fall back to the existing row value so
            // display_name doesn't get smashed to "" when the wizard
            // saves a later step alone.
            $first  = $data['first_name']  ?? $row->first_name;
            $middle = array_key_exists('middle_name', $data) ? $data['middle_name'] : $row->middle_name;
            $last   = array_key_exists('last_name', $data)   ? $data['last_name']   : $row->last_name;
            $row->update(array_merge($data, [
                'display_name'          => Employee::composeDisplayName($first, $middle, $last),
                'wizard_step_completed' => $newStep,
            ]));

            // Keep the linked user in sync — name + email + phone changes here
            // should land on the login account too.
            if ($row->user) {
                $row->user->update([
                    'name'        => $row->display_name,
                    'email'       => $data['email'] ?? $row->user->email,
                    'phone'       => $data['mobile'] ?? $row->user->phone,
                    'designation' => $data['designation_name'] ?? $row->user->designation,
                ]);
            }
        });

        $row->load(self::WITH);
        return response()->json(['message' => 'Updated', 'employee' => $row]);
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        DB::transaction(function () use ($row) {
            // Soft-delete the employee record and disable the login account.
            // Hard-deleting the user would orphan permissions/activity logs.
            $row->user?->update(['status' => 'inactive']);
            $row->delete();
        });

        return response()->json(['message' => 'Employee removed and login disabled.']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

    /** Cap the granular permission check to the 'master.employees' module. */
    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', 'master.employees')->value('id');
        if (!$moduleId) {
            // First-run: module row not seeded yet. Fall back to plan-default
            // (allow client_admin / branch_user; deny others).
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Employees module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on master.employees");
    }

    /** Pick (client_id, branch_id) for a new row, mirroring MasterController::resolveOwnership. */
    private function resolveOwnership(Request $request): array
    {
        $user = $request->user();
        if ($user && $user->user_type === 'super_admin') {
            return [$request->input('client_id'), $request->input('branch_id')];
        }
        if ($user && in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return [$user->client_id, null];
        }
        if ($user && $user->user_type === 'branch_user') {
            return [$user->client_id, $user->branch_id];
        }
        if ($user && $user->user_type === 'employee') {
            // Employees creating other employees inherit their tenant.
            return [$user->client_id, $user->branch_id];
        }
        return [null, null];
    }

    /** Same scoping rules as the master tables — keeps every list query consistent. */
    private function applyScope($q, $user): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                return;
            }

            $mainBranchId = Branch::where('client_id', $clientId)->where('is_main', true)->value('id');
            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId) {
                      $ww->where('client_id', $clientId)->where(function ($wb) use ($branchId, $mainBranchId) {
                          $wb->whereNull('branch_id')->orWhere('branch_id', $branchId);
                          if ($mainBranchId) $wb->orWhere('branch_id', $mainBranchId);
                      });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    /** Find an employee row honouring the same tenant scope used in lists. */
    private function resolveRow(Request $request, int $id): Employee
    {
        $q = Employee::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    /** Block lower-ranked users from editing/deleting rows owned by higher-ranked ones. */
    private function guardHierarchicalAction($user, Employee $row, string $verb): void
    {
        if (!$user || $user->user_type === 'super_admin' || !$row->created_by) return;
        if ($row->created_by === $user->id) return;

        $rank = fn (?string $t) => match ($t) {
            'super_admin'  => 4,
            'client_admin' => 3,
            'client_user'  => 3,
            'branch_user'  => 2,
            'employee'     => 1,
            default        => 0,
        };
        $creator = User::find($row->created_by);
        if ($creator && $rank($creator->user_type) > $rank($user->user_type)) {
            abort(403, "You cannot {$verb} this employee — created by a higher-privileged user.");
        }
    }

    /**
     * Validation rules.
     *
     * The wizard now saves incrementally (one step at a time), so most
     * fields are nullable to accept partial payloads. Only `first_name` is
     * hard-required since it drives `display_name`. `email` is required
     * for store (we need it on the User row eventually), but on update
     * (when the User account already exists) we accept omitting it.
     */
    private function validatePayload(Request $request, ?int $employeeId = null): array
    {
        $ignoreUserId = null;
        $isUpdate = $employeeId !== null;
        if ($isUpdate) {
            $ignoreUserId = Employee::where('id', $employeeId)->value('user_id');
        }

        // Email rules: required + unique on store; nullable + still-unique on
        // update so partial step-3/step-4 PATCHes don't fail validation.
        $emailRule = $isUpdate ? ['nullable', 'email', 'max:191'] : ['required', 'email', 'max:191'];
        $emailRule[] = Rule::unique('users', 'email')
            ->whereNull('deleted_at')
            ->ignore($ignoreUserId);

        return $request->validate([
            // Identity — first_name is the only field the server insists on
            // (drives display_name + login user.name). Everything else can
            // arrive in a later step.
            'first_name'   => $isUpdate ? 'nullable|string|max:100' : 'required|string|max:100',
            'middle_name'  => 'nullable|string|max:100',
            'last_name'    => 'nullable|string|max:100',
            'gender'       => 'nullable|in:Male,Female,Other',
            'date_of_birth' => 'nullable|date',
            'nationality_country_id' => 'nullable|integer',
            'work_country_id'        => 'nullable|integer',
            'email'        => $emailRule,
            'mobile'       => 'nullable|string|max:30',
            'alt_mobile'   => 'nullable|string|max:30',

            // Current address
            'country_id'   => 'nullable|integer',
            'state_id'     => 'nullable|integer',
            'city'         => 'nullable|string|max:100',
            'address_line1' => 'nullable|string|max:255',
            'address_line2' => 'nullable|string|max:255',
            'pincode'      => 'nullable|string|max:20',

            // Permanent address (mirrors current address shape)
            'perm_country_id'   => 'nullable|integer',
            'perm_state_id'     => 'nullable|integer',
            'perm_city'         => 'nullable|string|max:100',
            'perm_address_line1' => 'nullable|string|max:255',
            'perm_address_line2' => 'nullable|string|max:255',
            'perm_pincode'      => 'nullable|string|max:20',

            'legal_entity_id' => 'nullable|integer',
            'location'        => 'nullable|string|max:191',
            // Department + designation arrive in step 2 of the wizard, so
            // they're nullable here — the frontend per-step validator gates
            // them when the user actually clicks Next on step 2.
            'department_id'   => 'nullable|integer',
            'designation_id'  => 'nullable|integer',
            'primary_role_id' => 'nullable|integer',
            'ancillary_role_id' => 'nullable|integer',
            'reporting_manager_id' => 'nullable|integer',
            'date_of_joining' => 'nullable|date',

            'probation_policy'   => 'nullable|string|max:50',
            'probation_months'   => 'nullable|integer|min:0|max:60',
            'notice_period'      => 'nullable|string|max:50',
            'notice_period_days' => 'nullable|integer|min:0|max:365',

            // Step 3 — Work Details
            'leave_plan'           => 'nullable|string|max:100',
            'holiday_list'         => 'nullable|string|max:100',
            'attendance_tracking'  => 'nullable|boolean',
            'shift'                => 'nullable|string|max:50',
            'weekly_off'           => 'nullable|string|max:100',
            'attendance_number'    => 'nullable|string|max:50',
            'time_tracking'        => 'nullable|string|max:50',
            'penalization_policy'  => 'nullable|string|max:100',
            'overtime'             => 'nullable|string|max:50',
            'expense_policy'       => 'nullable|string|max:100',
            'laptop_assigned'      => 'nullable|string|max:20',
            'laptop_asset_id'      => 'nullable|string|max:50',
            'mobile_device'        => 'nullable|string|max:100',
            'other_assets'         => 'nullable|string|max:255',

            // Step 4 — Compensation
            'enable_payroll'        => 'nullable|boolean',
            'pay_group'             => 'nullable|string|max:100',
            'annual_salary'         => 'nullable|numeric|min:0',
            'salary_frequency'      => 'nullable|string|max:30',
            'salary_effective_from' => 'nullable|date',
            'salary_structure'      => 'nullable|string|max:50',
            'tax_regime'            => 'nullable|string|max:50',
            'bonus_in_annual'       => 'nullable|boolean',
            'pf_eligible'           => 'nullable|boolean',
            'detailed_breakup'      => 'nullable|boolean',

            // Stage 4 — Payroll & Finance Setup
            'salary_payment_mode'   => 'nullable|in:bank,cheque,cash',
            'bank_name'             => 'nullable|string|max:150',
            // PAN-style account number can include letters (e.g. NRE/NRO),
            // so we don't enforce digits-only.
            'bank_account_number'   => 'nullable|string|max:30',
            // IFSC: 4 letters, 0, 6 alphanumeric (case-insensitive).
            'ifsc_code'             => 'nullable|string|regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/',
            'account_holder_name'   => 'nullable|string|max:150',
            'bank_branch'           => 'nullable|string|max:150',
            'bank_account_type'     => 'nullable|string|max:30',
            // UAN: exactly 12 digits when present.
            'uan_number'            => 'nullable|string|regex:/^\d{12}$/',
            // PAN: 5 letters, 4 digits, 1 letter.
            'pan_number'            => 'nullable|string|regex:/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/',
            'pf_deduction'          => 'nullable|string|max:50',
            'esi_applicable'        => 'nullable|in:Yes,No',
            'gratuity_nominee_name' => 'nullable|string|max:150',
            'agreed_ctc_lpa'        => 'nullable|numeric|min:0',
            'stage4_completed_at'   => 'nullable|date',

            'assets'  => 'nullable|array',
            'assets.*' => 'integer',
            'status'  => 'nullable|in:Active,Inactive,On Leave,Probation,Notice Period,Resigned,Terminated',
        ]);
    }

    /** Compute the next EMP-### atomically inside the create transaction. */
    private function allocateCode($clientId, $branchId): string
    {
        $q = Employee::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck('emp_code') as $code) {
            if (preg_match('/^EMP-(\d+)$/i', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'EMP-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    /** 12-char URL-safe random — no ambiguous chars (0/O, 1/l). */
    private function generatePassword(): string
    {
        $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        $digit = '23456789';
        $sym   = '@#$%';
        $pool  = $alpha . $digit . $sym;
        $out   = '';
        for ($i = 0; $i < 12; $i++) {
            $out .= $pool[random_int(0, strlen($pool) - 1)];
        }
        return $out;
    }

    /**
     * Default permissions for a freshly-onboarded employee. The principle:
     *   - dashboard / profile / master.employees → always view-only.
     *   - every master.* the granting admin can already view → view-only
     *     for the employee too.
     *
     * Without the second bullet, the Edit Employee wizard's Country / State
     * / Designation / Role / Legal Entity dropdowns return 403 the moment
     * the employee tries to read them, so the form looks empty. Admins can
     * still revoke individual masters per-employee from the Permissions UI.
     */
    private function grantSelfServicePermissions(User $user, $clientId, $branchId, $grantedBy): void
    {
        $alwaysOnSlugs = ['profile', 'dashboard', 'master.employees'];

        // Pull every master.* module the admin can view. We replicate just
        // can_view (never write/delete) so the employee can READ reference
        // data without being able to change it.
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
            if (!empty($adminMasterIds)) {
                $q->orWhereIn('id', $adminMasterIds);
            }
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
}
