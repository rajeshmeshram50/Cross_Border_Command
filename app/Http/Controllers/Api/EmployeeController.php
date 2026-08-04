<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordChangedMail;
use App\Mail\WelcomeCredentialsMail;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\Masters\LeavePlans;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\Settings;
use App\Traits\PasswordHistory;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class EmployeeController extends Controller
{
    use PasswordHistory;
    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
        'user:id,name,email,status,last_login_at,user_type,designation',
        'department:id,name,code',
        // `level` mirrors the 6 canonical role tiers (Director/CEO … Intern)
        // — the HR document-template generator filters its recipient list by
        // designation.level === template.role_type, so it must be selected.
        'designation:id,name,level',
        'holidayGroup:id,name',
        // role_category / role_type are needed so role-aware pickers (e.g. the
        // Recruitment "Assigned HR" = HR-category only, "Hiring Manager" =
        // exclude HR/Intern) can filter employees by their primary role.
        'primaryRole:id,name,role_category,role_type',
        'ancillaryRole:id,name',
        // Legal entity = the employing BRANCH (holds the GST/PAN/CIN + banks).
        // `city`/`country` back the read-only "Location" beside the picker.
        'legalEntity:id,name,code,city,state,country',
        'workCountry:id,name',
        'nationalityCountry:id,name',
        'country:id,name',
        'state:id,name,country_id',
        // Permanent-address pair so EmployeeProfile.tsx can show both
        // current and permanent country/state names without extra calls.
        'permCountry:id,name',
        'permState:id,name,country_id',
        'reportingManager:id,first_name,middle_name,last_name,display_name,emp_code,designation_id',
        // Manager's designation so the picker can label them by role
        // (e.g. "Anushka Bakde (HOD)") instead of the generic "(Employee)".
        'reportingManager.designation:id,name',
        // Fallback manager — populated when the picker selected a login User
        // (Client/Branch admin) instead of an Employee row. Only one of
        // reportingManager / reportingManagerUser is non-null per employee.
        'reportingManagerUser:id,name,email,user_type,designation',
        'laptopAsset:id,asset_name,code,asset_number',
        'mobileAsset:id,asset_name,code,asset_number',
        // Passport-size photo doc — fed to the `photo_url` accessor so the
        // list/detail JSON exposes it without an N+1 lookup.
        'photoDocument:id,employee_id,document_key,file_path',
        // Exit record (1:1) — surfaces last_working_day / notice_date on
        // the list payload so HrExitManagement can auto-flip Exit In
        // Progress → Exited once the notice period elapses, without an
        // extra round-trip per row. Selected columns only; the full row
        // is loaded on the exit modal itself via /employees/{id}/exit.
        'exit:id,employee_id,notice_date,last_working_day,exit_type,exit_case_status,completed_at,current_stage',
        // Prior work experience — drives the EmployeeProfile "Work Experience"
        // card with REAL data (was previously hardcoded sample values). Newest
        // first so the frontend's [0] is the most recent employer.
        'previousEmployments:id,employee_id,company_name,job_title,start_date,end_date',
    ];

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        // Include soft-deleted rows by default so the SPA's "Disabled
        // Employees" tab can render them. The toggle on each row uses
        // DELETE /employees/{id} which soft-deletes — without this the
        // disabled employees would silently disappear from the list.
        $q = Employee::query()->withTrashed()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

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

        // Assignment pickers (e.g. Recruitment's Hiring Manager / Assigned HR
        // dropdowns) opt into this so half-onboarded or inactive staff don't
        // appear as selectable people. Defaults OFF so the HR Employees master
        // list still shows everyone — including disabled rows and in-progress
        // onboarding. Mirrors the gate used by managers() and Exit Management.
        if ($request->boolean('onboarded_only')) {
            $q->whereNull('deleted_at')
              ->where('status', 'Active')
              ->where('onboarding_stage_completed', '>=', 6);
        }

        return response()->json($q->orderByDesc('id')->get());
    }

    public function show(Request $request, $id)
    {
        $row = $this->resolveRow($request, $this->resolveIdParam($id));
        // An employee may always view their OWN profile (the self-service
        // /profile page) without holding the master.employees can_view grant.
        // Viewing anyone else's record still requires the module permission.
        if ((int) ($row->user_id ?? 0) !== (int) $request->user()->id) {
            $this->authorize($request, 'can_view');
        }
        $empId = $this->resolveIdParam($id);
        $this->authorizeViewOrSelf($request, $empId);
        $row = $this->resolveRow($request, $empId);
        /* Resolved shift window (branch Shift Details → this employee's shift
           name). Computed, not stored: the employees table holds only the shift
           NAME, so the profile had no way to show the actual timings. */
        [$shiftStart, $shiftEnd] = $row->resolveShiftWindow();
        $row->setAttribute('shift_start', $shiftStart);
        $row->setAttribute('shift_end', $shiftEnd);
        return response()->json($row);
    }

    /**
     * Self-service / HR update of an employee's bank & payment details only.
     *
     * The full update() requires master.employees can_edit, which an ordinary
     * employee never holds — so once bank details were captured at onboarding,
     * nobody could correct them afterwards (#35: "no one can edit the bank
     * details"). This narrow endpoint lets the employee fix their OWN payout
     * account, while HR / branch users (holding can_edit) can fix anyone's in
     * their tenant. Only the bank columns are written — pay, status and every
     * other field are left untouched.
     */
    public function updateBankDetails(Request $request, $id)
    {
        $row = $this->resolveRow($request, $this->resolveIdParam($id));

        // Self may edit their own payout account without the module grant;
        // editing someone else's still requires can_edit (mirrors show()).
        $isSelf = (int) ($row->user_id ?? 0) === (int) $request->user()->id;
        if (!$isSelf) {
            $this->authorize($request, 'can_edit');
        }

        // A disabled (soft-deleted / terminated) employee accepts no edits —
        // same gate as update().
        if ($row->isDisabled()) {
            return response()->json([
                'message' => 'This employee is disabled — restore/re-activate them before editing bank details.',
            ], 422);
        }

        $data = $request->validate([
            'salary_payment_mode' => 'nullable|in:bank,cheque,cash',
            'bank_name'           => 'nullable|string|max:150',
            // PAN-style account numbers can include letters (NRE/NRO), so we
            // don't enforce digits-only — same rule as the onboarding wizard.
            'bank_account_number' => 'nullable|string|max:30',
            // IFSC: 4 letters, 0, 6 alphanumeric (case-insensitive).
            'ifsc_code'           => 'nullable|string|regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/',
            'account_holder_name' => 'nullable|string|max:150',
            'bank_branch'         => 'nullable|string|max:150',
            'bank_account_type'   => 'nullable|string|max:30',
        ], [
            'ifsc_code.regex' => 'Enter a valid IFSC code (e.g. HDFC0001234).',
        ]);

        // Store IFSC uppercased, the way the onboarding wizard persists it.
        if (!empty($data['ifsc_code'])) {
            $data['ifsc_code'] = strtoupper($data['ifsc_code']);
        }

        $row->fill($data)->save();

        return response()->json([
            'message' => 'Bank details updated.',
            'data'    => $row->only(array_keys($data)),
        ]);
    }

    /**
     * Holidays for THIS employee's assigned Holiday Group, resolved for a given
     * year — recurring holidays shift onto the requested year (mirrors
     * HolidayController::my). Gated by the employee can_view permission the
     * profile already requires, so a manager/admin can see any employee's
     * calendar without holding the separate hr.holiday module grant.
     *
     * Response: { group: {id,name}|null, year, holidays: [{name,date,type,...}] }
     */
    public function holidays(Request $request, $id)
    {
        $empId = $this->resolveIdParam($id);
        $this->authorizeViewOrSelf($request, $empId);
        $emp = $this->resolveRow($request, $empId);

        $year    = (int) ($request->query('year') ?: now()->year);
        $groupId = $emp->holiday_group_id;
        if (!$groupId) {
            return response()->json(['group' => null, 'year' => $year, 'holidays' => []]);
        }

        $holidays = Holiday::where('holiday_group_id', $groupId)
            ->orderBy('date')
            ->get()
            ->map(function (Holiday $h) use ($year) {
                $arr = $h->toArray();
                // Recurring holidays repeat yearly — surface them on the
                // requested year regardless of the original stored year.
                if ($h->is_recurring && $h->date) {
                    $d = Carbon::parse($h->date);
                    $arr['date'] = Carbon::create($year, $d->month, $d->day)->toDateString();
                }
                return $arr;
            })
            ->filter(fn ($h) => (int) substr((string) $h['date'], 0, 4) === $year)
            ->sortBy('date')
            ->values();

        return response()->json([
            'group'    => ['id' => $groupId, 'name' => $emp->holidayGroup?->name],
            'year'     => $year,
            'holidays' => $holidays,
        ]);
    }

    /**
     * Accept either a plain numeric id (legacy / internal usage) or the
     * encrypted token surfaced by `Employee::encrypted_id` (used by SPA
     * URLs so /hr/employees/EMP-001/profile becomes a non-guessable
     * blob). Falls back to a 404 instead of leaking decryption errors —
     * any malformed token reads as "no such employee" downstream once
     * resolveRow runs findOrFail.
     */
    private function resolveIdParam($id): int
    {
        if (is_numeric($id)) return (int) $id;
        $raw = (string) $id;
        if ($raw === '') return 0;

        // Encrypted token path — Employee::encrypted_id ships a URL-safe
        // version (+ → -, / → _, padding stripped). Reverse those swaps
        // before handing off to Crypt::decryptString.
        $normalised = strtr($raw, '-_', '+/');
        $pad = strlen($normalised) % 4;
        if ($pad) $normalised .= str_repeat('=', 4 - $pad);
        try {
            $decoded = \Illuminate\Support\Facades\Crypt::decryptString($normalised);
            if (is_numeric($decoded)) return (int) $decoded;
        } catch (\Throwable $e) {
            // not an encrypted token — fall through.
        }

        // Legacy URL fallback: callers (and bookmarks) sometimes still pass the
        // plain emp_code (e.g. EMP-001). emp_codes are allocated sequentially
        // PER TENANT, so the SAME code can exist in another client — an unscoped
        // lookup would return whichever row sorts first (often a different
        // tenant's employee). That stray id then fails the tenant-scoped
        // findOrFail in resolveRow with "No query results for Employee N"
        // (e.g. password reset on a newly-onboarded employee). Scope the lookup
        // to the caller's own tenant; super-admins resolve across tenants.
        // Codes now also repeat ACROSS THE BRANCHES of one client (each branch
        // restarts at EMP-001 — see the emp_code_unique_per_branch migration),
        // so a caller who belongs to a branch must resolve within that branch or
        // they'd land on their sibling branch's EMP-001. Callers who legitimately
        // span branches (client_admin / super_admin) keep the wider lookup.
        $user = request()->user();
        $q = Employee::withTrashed()->where('emp_code', $raw);
        if ($user && $user->user_type !== 'super_admin') {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            if ($user->branch_id) {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }
        $byEmpCode = $q->value('id');
        return (int) ($byEmpCode ?? 0);
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
        // their own tenant, super_admins see everything. Honour the active
        // BranchSwitcher selection so the manager picker matches the table.
        //
        // Additional gates to keep the dropdown trustworthy:
        //   - status === 'Active' — Inactive / Resigned / Terminated /
        //     Notice Period people shouldn't be picked as a new hire's
        //     reporting manager. Soft-deleted rows are already excluded
        //     by Eloquent's default scope on Employee (no withTrashed).
        //   - onboarding_stage_completed >= 6 — half-onboarded employees
        //     don't have the org-side context (department, designation,
        //     reporting line of their own) settled yet, so listing them
        //     as a manager would propagate stale data through the new
        //     hire's record. Mirrors the "fully onboarded" gate used by
        //     Exit Management.
        $eq = Employee::query()
            ->whereNotNull('id')
            ->where('status', 'Active')
            ->where('onboarding_stage_completed', '>=', 6)
            // Drop anyone tied to an exit case — whether it's still IN PROGRESS
            // (exit_case_status 'Open') or already finalised ('Closed' /
            // completed / final status "Exited"). An exit has no withdraw/cancel
            // path and EmployeeExit isn't soft-deleted, so the mere existence of
            // an exit row means the person is leaving or already gone: never a
            // valid reporting manager for a new hire. This also acts as
            // belt-and-braces for finalised exits whose employees.status column
            // wasn't flipped for some reason.
            ->whereDoesntHave('exit');
        $this->applyScope($eq, $user, $request->integer('branch_id') ?: null);
        // HOD designation ids so the picker can flag which employees are a
        // department's Head — the reporting-manager rule points a non-HOD hire
        // at their department's HOD (or the Branch User until one exists).
        $hodIds = \App\Support\DepartmentPermissionSync::hodDesignationIds();
        $employees = $eq
            // designation_id MUST be selected or the belongsTo('designation')
            // eager-load returns null and every label falls back to "(Employee)".
            ->select(['id', 'emp_code', 'display_name', 'first_name', 'last_name', 'designation_id', 'department_id'])
            ->with(['designation:id,name'])
            ->orderBy('display_name')
            ->get()
            ->map(fn($e) => [
                'id'            => $e->id,
                'kind'          => 'employee',
                // Department + HOD flag drive the reporting-manager rule on the
                // client; an employee reports to their department's HOD.
                'department_id' => $e->department_id,
                'is_hod'        => in_array((int) $e->designation_id, $hodIds, true),
                // Show the employee's DESIGNATION in brackets (e.g. "Anushka
                // Bakde (HOD)") rather than the generic "(Employee)" kind.
                // Falls back to "Employee" only when no designation is set.
                'label' => trim($e->display_name ?: trim($e->first_name . ' ' . $e->last_name))
                    . ' (' . ($e->designation?->name ?: 'Employee') . ')',
            ]);

        // Tenant login users that could plausibly act as managers — only
        // returned for client/branch admins so a non-super-admin still scopes
        // to their own org.
        $uq = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user'])
            ->where('status', 'active');
        if (!$user->isSuperAdmin()) {
            $uq->where('client_id', $user->client_id);
            // Branch-bound actors (a branch_user AND an employee granted HRMS
            // access) are strictly locked to their own branch — same rule
            // applyScope() enforces for the employee list. Without 'employee'
            // here, a branch employee adding a hire saw branch users from every
            // branch of the client in the Reporting Manager picker. Client-level
            // users (branch_id IS NULL — e.g. Director/CEO) stay visible.
            if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
                $uq->where(function ($q) use ($user) {
                    $q->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }
        $loginUsers = $uq
            ->select(['id', 'name', 'user_type', 'designation'])
            ->orderBy('name')
            ->get();

        // Resolve each login user's linked EMPLOYEE designation (employees are
        // tied to a login account via employees.user_id). When a user account
        // has an employee record, prefer that employee's designation so the
        // label reads "Name (HOD)" instead of the generic account type.
        $empDesigByUser = Employee::query()
            ->whereIn('user_id', $loginUsers->pluck('id')->all())
            ->whereNotNull('designation_id')
            ->with(['designation:id,name'])
            ->get(['id', 'user_id', 'designation_id'])
            ->reduce(function ($map, $e) {
                if ($e->user_id && $e->designation?->name) $map[$e->user_id] = $e->designation->name;
                return $map;
            }, []);

        $loginUsers = $loginUsers->map(fn($u) => [
            'id'    => $u->id,
            'kind'  => $u->user_type,
            // Designation in brackets — the linked employee's designation
            // first, then the user's own designation, finally the readable
            // user type (e.g. "Client Admin") when none is set.
            'label' => trim($u->name)
                . ' (' . (($empDesigByUser[$u->id] ?? $u->designation) ?: ucfirst(str_replace('_', ' ', $u->user_type))) . ')',
        ]);

        return response()->json([
            'employees'   => $employees->values(),
            'login_users' => $loginUsers->values(),
        ]);
    }

    /**
     * GET /employees/department-tree/{departmentId}
     *
     * Org chart for one department, scoped to the caller's client (+ active
     * branch): the Branch User(s) (Director / CEO) at the top, the single HOD,
     * the Team Leaders, then the remaining employees — the 4-tier hierarchy the
     * reporting-manager rule builds (employee → TL → HOD → Director).
     */
    public function departmentOrgTree(Request $request, int $departmentId)
    {
        $this->authorize($request, 'can_view');
        $user = $request->user();
        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        // Directors = the Branch User(s) of the client (+ active branch). They are
        // the roots of the chart (an HOD reports to a Branch User).
        $directors = User::query()
            ->where('client_id', $user->client_id)
            ->where('user_type', 'branch_user')
            ->where('status', 'active')
            ->when($branchFilter, fn ($q) => $q->where('branch_id', $branchFilter))
            ->orderBy('name')
            ->get(['id', 'name']);

        // Everyone in the department (client + branch scoped). No peer-isolation
        // here: the org chart is a management view of the whole department.
        $emps = Employee::query()
            ->where('client_id', $user->client_id)
            ->where('department_id', $departmentId)
            ->when($branchFilter, fn ($q) => $q->where('branch_id', $branchFilter))
            ->with(['designation:id,name', 'photoDocument'])   // photoDocument backs $e->photo_url (passport-size photo)
            ->orderBy('display_name')
            ->get();

        // Flat node map keyed by u{id} (Branch User) / e{id} (Employee).
        $byId = [];
        foreach ($directors as $d) {
            $byId['u' . $d->id] = ['id' => 'u' . $d->id, 'name' => $d->name, 'role' => 'Director / CEO', 'photo' => null];
        }
        foreach ($emps as $e) {
            $byId['e' . $e->id] = [
                'id'    => 'e' . $e->id,
                'name'  => $e->display_name ?: trim($e->first_name . ' ' . $e->last_name),
                'role'  => $e->designation?->name ?: 'Employee',
                'photo' => $e->photo_url,   // passport-size photo, or null → initials fallback
            ];
        }

        // Nest each employee under their actual reporting manager (an employee in
        // this set, or a Branch User). A manager outside the department (or unset)
        // falls back to hanging under the first Director so the chart stays connected.
        $firstDirector = $directors->first() ? 'u' . $directors->first()->id : null;
        $childrenOf = [];   // parentKey => [childKey, …]
        $orphanRoots = [];
        foreach ($emps as $e) {
            $ck = 'e' . $e->id;
            $pk = null;
            if ($e->reporting_manager_id && isset($byId['e' . $e->reporting_manager_id])) {
                $pk = 'e' . $e->reporting_manager_id;
            } elseif ($e->reporting_manager_user_id && isset($byId['u' . $e->reporting_manager_user_id])) {
                $pk = 'u' . $e->reporting_manager_user_id;
            } elseif ($firstDirector) {
                $pk = $firstDirector;
            }
            if ($pk) { $childrenOf[$pk][] = $ck; } else { $orphanRoots[] = $ck; }
        }

        // Roots = all Directors (each shows even with no reports) + any employee
        // whose manager couldn't be resolved and there was no Director to hang under.
        $rootKeys = array_values(array_unique(array_merge(
            array_map(fn ($d) => 'u' . $d->id, $directors->all()),
            $orphanRoots
        )));

        // Recursively assemble the nested tree, guarding against reporting cycles.
        $build = function ($key, array $seen = []) use (&$build, $byId, $childrenOf) {
            $node = $byId[$key];
            $seen[$key] = true;
            $kids = array_filter($childrenOf[$key] ?? [], fn ($ck) => empty($seen[$ck]));
            $node['children'] = array_values(array_map(fn ($ck) => $build($ck, $seen), $kids));
            return $node;
        };
        $roots = array_map(fn ($k) => $build($k), $rootKeys);

        return response()->json(['status' => true, 'data' => ['roots' => $roots]]);
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

    /**
     * Proactive uniqueness probe for the Mobile field.
     *
     *   GET /api/employees/check-mobile?mobile=...&exclude_employee_id=NN
     *
     * Mirrors the tenant scoping used by guardDuplicate() on store/update
     * so the frontend can show a duplicate error on blur — without this
     * the conflict only surfaces after the user clicks "Next" and the
     * server returns 422. Soft-deleted rows are intentionally ignored
     * (they don't block fresh hires there either).
     */
    public function checkMobile(Request $request)
    {
        $this->authorize($request, 'can_view');

        $mobile = trim((string) $request->query('mobile', ''));
        if ($mobile === '') {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        $excludeId = $request->integer('exclude_employee_id') ?: null;

        // For an edit, scope to the row's own client_id (mirrors update's
        // guardDuplicate call). For a new row, fall back to the resolved
        // ownership tenant (mirrors store's path).
        if ($excludeId !== null) {
            $clientId = Employee::withTrashed()->where('id', $excludeId)->value('client_id');
        } else {
            [$clientId] = $this->resolveOwnership($request);
        }

        $q = Employee::query()->where('mobile', $mobile);
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        if ($excludeId !== null) $q->where('id', '!=', $excludeId);

        // Only need to know IF the number is taken — not whose it is. Pulling
        // just the id (or existence) avoids loading another employee's PII.
        if (! $q->exists()) {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        // Generic message — we deliberately DON'T reveal the conflicting
        // employee's name or code. Surfacing another employee's identity (and
        // implicitly, which number belongs to whom) in a validation message
        // is a PII-disclosure the QA flagged. The caller only needs to know
        // the number is taken, not by whom.
        $message = 'This mobile number is already in use by another employee.';

        return response()->json([
            'available' => false,
            // conflict kept as a boolean-ish marker only — no name/emp_code
            // leaked back to the client.
            'conflict'  => true,
            'message'   => $message,
        ]);
    }

    /**
     * Available assets for the Stage 1 — Assets & Security dropdowns.
     *
     *   GET /api/employees/available-assets?category=laptop|mobile|other
     *                                       [&exclude_employee_id=NN]
     *
     * - laptop / mobile  → master_assets in the matching system category.
     * - other            → master_assets NOT in laptop/mobile categories.
     *
     * Assets currently assigned to ANOTHER employee are filtered out so
     * the dropdown only shows free devices. The asset already on the
     * row being edited (`exclude_employee_id`) stays visible so the
     * admin can keep their existing selection.
     */
    public function availableAssets(Request $request)
    {
        $this->authorize($request, 'can_view');
        $category = strtolower((string) $request->query('category', ''));
        $excludeEmployeeId = $request->query('exclude_employee_id');

        if (!in_array($category, ['laptop', 'mobile', 'other'], true)) {
            abort(422, 'category must be one of laptop, mobile, other');
        }

        // Match by category NAME (case-insensitive), accepting any category
        // whose name is "Laptop" or "Mobile" — not just the seeded system
        // rows. In real tenants we found assets linked to user-created
        // categories that share the name (a manager named their own "Laptop"
        // category while the seeded one already existed), which caused the
        // Stage 1 dropdown to silently come back empty even though the
        // Asset Master page clearly listed 25 laptops. Matching by name is
        // forgiving of that data divergence while still scoped to laptop /
        // mobile only — "other" excludes any category named laptop/mobile,
        // so accidental double-counting is impossible.
        $catRows = \App\Models\Masters\AssetCategories::query()
            ->whereRaw('LOWER(name) IN (?, ?)', ['laptop', 'mobile'])
            ->get(['id', 'name']);
        $laptopCatIds = [];
        $mobileCatIds = [];
        foreach ($catRows as $row) {
            $n = strtolower($row->name);
            if ($n === 'laptop') $laptopCatIds[] = (int) $row->id;
            if ($n === 'mobile') $mobileCatIds[] = (int) $row->id;
        }

        $assetQ = \App\Models\Masters\Assets::query();
        // Tenant scope — assets created by the same client/branch as the
        // current user, plus globally-owned ones (client_id IS NULL).
        $u = $request->user();
        if ($u && !$u->isSuperAdmin()) {
            $assetQ->where(function ($w) use ($u) {
                $w->whereNull('client_id')->orWhere('client_id', $u->client_id);
            });
        }

        if ($category === 'laptop') {
            if (empty($laptopCatIds)) return response()->json([]);
            $assetQ->whereIn('asset_type_id', $laptopCatIds);
        } elseif ($category === 'mobile') {
            if (empty($mobileCatIds)) return response()->json([]);
            $assetQ->whereIn('asset_type_id', $mobileCatIds);
        } elseif ($category === 'other') {
            $excludeIds = array_merge($laptopCatIds, $mobileCatIds);
            if (!empty($excludeIds)) {
                $assetQ->whereNotIn('asset_type_id', $excludeIds);
            }
        }

        // Active-only — disposed / under-repair devices shouldn't be
        // assignable to a new hire.
        $assetQ->where(function ($w) {
            $w->whereNull('status')->orWhere('status', 'Active');
        });

        // Pull every asset the requester might see, then strip the ones
        // already booked by other employees.
        $assets = $assetQ->orderBy('asset_name')->get();
        $assetIds = $assets->pluck('id')->all();

        $bookedIds = collect();
        if (!empty($assetIds)) {
            // Only ACTIVE-roster employees actually hold an asset. Someone who
            // has exited (Resigned / Terminated) has effectively returned their
            // devices, so their old assignment must NOT keep the asset locked —
            // otherwise the picker shows "No other assets available" forever
            // even though the holder has left. Soft-deleted rows are excluded
            // for the same reason.
            $bookingQ = Employee::query()
                ->whereNull('deleted_at')
                ->whereNotIn('status', ['Resigned', 'Terminated']);
            if ($excludeEmployeeId) {
                $bookingQ->where('id', '!=', (int) $excludeEmployeeId);
            }
            $rows = $bookingQ->select(['id', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids'])->get();
            foreach ($rows as $r) {
                if ($r->laptop_master_asset_id) $bookedIds->push((int) $r->laptop_master_asset_id);
                if ($r->mobile_master_asset_id) $bookedIds->push((int) $r->mobile_master_asset_id);
                foreach ((array) ($r->other_master_asset_ids ?? []) as $aid) {
                    $bookedIds->push((int) $aid);
                }
            }
        }
        $bookedSet = $bookedIds->unique()->flip();

        return response()->json(
            $assets
                ->reject(fn($a) => $bookedSet->has($a->id))
                ->map(function ($a) {
                    // Label format: "AST-#### — Asset Name". Prefer the
                    // auto-generated `code` (the public asset ID shown
                    // in the master table); fall back to `asset_number`
                    // (legacy free-text serial) if code is missing.
                    $idPart = $a->code ?: $a->asset_number;
                    $label  = trim(($idPart ? $idPart . ' — ' : '') . ($a->asset_name ?? ''));
                    return [
                        'id'            => $a->id,
                        'asset_name'    => $a->asset_name,
                        'asset_number'  => $a->asset_number,
                        'code'          => $a->code,
                        'label'         => $label,
                    ];
                })
                ->values(),
        );
    }

    /* ─────────────────────────────────────────────────────────────────
     *  STORE — creates Employee + paired User login + sends welcome mail
     * ───────────────────────────────────────────────────────────────── */

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);
        $data = $this->mirrorAncillaryRoles($data);
        $this->assertAssetsNotDoubleBooked($data, null);

        try {
            return DB::transaction(function () use ($request, $data) {
                $auth = $request->user();
                [$clientId, $branchId] = $this->resolveOwnership($request);

                // Reject obvious duplicate hires within the same tenant.
                // The Laravel validator already blocks identical login
                // emails (unique on users.email), but the form accepted
                // re-uses of the same human paired with a tweaked email.
                // Catch those before the row is written.
                $this->guardDuplicate($data, $clientId, null);

                // Only one Head of Department (HOD) is allowed per department
                // (within a branch) — the branch's single sales/ops head.
                $this->assertSingleHodPerDepartment($data, $clientId, $branchId, null);

                // Enforce the per-branch user cap before we provision a
                // new User row. Every employee gets a login account
                // (User::create below) so each new hire consumes one
                // slot against Branch.max_users. Skipping this check is
                // why a branch configured for "1 user" could still grow
                // to N — the cap was stored but never read.
                $this->assertBranchUserCap($branchId);

                // Provision the login account first — if the email collides we
                // want the whole txn to roll back before writing the employee row.
                //
                // user.status mirrors the forced employee.status='Inactive' below.
                // The wizard only captures half the onboarding data; admins must
                // flip the row to Active explicitly once the rest is filled in
                // (assets, payroll review, etc.) and that flip cascades the
                // login open via update(). Without this mirror, fresh hires
                // could sign in immediately even though their employee record
                // was deliberately held Inactive — a hole QA flagged.
                $rawPassword = $this->generatePassword();
                $loginUser = User::create([
                    'name' => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'email' => $data['email'],
                    'password' => Hash::make(Str::random(40)),
                    'password_encrypted' => null,
                    'phone'         => $data['mobile'] ?? null,
                    'user_type'     => 'employee',
                    'client_id'     => $clientId,
                    'branch_id'     => $branchId,
                    // Match the Employee row default (now Active). Without
                    // this, a wizard-created employee could open the
                    // welcome email, try to log in, and get "Your account
                    // is not active" even though the admin never disabled
                    // them and the Employees list showed them as Active.
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

                // Newly-added employees default to Active so they show
                // up in the Active tab immediately. The frontend can
                // still override (e.g. for a pre-joining record), but
                // when no status is sent we want a sensible default.
                //
                // The earlier "Force Inactive" policy was creating UX
                // confusion — admins clicked "Add Employee", completed
                // the wizard, then couldn't find their new hire in the
                // Active list. Defaulting to Active matches the natural
                // mental model: I just added them, they're working here.
                $payload = array_merge($data, [
                    'client_id'             => $clientId,
                    'branch_id'             => $branchId,
                    'created_by'            => $auth?->id,
                    'user_id'               => $loginUser->id,
                    'emp_code'              => $empCode,
                    'display_name'          => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'status'                => $data['status'] ?? 'Active',
                    'wizard_step_completed' => $stepCompleted,
                ]);
                $employee = Employee::create($payload);

                // Mirror the leave_plan dropdown selection into the
                // leave_plan_employees pivot. The frontend used to do
                // this via a separate fire-and-forget POST after save,
                // which dropped silently when the call lost its race
                // with the modal closing — employees got
                // employees.leave_plan set but no pivot row, so their
                // own Leave tab rendered "No leave plan assigned".
                // Doing it here inside the same transaction makes the
                // pivot the source of truth.
                $this->syncLeavePlanPivot($employee, $data['leave_plan'] ?? null, $auth?->id);

                // Backfill emp_code onto the user row so legacy code that reads
                // user.employee_code keeps working.
                $loginUser->update(['employee_code' => $empCode]);

                // Seed the standard "self-service" permission row so the new
                // hire can at least sign in and see their own profile module.
                // Admin can grant additional modules from the UI later.
                $this->grantSelfServicePermissions($loginUser, $clientId, $branchId, $auth?->id);

                // If this hire is a department HOD, re-parent the department's
                // employees to them and auto-grant the department permissions.
                $this->applyHodOnboarding($employee, $auth?->id);

                $employee->load(self::WITH);

                /* Welcome email is intentionally NOT sent here. Step 1
                 * only captures basic identity — sending credentials
                 * before the admin has finished assets / payroll / KYC
                 * means the employee logs in to a half-built profile.
                 * The mail fires from update() when the wizard hits
                 * Step 4 (final step). password_encrypted on the user row
                 * preserves the random password generated above so we can
                 * decrypt + include it in the welcome body later. */

                return response()->json([
                    'message'  => 'Employee created. Welcome email will be sent once the wizard completes Step 4.',
                    'employee' => $employee,
                ], 201);
            });
        } catch (QueryException $e) {
            // Postgres unique violation (23505). Read the CONSTRAINT NAME before
            // blaming a field: this used to map every 23505 raised anywhere in
            // the transaction onto the email message, so an emp_code clash
            // ("EMP-001 already used in another branch of this client") was
            // reported to QA as "this email already has an account" while the
            // address was brand new. Only claim the email is taken when the
            // email index is the one that actually fired.
            if ($e->getCode() === '23505') {
                $constraint = $e->getMessage();
                if (str_contains($constraint, 'users_email')) {
                    throw ValidationException::withMessages([
                        'email' => ['This email already has an account in this organization. Each email can be used only once per organization — use a different email.'],
                    ]);
                }
                if (str_contains($constraint, 'emp_code')) {
                    throw ValidationException::withMessages([
                        'employee_code' => ['Could not allocate an employee code — that code is already in use. Please retry.'],
                    ]);
                }
                if (str_contains($constraint, 'pan_number')) {
                    throw ValidationException::withMessages([
                        'pan_number' => ['This PAN is already registered to another employee.'],
                    ]);
                }
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

        // Block any mutation on a disabled employee. "Disabled" means EITHER
        // soft-deleted (the Remove action) OR a terminal status set via the
        // edit form (Inactive / Resigned / Terminated) — both kill the login,
        // so neither should accept further profile changes. The row is still
        // resolvable (withTrashed) so the admin can restore it, but business
        // updates — especially the onboarding wizard's PUTs — must not proceed
        // against a disabled record. Restore/re-activate first, then edit.
        // (Exception: a PUT whose ONLY effect is flipping status back to an
        // active value is allowed through so re-activation still works.)
        $incomingStatus = (string) $request->input('status', '');
        $reactivating   = $incomingStatus !== ''
            && !in_array(strtolower($incomingStatus), ['inactive', 'resigned', 'terminated'], true);
        if ($row->isDisabled() && !$reactivating) {
            return response()->json([
                'message' => 'This employee is disabled — restore/re-activate them from the HR Employees page before editing or continuing onboarding.',
            ], 422);
        }

        $data = $this->validatePayload($request, $row->id);
        $data = $this->mirrorAncillaryRoles($data);
        $this->assertAssetsNotDoubleBooked($data, $row->id);
        // Same duplicate guard as store(), but exclude the row being
        // edited so saving an unchanged employee never reports itself
        // as its own duplicate.
        $this->guardDuplicate($data, $row->client_id, $row->id);

        // One HOD per department (branch-scoped). Fall back to the row's own
        // department/branch when a partial wizard PUT omits them.
        $this->assertSingleHodPerDepartment($data, $row->client_id, $row->branch_id, $row->id, $row);

        // Track wizard progress as a high-watermark — never decrease it.
        // The frontend posts the step number it just completed; we keep
        // the maximum so a user editing an already-finished employee
        // can't accidentally roll the progress meter backwards.
        $stepFromRequest = (int) $request->input('wizard_step_completed', 0);
        $oldStep = (int) $row->wizard_step_completed;
        $newStep = max($oldStep, $stepFromRequest);
        // (Welcome-email-on-Step-4 transition logic removed — email is now
        // sent immediately from store(). Step transition tracking below is
        // still used by the macro stage tracker.)

        // Same high-watermark rule for the macro 6-stage tracker.
        $macroFromRequest = (int) $request->input('onboarding_stage_completed', 0);
        $newMacro = max((int) $row->onboarding_stage_completed, $macroFromRequest);
        // Stage 1's internal wizard fully done ⇒ macro stage ≥ 1.
        if ($newStep >= 4) {
            $newMacro = max($newMacro, 1);
        }

        $oldStatus = (string) $row->getOriginal('status');

        $authId = $request->user()?->id;
        DB::transaction(function () use ($row, $data, $newStep, $newMacro, $oldStatus, $authId) {
            // first_name might not be in $data on a partial step-3/step-4
            // PATCH (the frontend only sends the fields for the step it
            // just saved). Fall back to the existing row value so
            // display_name doesn't get smashed to "" when the wizard
            // saves a later step alone.
            $first  = $data['first_name']  ?? $row->first_name;
            $middle = array_key_exists('middle_name', $data) ? $data['middle_name'] : $row->middle_name;
            $last   = array_key_exists('last_name', $data)   ? $data['last_name']   : $row->last_name;
            $row->update(array_merge($data, [
                'display_name'                => Employee::composeDisplayName($first, $middle, $last),
                'wizard_step_completed'       => $newStep,
                'onboarding_stage_completed'  => $newMacro,
            ]));

            // Re-run HOD wiring in case this save made the employee an HOD
            // (or changed their department) — idempotent when already applied.
            $this->applyHodOnboarding($row->refresh(), $authId);

            // Keep the leave_plan_employees pivot in sync whenever the
            // Step 3 PUT carries a leave_plan value. A partial PATCH
            // that doesn't touch Step 3 won't have the key, so we
            // intentionally skip the sync rather than clearing the
            // existing assignment. Same source-of-truth rationale as
            // store() — without this the employee's Leave tab stays
            // empty even though the dropdown shows the plan selected.
            if (array_key_exists('leave_plan', $data)) {
                $this->syncLeavePlanPivot($row, $data['leave_plan'], $authId);
            }

            // Keep the linked user in sync — name + email + phone changes here
            // should land on the login account too.
            if ($row->user) {
                $newEmail = $data['email'] ?? $row->user->email;
                // Changing the login email is an identity-level change, so the
                // OLD password must stop working: flag a forced reset and revoke
                // any live tokens. The user can't sign in again until they set a
                // new password via Forgot Password (OTP goes to the NEW email),
                // which clears the flag. Compared case-insensitively so a pure
                // casing edit doesn't needlessly lock the account.
                $emailChanged = strcasecmp((string) $newEmail, (string) $row->user->email) !== 0;

                $row->user->update([
                    'name'        => $row->display_name,
                    'email'       => $newEmail,
                    'phone'       => $data['mobile'] ?? $row->user->phone,
                    'designation' => $data['designation_name'] ?? $row->user->designation,
                ]);

                if ($emailChanged) {
                    $row->user->update(['must_reset_password' => true]);
                    $row->user->tokens()->delete();
                }

                // Cascade employee.status → users.status when it actually
                // changes. Inactive/Resigned/Terminated must block login;
                // anything else (Active/Probation/On Leave/Notice Period)
                // keeps the login open. Tokens are revoked on the
                // transition-to-disabled so any stale Sanctum session is
                // killed immediately. Without this guard, admins flipping
                // status via the edit form leave the user able to sign in.
                $newStatus = array_key_exists('status', $data)
                    ? (string) $data['status']
                    : $oldStatus;
                if (strcasecmp($oldStatus, $newStatus) !== 0) {
                    $disabled = in_array(strtolower($newStatus), ['inactive', 'resigned', 'terminated'], true);
                    $row->user->update(['status' => $disabled ? 'inactive' : 'active']);
                    if ($disabled) {
                        $row->user->tokens()->delete();
                    }
                }
            }
        });

        $row->load(self::WITH);

        // Payroll connection — if this edit touched a field the payroll engine
        // reads (salary / PF / gender / state / bank / joining / status), push
        // the change into any non-locked payslip already generated for this
        // employee so payroll stays in sync everywhere. Locked runs are frozen.
        $payrollFields = ['annual_salary', 'enable_payroll', 'pf_eligible', 'gender', 'state_id',
            'date_of_joining', 'status', 'bank_account_number', 'ifsc_code', 'salary_payment_mode'];
        if (!empty(array_intersect($payrollFields, array_keys($data)))) {
            try {
                app(\App\Services\PayrollService::class)->recomputeEmployeePayslips((int) $row->id);
            } catch (\Throwable $e) {
                // Never block an employee save on a payroll recompute hiccup.
            }
        }

        /* Welcome / credentials email fires when the wizard reaches
         * Step 4 (the final step). We use password_encrypted as the
         * "haven't sent yet" marker — once the welcome goes out, we
         * clear that column so subsequent Step 4 PUTs don't re-send.
         *
         * Trigger condition is intentionally lenient: $newStep >= 4
         * (not the strict $oldStep < 4 && $newStep >= 4 transition the
         * old code used). That strict transition silently failed when
         * the frontend updated Step 4 without bumping the watermark
         * cleanly — admins reported "no welcome ever arrived". With
         * the lenient check + password_encrypted clear, we get a
         * single, reliable send the first time the wizard saves at
         * Step 4 or higher.
         *
         * Recipient: $row->user->email — the personal email captured
         * by the wizard's "Personal Email" field. */
        if (
            $oldStep < 4
            && $newStep >= 4
            && Settings::shouldSendMail('newUser')
            && $row->user
            && !$row->user->last_login_at
        ) {
            try {
                $rawPassword = $this->generatePassword();

                $row->user->forceFill([
                    'password' => Hash::make($rawPassword),
                    'password_encrypted' => Crypt::encryptString($rawPassword),
                ])->save();

                $clientName = \App\Models\Client::find($row->client_id)?->org_name ?? 'Your Organization';

                Mail::to($row->user->email)->send(new WelcomeCredentialsMail(
                    $row->user->name,
                    $row->user->email,
                    $rawPassword,
                    'employee',
                    $clientName,
                    PasswordChangedMail::resolveLoginUrl($request),
                ));

                $row->user->forceFill(['password_encrypted' => null])->save();
            } catch (\Throwable $e) {
                Log::warning('Employee welcome mail (Step 4) failed', [
                    'employee_id' => $row->id,
                    'email' => $row->user->email ?? null,
                    'new_step' => $newStep,
                    'error' => $e->getMessage(),
                ]);
            }
        }
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
            // Existing Sanctum tokens are revoked too — without that, any
            // already-issued token keeps authenticating because no middleware
            // re-checks user.status on subsequent requests.
            $row->user?->update(['status' => 'inactive']);
            $row->user?->tokens()->delete();
            $row->delete();
        });

        return response()->json(['message' => 'Employee removed and login disabled.']);
    }

    /**
     * Re-enable a soft-deleted employee. Inverse of destroy() — clears
     * deleted_at, flips the row status back to Active, and re-enables
     * the linked login user. The row is fetched with trashed scope so
     * we can find it after destroy() hid it.
     */
    public function restore(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        DB::transaction(function () use ($row) {
            if ($row->trashed()) {
                $row->restore();
            }
            // Some rows may have been disabled via PUT-status alone
            // (no soft-delete). Either way, normalise back to Active.
            if (strtolower((string) $row->status) !== 'active') {
                $row->update(['status' => 'Active']);
            }
            // Re-enable the paired login account so the employee can
            // sign in again.
            $row->user?->update(['status' => 'active']);
        });

        $row->load(self::WITH);
        return response()->json([
            'message'  => 'Employee re-enabled.',
            'employee' => $row,
        ]);
    }

    /**
     * Permanently delete a soft-deleted employee. Only callable on a row
     * already in the Disabled tab — we refuse to force-delete an active
     * employee outright to prevent accidental data loss from a single
     * misclick on the wrong tab.
     *
     * The paired login user is NOT hard-deleted: it gets locked to
     * inactive and its tokens revoked, but the row stays so permissions
     * + activity_logs + audit trails that reference user_id don't go
     * dangling. Only the Employee row itself is removed for good.
     */
    public function forceDestroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        // Only block a genuinely-ACTIVE employee. "Disabled" can mean either
        // soft-deleted (toggle/destroy) OR a status of Inactive/Terminated/
        // Resigned (set via the edit form or Exit Management) — all of which the
        // frontend shows in the Disabled tab. Any of those are deletable here;
        // a still-active employee must be disabled first to avoid a misclick.
        $status = strtolower((string) $row->status);
        $isDisabled = $row->trashed()
            || in_array($status, ['inactive', 'terminated', 'resigned'], true);
        if (!$isDisabled) {
            return response()->json([
                'message' => 'This employee is still active. Disable them first, then delete.',
            ], 422);
        }

        $displayName = $row->display_name ?: trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? ''));

        DB::transaction(function () use ($row) {
            // Lock + revoke the login but keep the user row — permissions,
            // activity_logs and other tables FK to users.id and we don't
            // want orphans.
            $row->user?->update(['status' => 'inactive']);
            $row->user?->tokens()->delete();
            // Wipe the Employee row itself. Soft-deletes related rows
            // (documents, exit, previous_employments) usually cascade via
            // model events or FK ON DELETE — verify on your schema if you
            // add new related tables.
            $row->forceDelete();
        });

        return response()->json([
            'message' => "Permanently removed {$displayName}.",
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

    /** Cap the granular permission check to the 'master.employees' module. */
    /**
     * Like authorize('can_view'), but always allows a user to read THEIR OWN
     * employee record even without the master.employees grant. Ordinary
     * employees don't hold the HR module permission, yet the self-service
     * profile (/profile → EmployeeProfile) and its panels (Holidays, etc.)
     * must still load their own data. Anyone else falls back to the normal
     * can_view gate.
     */
    private function authorizeViewOrSelf(Request $request, int $employeeId): void
    {
        $user = $request->user();
        if ($user && $employeeId > 0) {
            $ownId = Employee::where('user_id', $user->id)->value('id');
            if ($ownId && (int) $ownId === $employeeId) return;
        }
        $this->authorize($request, 'can_view');
    }

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

    /** Same scoping rules as the master tables — keeps every list query consistent.
     *  When the SPA's BranchSwitcher injects `?branch_id=N`, we narrow further
     *  within the user's existing tenant scope so a client_admin can drill
     *  into a single branch's data. The narrow only
     *  applies if the requested branch belongs to the user's own client (else
     *  silently ignored — no cross-tenant leak even with a hostile param). */
    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            // super_admin can pass branch_id directly; trust it (they cross tenants by design)
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;

            // Every branch is an isolated peer — strict branch isolation. They
            // see ONLY rows belonging to their own branch within this tenant.
            // An employee booked under another branch must not appear in this
            // branch user's list. Globally-owned rows (client_id IS NULL) stay
            // visible — they're system rows, not tenant data.
            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                    ->orWhere(function ($ww) use ($clientId, $branchId) {
                        $ww->where('client_id', $clientId)->where('branch_id', $branchId);
                    });
            });
            // Branch users can't switch — ignore any incoming branch_id.
            return;
        }

        $q->whereRaw('1 = 0');
    }

    /** Apply BranchSwitcher's selected-branch filter only after verifying the
     *  branch belongs to the granter's own client. Cross-tenant ids are ignored
     *  (not 403'd) so a stale localStorage value from a prior login doesn't
     *  brick the page — they just see "all branches in my client" until they
     *  re-pick. */
    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    /** Find an employee row honouring the same tenant scope used in lists.
     *  Includes soft-deleted rows since the index() now surfaces them
     *  for the Disabled tab — restore + show + edit on a disabled row
     *  must all be able to find it. */
    private function resolveRow(Request $request, int $id): Employee
    {
        $q = Employee::query()->withTrashed()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

   
    public function setPassword(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');

        $employee = $this->resolveRow($request, $this->resolveIdParam($id));
        $this->guardHierarchicalAction($request->user(), $employee, 'reset the password for');

        // Load the FULL user row — the eager-loaded `user` relation restricts
        // columns (no `password`), which would break the reuse-check + history.
        $target = $employee->user_id ? User::find($employee->user_id) : null;
        if (!$target) {
            abort(422, 'This employee has no linked login account, so there is no password to reset.');
        }

        if ($target->id === $request->user()->id) {
            abort(422, 'Use the regular Change Password option to update your own password.');
        }

        $data = $request->validate([
            'password' => 'required|string|min:8|confirmed',
        ]);

        if ($this->isPasswordReused($target, $data['password'])) {
            return response()->json(['message' => $this->passwordReuseMessage()], 422);
        }

        // Save the OLD hash to history BEFORE overwriting it.
        $this->recordPasswordHistory($target);
        $target->update(['password' => Hash::make($data['password'])]);

        // SMTP issue never rolls back the (already persisted) password change.
        if (Settings::shouldSendMail() && $target->email) {
            try {
                Mail::to($target->email)->send(new PasswordChangedMail(
                    $target->name,
                    $target->email,
                    $data['password'],
                    PasswordChangedMail::resolveLoginUrl($request),
                    \App\Support\BrandingResolver::forUser($target),
                ));
            } catch (\Throwable $e) {
                Log::warning('Password-changed confirmation mail failed (admin reset)', [
                    'target_user_id' => $target->id,
                    'email'          => $target->email,
                    'error'          => $e->getMessage(),
                ]);
            }
        }

        return response()->json(['message' => 'Password updated for ' . ($employee->display_name ?: $target->name) . '.']);
    }

    private function assertBranchUserCap(?int $branchId): void
    {
        if (!$branchId) return;
        $branch = Branch::find($branchId);
        if (!$branch) return;

        $cap = (int) ($branch->max_users ?? 0);
        if ($cap <= 0) return; // 0 / null → unlimited

        // Count only ACTIVE login accounts against the cap. Deleting an employee
        // keeps their user row but flips it to 'inactive' (so audit logs /
        // permissions don't go dangling) — those freed-up seats must NOT keep
        // occupying the branch's user limit. Null status counts as active.
        $current = User::where('branch_id', $branchId)
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', '!=', 'inactive');
            })
            ->count();
        if ($current >= $cap) {
            throw ValidationException::withMessages([
                'email' => [
                    "This branch is configured for at most {$cap} user"
                        . ($cap === 1 ? '' : 's')
                        . " and is already at the cap ({$current})."
                        . ' Raise the limit on the branch first, or remove an existing user.',
                ],
            ]);
        }
    }

    /** Block lower-ranked users from editing/deleting rows owned by higher-ranked ones. */
    private function guardHierarchicalAction($user, Employee $row, string $verb): void
    {
        if (!$user || $user->user_type === 'super_admin' || !$row->created_by) return;
        if ($row->created_by === $user->id) return;

        $rank = fn(?string $t) => match ($t) {
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
     * Enforce a single Head of Department (HOD) per department, scoped to the
     * branch. Only fires when the employee being saved is itself an HOD; the
     * reporting-manager columns are irrelevant here (an HOD reports to a
     * branch_user, which is validated separately on the form). Throws a 422 on
     * `designation_id` when another HOD already exists in the same
     * (client, branch, department).
     *
     * @param  array  $data       validated payload
     * @param  object|null  $existing  the row being updated (for fallbacks)
     */
    private function assertSingleHodPerDepartment(array $data, ?int $clientId, ?int $branchId, ?int $excludeEmployeeId, $existing = null): void
    {
        $designationId = $data['designation_id'] ?? ($existing->designation_id ?? null);
        $departmentId  = $data['department_id']  ?? ($existing->department_id  ?? null);
        $branchScope   = $data['branch_id']      ?? $branchId ?? ($existing->branch_id ?? null);
        if (!$designationId || !$departmentId) {
            return;   // can't be an HOD-in-a-department without both
        }

        // Is the chosen designation the HOD designation? (match by name/level)
        $hodName = \App\Support\SalesVisibility::DESIGNATION_MANAGER; // 'Head of Department (HOD)'
        $chosen = \App\Models\Masters\Designations::find($designationId);
        $isHod = $chosen && (
            strcasecmp((string) $chosen->name,  $hodName) === 0 ||
            strcasecmp((string) $chosen->level, $hodName) === 0
        );
        if (!$isHod) {
            return;
        }

        // All designation ids that mean HOD (covers any client-scoped copies).
        $hodIds = \App\Models\Masters\Designations::query()
            ->where(function ($q) use ($hodName) {
                $q->whereRaw('LOWER(name) = ?',  [strtolower($hodName)])
                  ->orWhereRaw('LOWER(level) = ?', [strtolower($hodName)]);
            })
            ->pluck('id')
            ->all();

        $dupe = \App\Models\Employee::query()
            ->where('client_id', $clientId)
            ->where('department_id', $departmentId)
            ->when($branchScope, fn ($q) => $q->where('branch_id', $branchScope))
            ->whereIn('designation_id', $hodIds)
            ->when($excludeEmployeeId, fn ($q) => $q->where('id', '!=', $excludeEmployeeId))
            ->exists();

        if ($dupe) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'designation_id' => ['This department already has a Head of Department (HOD). Only one HOD is allowed per department.'],
            ]);
        }
    }

    /**
     * When an employee is (or becomes) the HOD of a department, wire up the
     * department around them:
     *   (a) Re-parent — employees in the same (client, branch, department) that
     *       currently report to a Branch User (or have no manager) are re-pointed
     *       to this HOD. Employees already reporting to someone else are left as-is.
     *   (b) Auto-grant — the HOD's module permissions are overwritten from the
     *       department's saved department_permissions (only those modules).
     * No-op when the employee isn't an HOD. Idempotent, so it's safe to call on
     * every save.
     */
    private function applyHodOnboarding(Employee $employee, ?int $actingUserId): void
    {
        $designationId = $employee->designation_id;
        $departmentId  = $employee->department_id;
        if (!$designationId || !$departmentId || !$employee->user_id) {
            return;
        }
        if (!in_array((int) $designationId, \App\Support\DepartmentPermissionSync::hodDesignationIds(), true)) {
            return; // not an HOD
        }

        // (a) Re-parent employees under a Branch User (or with no manager).
        $branchUserIds = User::where('client_id', $employee->client_id)
            ->where('user_type', 'branch_user')
            ->pluck('id')->all();

        Employee::query()
            ->where('client_id', $employee->client_id)
            ->where('branch_id', $employee->branch_id)
            ->where('department_id', $departmentId)
            ->where('id', '!=', $employee->id)
            ->where(function ($q) use ($branchUserIds) {
                $q->whereIn('reporting_manager_user_id', $branchUserIds ?: [0])
                  ->orWhere(function ($qq) {
                      $qq->whereNull('reporting_manager_id')
                         ->whereNull('reporting_manager_user_id');
                  });
            })
            ->update([
                'reporting_manager_id'      => $employee->id,
                'reporting_manager_user_id' => null,
            ]);

        // (b) Auto-grant the department permissions onto the HOD.
        $hodUser = User::find($employee->user_id);
        if ($hodUser) {
            \App\Support\DepartmentPermissionSync::applyToHodUser($hodUser, (int) $departmentId, $actingUserId);
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
            // withTrashed() — the Edit-from-Onboarding flow can target rows
            // whose linked employee was soft-deleted; without this the lookup
            // returns null and the unique check below stops ignoring the
            // existing user, surfacing "email already taken" on every save.
            $ignoreUserId = Employee::withTrashed()->where('id', $employeeId)->value('user_id');
        }

        $this->stripDanglingAssetRefs($request);
        if ($request->filled('email')) {
            $request->merge(['email' => mb_strtolower(trim($request->input('email')))]);
        }
      if ($request->filled('pan_number')) {
            $request->merge(['pan_number' => mb_strtoupper(trim($request->input('pan_number')))]);
        }
        // Tenant the dup checks below run against. This MUST be the client the
        // row is actually written under (resolveOwnership), not the acting
        // user's own client_id: a super_admin has client_id = NULL, and the old
        // `$x ? where(...) : $q` / `when($x, ...)` form silently DROPPED the
        // client predicate for them, turning a per-tenant check into a GLOBAL
        // one. Effect: creating an employee whose email exists under a
        // completely different client was rejected with "this email already has
        // an account in this organization" even though the organization had no
        // such user. On update we take the tenant off the existing row so an
        // edit can never be re-scoped by who happens to be saving it.
        $scopeClientId = $isUpdate
            ? Employee::withTrashed()->where('id', $employeeId)->value('client_id')
            : $this->resolveOwnership($request)[0];
        $scopeClientId = $scopeClientId === null ? null : (int) $scopeClientId;

        // Always apply a client predicate — NULL client_id rows form their own
        // bucket, exactly like the COALESCE(client_id, 0) in the DB indexes.
        $tenantWhere = fn($q) => $scopeClientId === null
            ? $q->whereNull('client_id')
            : $q->where('client_id', $scopeClientId);

    $panRule = ['nullable', 'string', 'regex:/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/'];
        if ($request->filled('pan_number')) {
            $panRule[] = Rule::unique('employees', 'pan_number')
                ->whereNull('deleted_at')
                ->where($tenantWhere)
                ->ignore($employeeId);
        }


        $emailRule = $isUpdate ? ['nullable', 'email', 'max:191'] : ['required', 'email', 'max:191'];
        // Email is unique PER TENANT (not globally) — the same email may belong
        // to another client. Scope the dup check to the owning client_id so a
        // collision in a DIFFERENT client no longer blocks creation here. Mirrors
        // the pan_number rule above and the users_email_client_unique DB index.
        $emailRule[] = Rule::unique('users', 'email')
            ->whereNull('deleted_at')
            ->where(fn($q) => $tenantWhere($q)
                ->whereRaw('LOWER(email) = ?', [mb_strtolower((string) $request->input('email'))]))
            ->ignore($ignoreUserId);

        // Attendance Number is the mapping key for eSSL biometric devices — a
        // device User ID resolves to exactly one employee via this field, so it
        // must be unique per tenant (mirrors the pan_number rule + the
        // employees_attendance_number_client_unique DB index). Scoped to the
        // creator's client_id so a clash in a DIFFERENT client can't block here.
        // See docs/ESSL_ATTENDANCE_INTEGRATION.md §14.2.
        $attNumRule = ['nullable', 'string', 'max:50'];
        if ($request->filled('attendance_number')) {
            $attNumClientId = optional($request->user())->client_id;
            $attNumRule[] = Rule::unique('employees', 'attendance_number')
                ->whereNull('deleted_at')
                ->where(fn($q) => $attNumClientId ? $q->where('client_id', $attNumClientId) : $q)
                ->ignore($employeeId);
        }

        
        $isFinalStep   = (int) $request->input('wizard_step_completed', 0) >= 4;
        $payrollOn     = (bool) $request->input('enable_payroll', true);
        $requireSalary = $isFinalStep && $payrollOn;
        $salaryMax     = 999999999999.99; // decimal(14, 2)
        $salaryRule    = $requireSalary
            ? ['required', 'numeric', 'min:0.01', "max:{$salaryMax}"]
            : ['nullable',  'numeric', 'min:0',    "max:{$salaryMax}"];
        $salaryFreqRule = $requireSalary ? ['required', 'string', 'max:30']   : ['nullable', 'string', 'max:30'];
        $salaryFromRule = $requireSalary ? ['required', 'date']               : ['nullable', 'date'];

        $noTags = ['not_regex:/[<>]/'];

        return $request->validate([
            
            'first_name'   => $isUpdate ? 'nullable|string|max:100' : 'required|string|max:100',
            'middle_name'  => 'nullable|string|max:100',
            'last_name'    => 'nullable|string|max:100',
           
            'gender'       => 'nullable|in:Male,Female,Other,Prefer not to say',
            'date_of_birth' => 'nullable|date',
            'blood_group'   => 'nullable|string|max:10',
            'nationality_country_id' => 'nullable|integer',
            'work_country_id'        => 'nullable|integer',
            'email'        => $emailRule,
            // Stage 3 provisioning — company-issued mailbox assigned at
            // onboarding (e.g. "test.demo@company.com"). Independent of
            // the personal email used for login.
            'official_email' => 'nullable|email|max:191',
            // Tightened from max:30 → max:15 (E.164 international cap).
            // Without this the DB layer rejected 20–30-digit input with a
            // hard 500 error instead of a friendly 422.
            'mobile'       => ['nullable', 'string', 'max:15', 'regex:/^[+0-9\s\-()]{6,15}$/'],
            'alt_mobile'   => ['nullable', 'string', 'max:15', 'regex:/^[+0-9\s\-()]{6,15}$/'],

            // Current address
            'country_id'   => 'nullable|integer',
            'state_id'     => 'nullable|integer',
            'city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'pincode'      => 'nullable|string|max:20',

            // Permanent address (mirrors current address shape)
            'perm_country_id'   => 'nullable|integer',
            'perm_state_id'     => 'nullable|integer',
            'perm_city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'perm_address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_pincode'      => 'nullable|string|max:20',

            // Legal entity = one of THIS client's branches (see Employee::legalEntity).
            // Scoped so a crafted id can't attach an employee to another tenant's
            // branch. The client id comes from resolveOwnership, not straight off
            // the user: a super_admin has client_id === null, and passing null into
            // the predicate would match nothing and reject every branch.
            'legal_entity_id' => [
                'nullable', 'integer',
                Rule::exists('branches', 'id')->where(function ($q) use ($request) {
                    [$ownerClientId] = $this->resolveOwnership($request);
                    if ($ownerClientId !== null) {
                        $q->where('client_id', $ownerClientId);
                    }
                    $q->whereNull('deleted_at');
                }),
            ],
            'location'        => array_merge(['nullable', 'string', 'max:191'], $noTags),
            // Department + designation arrive in step 2 of the wizard, so
            // they're nullable here — the frontend per-step validator gates
            // them when the user actually clicks Next on step 2.
            'department_id'   => 'nullable|integer',
            'designation_id'  => 'nullable|integer',
            'primary_role_id' => 'nullable|integer',
            'ancillary_role_id'    => 'nullable|integer',
            'ancillary_role_ids'   => 'nullable|array',
            'ancillary_role_ids.*' => 'integer',
            'work_type' => 'nullable|string|max:50',
            'reporting_manager_id'      => 'nullable|integer',
            'reporting_manager_user_id' => 'nullable|integer',
            // Stage 2 Yes/No — "Has the employee worked anywhere before?".
            // Persisted so the radio group can rehydrate on revisit; the
            // legacy "derive from previous_employments row count" was
            // unable to distinguish "No, first job" from "not answered yet".
            'has_prior_experience'      => 'nullable|boolean',
            // Sanity-bound the joining date: reject absurd historical values
            // (e.g. 1900) and far-future dates while still allowing genuine
            // historical join dates for existing staff being added.
            'date_of_joining' => 'nullable|date|after_or_equal:' . now()->subYears(50)->toDateString() . '|before_or_equal:' . now()->addYears(2)->toDateString(),

            'probation_policy'   => 'nullable|string|max:50',
            'probation_months'   => 'nullable|integer|min:0|max:60',
            // Computed on the frontend from joining date + probation policy.
            'probation_end_date' => 'nullable|date',
            'notice_period'      => 'nullable|string|max:50',
            'notice_period_days' => 'nullable|integer|min:0|max:365',

            // Step 3 — Work Details
            'leave_plan'           => 'nullable|string|max:100',
            'holiday_list'         => 'nullable|string|max:100',
            'holiday_group_id'     => 'nullable|integer',
            'attendance_tracking'  => 'nullable|boolean',
            'shift'                => 'nullable|string|max:50',
            'weekly_off'           => 'nullable|string|max:100',
            'attendance_number'    => $attNumRule,
            'time_tracking'        => 'nullable|string|max:50',
            'penalization_policy'  => 'nullable|string|max:100',
            // Holds an Overtime (OT) Master rate_name — keep the ceiling in
            // step with master_overtime_rates.rate_name (100) or a long rate
            // name 422s on save.
            'overtime'             => 'nullable|string|max:100',
            'expense_policy'       => 'nullable|string|max:100',
            'laptop_assigned'      => 'nullable|string|max:20',
            'laptop_asset_id'      => 'nullable|string|max:50',
            'mobile_device'        => 'nullable|string|max:100',
            'other_assets'         => 'nullable|string|max:255',

            // Step 4 — Compensation
            'enable_payroll'        => 'nullable|boolean',
            'pay_group'             => 'nullable|string|max:100',
            'annual_salary'         => $salaryRule,
            'salary_frequency'      => $salaryFreqRule,
            'salary_effective_from' => $salaryFromRule,
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
            // PAN: 5 letters, 4 digits, 1 letter + tenant-unique (see $panRule above).
            'pan_number'            => $panRule,
            'pf_deduction'          => 'nullable|string|max:50',
            // PF calculation method (Stage 4). statutory = 12% capped at the
            // ₹15k EPF ceiling; standard = 12% of full basic. Read by PayrollService.
            'pf_type'               => 'nullable|in:statutory,standard',
            'esi_applicable'        => 'nullable|in:Yes,No',
            'gratuity_nominee_name' => 'nullable|string|max:150',
            'agreed_ctc_lpa'        => 'nullable|numeric|min:0',
            'stage4_completed_at'   => 'nullable|date',

            'assets'  => 'nullable|array',
            'assets.*' => 'integer',

            // Asset assignments (Stage 1 Step 3). Uniqueness across
            // employees is enforced separately in
            // assertAssetsNotDoubleBooked() so we can return a friendly
            // 422 with the conflicting employee name.
            'laptop_master_asset_id'   => 'nullable|integer|exists:master_assets,id',
            'mobile_master_asset_id'   => 'nullable|integer|exists:master_assets,id',
            'other_master_asset_ids'   => 'nullable|array',
            'other_master_asset_ids.*' => 'integer|exists:master_assets,id',

            // Stage 3 — Physical Setup & Identification
            'biometric_status'    => 'nullable|in:Not Registered,Registered,Pending,Failed',
            'desk_workstation_no' => 'nullable|string|max:50',
            'id_card_status'      => 'nullable|in:Not Printed,Printed,Issued,Lost,Reissued',
            'status'  => 'nullable|in:Active,Inactive,On Leave,Probation,Notice Period,Resigned,Terminated',
            'onboarding_stage_completed' => 'nullable|integer|min:0|max:6',
        ], [
            'city.not_regex'               => 'City cannot contain < or > characters.',
            'address_line1.not_regex'      => 'Address cannot contain < or > characters.',
            'address_line2.not_regex'      => 'Address cannot contain < or > characters.',
            'perm_city.not_regex'          => 'City cannot contain < or > characters.',
            'perm_address_line1.not_regex' => 'Address cannot contain < or > characters.',
            'perm_address_line2.not_regex' => 'Address cannot contain < or > characters.',
            'location.not_regex'           => 'Location cannot contain < or > characters.',
            // Email is the login ID and is unique system-wide (across every
            // branch/client) — it can't be branch-scoped without making login
            // ambiguous. Spell that out so an admin who can only see their own
            // branch doesn't read this as a false positive.
            'email.unique'                 => 'This email already has an account in this organization. Each email can be used only once per organization — use a different email.',
        ]);
    }

    /**
     * Filter the asset-FK fields on the request down to ids that actually
     * exist in master_assets. Called from validatePayload() so the
     * `exists:` rules below can stay strict for new picks while old rows
     * with deleted asset refs still save successfully.
     */
    private function stripDanglingAssetRefs(Request $request): void
    {
        // Pull the candidate ids from the request without trusting their
        // shape — the SPA sends ints but PATCH replays could send strings.
        $candidates = collect();
        foreach (['laptop_master_asset_id', 'mobile_master_asset_id'] as $f) {
            $v = $request->input($f);
            if ($v !== null && $v !== '' && is_numeric($v)) $candidates->push((int) $v);
        }
        $others = (array) $request->input('other_master_asset_ids', []);
        foreach ($others as $v) {
            if (is_numeric($v)) $candidates->push((int) $v);
        }
        if ($candidates->isEmpty()) return;

        $existing = \App\Models\Masters\Assets::query()
            ->whereIn('id', $candidates->unique()->all())
            ->pluck('id')
            ->map(fn($x) => (int) $x)
            ->flip();

        $merge = [];
        foreach (['laptop_master_asset_id', 'mobile_master_asset_id'] as $f) {
            $v = $request->input($f);
            if ($v !== null && $v !== '' && is_numeric($v) && !$existing->has((int) $v)) {
                $merge[$f] = null;
            }
        }
        if (!empty($others)) {
            $cleaned = array_values(array_filter(
                array_map(fn($v) => is_numeric($v) ? (int) $v : null, $others),
                fn($v) => $v !== null && $existing->has($v),
            ));
            $merge['other_master_asset_ids'] = $cleaned;
        }
        if (!empty($merge)) {
            $request->merge($merge);
        }
    }

    /**
     * Reject the save if any of the chosen assets is already booked by
     * Bridge multi-role array → legacy single-int column.
     *
     * If `ancillary_role_ids` is sent, normalise it to clean ints and
     * mirror its first element into the legacy `ancillary_role_id` column
     * so SQL/reports still referencing the old column keep working.
     * If only the legacy single id arrives (older client), expand it
     * into a one-item array so the new code path stays the source of truth.
     */
    private function mirrorAncillaryRoles(array $data): array
    {
        if (array_key_exists('ancillary_role_ids', $data)) {
            $ids = array_values(array_filter((array) $data['ancillary_role_ids'], fn($v) => $v !== null && $v !== ''));
            $ids = array_map('intval', $ids);
            $data['ancillary_role_ids'] = $ids;
            $data['ancillary_role_id']  = $ids[0] ?? null;
        } elseif (array_key_exists('ancillary_role_id', $data) && $data['ancillary_role_id']) {
            $data['ancillary_role_ids'] = [(int) $data['ancillary_role_id']];
        }
        return $data;
    }

    /**
     * Reject duplicate employee entries within the same tenant.
     *
     * Only mobile number is treated as a hard duplicate signal — it's the
     * single most reliable per-person identifier. The legacy
     * (first_name + last_name + date_of_birth) check was removed because
     * two unrelated employees can legitimately share both: common names
     * + birthdays collide more often than the check's authors assumed,
     * and the false positives blocked legitimate hires (admins reported
     * being unable to onboard a new Bhavika because an EMP-004 already
     * had the same name + DOB). Mobile uniqueness still protects against
     * the same-person-typed-twice case the second check was meant for.
     *
     * The check skips when mobile is empty so partial drafts persist.
     * Soft-deleted employees don't block fresh hires.
     */
    private function guardDuplicate(array $data, $clientId, ?int $excludeId): void
    {
        $mobile = trim((string) ($data['mobile'] ?? ''));

        $tenantScope = function ($q) use ($clientId, $excludeId) {
            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
            if ($excludeId !== null) $q->where('id', '!=', $excludeId);
        };

        if ($mobile !== '') {
            $q = \App\Models\Employee::query()->where('mobile', $mobile);
            $tenantScope($q);
            // Generic message — do NOT disclose the conflicting employee's
            // name / emp_code (PII leak the QA flagged). Existence is enough.
            if ($q->exists()) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'mobile' => ['This mobile number is already in use by another employee.'],
                ]);
            }
        }
    }

    /**
     * a different employee. Throws a ValidationException with the
     * conflicting field names so the SPA can highlight them.
     */
    private function assertAssetsNotDoubleBooked(array $data, ?int $employeeId): void
    {
        $picked = [];
        if (!empty($data['laptop_master_asset_id'])) {
            $picked[(int) $data['laptop_master_asset_id']] = ['field' => 'laptop_master_asset_id', 'label' => 'Laptop'];
        }
        if (!empty($data['mobile_master_asset_id'])) {
            $picked[(int) $data['mobile_master_asset_id']] = ['field' => 'mobile_master_asset_id', 'label' => 'Mobile'];
        }
        foreach ((array) ($data['other_master_asset_ids'] ?? []) as $aid) {
            $aid = (int) $aid;
            if ($aid && !isset($picked[$aid])) {
                $picked[$aid] = ['field' => 'other_master_asset_ids', 'label' => 'Other asset'];
            }
        }
        if (empty($picked)) return;

        $q = Employee::query()->whereNull('deleted_at');
        if ($employeeId) $q->where('id', '!=', $employeeId);
        $rows = $q->select(['id', 'display_name', 'emp_code', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids'])->get();

        $errors = [];
        foreach ($rows as $r) {
            $conflict = function (?int $aid) use (&$picked, &$errors, $r) {
                if (!$aid || !isset($picked[$aid])) return;
                $info = $picked[$aid];
                $who  = $r->display_name ?: $r->emp_code ?: ('Employee #' . $r->id);
                $errors[$info['field']][] = "{$info['label']} is already assigned to {$who}.";
                unset($picked[$aid]);
            };
            $conflict((int) $r->laptop_master_asset_id);
            $conflict((int) $r->mobile_master_asset_id);
            foreach ((array) ($r->other_master_asset_ids ?? []) as $aid) {
                $conflict((int) $aid);
            }
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages($errors);
        }
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
     * Mirror the Step 3 Leave Plan dropdown selection into the
     * `leave_plan_employees` pivot so the employee's own Leave tab
     * (which reads from the pivot, not the legacy `leave_plan` string
     * column) shows their plan + accrued balances after login.
     *
     * - Numeric value      → upsert pivot to that plan_id (one plan per
     *                        employee; unique constraint on employee_id
     *                        guarantees old assignments are replaced).
     * - Explicit null / "" → wipe the pivot row (admin cleared the
     *                        dropdown — the legacy string column also
     *                        becomes null in the same save).
     * - Non-numeric string → legacy plan-name data left over from before
     *                        the dropdown was switched to plan_id; leave
     *                        the pivot alone, don't guess at a match.
     *
     * Cross-tenant guard: if the chosen plan belongs to a different
     * client_id than the employee, the assignment is dropped silently
     * — same defensive shape as LeavePlanController::assignEmployees,
     * but here we can't 422 because the caller is mid-wizard.
     */
    private function syncLeavePlanPivot(Employee $employee, $rawValue, ?int $assignedBy): void
    {
        // Explicit clear — admin deselected the plan.
        if ($rawValue === null || $rawValue === '') {
            DB::table('leave_plan_employees')
                ->where('employee_id', $employee->id)
                ->delete();
            return;
        }

        if (!is_numeric($rawValue)) return; // legacy plan-name string — ignore.
        $planId = (int) $rawValue;
        if ($planId <= 0) return;

        $plan = LeavePlans::find($planId);
        if (!$plan) return;
        // Same-tenant check — never let one tenant's plan get assigned
        // to another tenant's employee, even if a stale payload arrives.
        if ($plan->client_id !== null && $plan->client_id !== $employee->client_id) return;

        DB::table('leave_plan_employees')->updateOrInsert(
            ['employee_id' => $employee->id],
            [
                'leave_plan_id' => $planId,
                'assigned_at'   => now(),
                'assigned_by'   => $assignedBy,
                'updated_at'    => now(),
                'created_at'    => now(),
            ],
        );
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
        // Minimum baseline so the new hire can sign in and reach the basics.
        // Anything beyond Dashboard + Profile must be granted explicitly by
        // the branch / client admin from the Permissions screen — we no
        // longer replicate the creator's master.* views by default.
        $alwaysOnSlugs = ['dashboard', 'profile'];

        $modules = Module::whereIn('slug', $alwaysOnSlugs)->get();

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
