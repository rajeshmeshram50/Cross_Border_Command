<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\Masters\LeaveTypes;
use App\Models\User;
use App\Notifications\LeaveRequestNotification;
use App\Support\NoticePeriodGuard;
use App\Support\OnboardingGuard;
use App\Support\ProbationGuard;
use Carbon\CarbonPeriod;
use Illuminate\Http\Request;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\Rule;

class LeaveRequestController extends Controller
{
    /** Tenant-facing timezone used to resolve "today" for date guards. The app
     *  runs in UTC; leave dates are entered/read in IST. Matches the display
     *  timezone used across the attendance module. */
    private const DISPLAY_TZ = 'Asia/Kolkata';

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // The Employee Profile page can be opened for any employee by an
        // admin, so accept an explicit employee_id query param. Falls back
        // to the user's linked employee record (employees.user_id = users.id).
        $employeeId = $request->integer('employee_id') ?: null;
        if (!$employeeId) {
            $own = Employee::where('user_id', $user->id)->first();
            if (!$own) {
                return response()->json(['data' => []]);
            }
            $employeeId = $own->id;
        }

        // Tenant guard — without this an admin from client X can pass any
        // employee_id and read leave history belonging to client Y.
        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $targetClientId = Employee::where('id', $employeeId)->value('client_id');
            // Strict — a null client_id on the employee must NOT bypass the guard
            // (legacy/seed rows would otherwise leak to any tenant). (LV-18)
            if ((int) $targetClientId !== (int) $user->client_id) {
                abort(404);
            }
        }

        $status = $request->input('status'); // 'Pending' | 'Approved' | 'Rejected' | null
        $q = LeaveRequest::query()
            ->where('employee_id', $employeeId)
            ->with([
                'leaveType:id,name,short_code,type,paid_unpaid',
                'leavePlan:id,plan_name',
                'coverPerson:id,first_name,last_name,display_name',
                'approver:id,name',
            ])
            ->orderByDesc('from_date');
        if ($status) $q->where('status', $status);

        return response()->json(['data' => $q->get()]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Store — employee submits a new leave application
    // ─────────────────────────────────────────────────────────────────────
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'employee_id' => ['nullable', 'integer', 'exists:employees,id'],
            // LV-23: only a leave type in the caller's own tenant (or a global
            // null-client row) is valid — not any tenant's id.
            'leave_type_id' => ['required', 'integer', Rule::exists('master_leave_types', 'id')->where(function ($q) use ($user) {
                if ($user->user_type === 'super_admin') return; // unscoped — acts across tenants
                $q->whereNull('client_id')->orWhere('client_id', $user->client_id);
            })],
            'from_date' => ['required', 'date'],
            // LV-09: cap how far ahead leave can be booked (1 year) so a stray
            // far-future request can't silently lock quota for years.
            'to_date' => ['required', 'date', 'after_or_equal:from_date', 'before_or_equal:' . now()->addYear()->toDateString()],
            'day_type' => ['nullable', Rule::in(['full', 'first_half', 'second_half'])],
            // LV-22: bound the free-text fields (were unbounded → DoS/storage bloat).
            'reason' => ['nullable', 'string', 'max:2000'],
            'attachment_path' => ['nullable', 'string', 'max:1024'],
            /* The inner key needs its own rule. validated() returns only keys
               that HAVE rules, so 'notify' => ['array'] alone let the array
               through and stripped employee_ids out of it — the request stored
               notify => [] and no colleague was ever CC'd (QA #117). */
            'notify' => ['nullable', 'array'],
            'notify.employee_ids' => ['nullable', 'array'],
            'notify.employee_ids.*' => ['integer', 'exists:employees,id'],
            'handover_required' => ['nullable', 'boolean'],
            'cover_person_id' => ['nullable', 'integer', 'exists:employees,id'],
            'handover_notes' => ['nullable', 'string', 'max:5000'],
            'critical_tasks' => ['nullable', 'string', 'max:5000'],
            'avail_on_call' => ['nullable', 'boolean'],
            'emergency_number' => ['nullable', 'string', 'max:50'],
            'avail_note' => ['nullable', 'string', 'max:2000'],
        ]);

        // Resolve target employee — explicit id (admin filing on behalf) or
        // the signed-in user's own employee row.
        $employee = null;
        if (!empty($data['employee_id'])) {
            $employee = Employee::find($data['employee_id']);
        }
        if (!$employee) {
            $employee = Employee::where('user_id', $user->id)->first();
        }
        if (!$employee) {
            abort(422, 'Could not resolve target employee for this leave request.');
        }

        // Tenant guard on the resolved employee — prevents an admin from
        // client X filing leave on behalf of an employee in client Y by
        // passing employee_id directly. Super_admin bypasses.
        if ($user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'You cannot file leave for an employee outside your tenant.');
        }

        // Self-service rule — raising a leave request is something an employee
        // does for THEMSELVES. Filing on behalf of someone else is an admin-only
        // capability (client/super admin). Branch users and employees can VIEW
        // others' leave but not raise it — so a branch user can't apply leave
        // from another employee's profile (matches the hidden "Request Leave"
        // button in the UI).
        $isAdmin = in_array($user->user_type, ['super_admin', 'client_admin'], true);
        $isSelf  = (int) ($employee->user_id ?? 0) === (int) $user->id;
        if (!$isAdmin && !$isSelf) {
            abort(403, 'You can only raise a leave request for yourself.');
        }

        // Onboarding gate (CBC #84) — an employee still mid-onboarding has no
        // leave plan assigned and no approval chain to snapshot, so the request
        // would be unroutable. Keyed on the TARGET employee, so it also stops an
        // admin filing on their behalf before HR has finished.
        OnboardingGuard::assertComplete($employee, 'raise a leave request', $isSelf);

        // Probation gate — the leave policy does not apply until probation
        // ends, so the request is refused rather than routed to an approver
        // who has no quota to grant against. Keyed on the TARGET employee, so
        // an admin filing on their behalf is blocked too.
        ProbationGuard::assertCanRaiseLeave($employee, $isSelf);

        // Notice-period gate — an employee serving notice cannot take PAID
        // leave (the notice has to be served, not drawn as salary for days off).
        // Unpaid leave is allowed and, once approved, pushes the last working
        // day out by its length (applied in setStatus below).
        NoticePeriodGuard::assertLeaveAllowed(
            $employee,
            LeaveTypes::find($data['leave_type_id']),
            $isSelf,
        );

        // Date guards. "Today" is resolved in the display timezone (IST): the
        // app runs in UTC, so now()->toDateString() reports YESTERDAY for the
        // first 5.5h of every IST day and would let a stale date slip through.
        // Normalise from_date through Carbon so any accepted date format
        // compares cleanly as Y-m-d.
        $todayStr = now(self::DISPLAY_TZ)->toDateString();
        $fromStr  = Carbon::parse($data['from_date'])->toDateString();

        // Backdated leave bypasses the entire approval workflow's purpose, so
        // it is blocked for everyone. (A dedicated HR "Adjustments" path could
        // log historical absences later.)
        if ($fromStr < $todayStr) {
            abort(422, 'You cannot apply for leave in the past. Pick a date from tomorrow onward.');
        }

        // Joining-date guard — leave cannot start before the employee has
        // actually joined. Blocks future-dated joiners from booking leave that
        // falls before their start date (CBC #85). Already-joined employees are
        // unaffected: their date_of_joining is in the past, so from_date (which
        // must be today or later, per the guard above) is always >= DOJ.
        // Skipped only when DOJ is unset (can't enforce what we don't know).
        if ($employee->date_of_joining) {
            $dojStr = Carbon::parse($employee->date_of_joining)->toDateString();
            if ($fromStr < $dojStr) {
                abort(422, "You cannot apply for leave before your joining date ({$dojStr}).");
            }
        }

        $from = Carbon::parse($data['from_date']);
        $to = Carbon::parse($data['to_date']);
        $dayType = $data['day_type'] ?? 'full';

        // Same-day rule (self-service). The morning is already underway, so an
        // employee applying for TODAY may only take the SECOND HALF — a full
        // day or first-half for today is rejected (and so is a multi-day leave
        // that starts today). Admins filing on behalf stay exempt so HR can
        // still log a genuine same-day absence. Tomorrow onward is unrestricted.
        if (!$isAdmin && $fromStr === $todayStr
            && !($dayType === 'second_half' && $from->isSameDay($to))) {
            abort(422, 'Leave for today can only be applied for the second half of the day.');
        }
        // Half-day only makes sense on a single calendar day. Reject the
        // ambiguous "first_half across 5 days" case rather than silently
        // billing it as 5 full days.
        if ($dayType !== 'full' && !$from->isSameDay($to)) {
            abort(422, 'Half-day requests are only valid for a single calendar day. Please pick the same from/to date or switch day type to "Full Day".');
        }
        // NOTE: $days (chargeable day count) is computed further down, once the
        // leave-type config is loaded.

        // Overlap guard — same employee already has a Pending or Approved
        // request whose date range intersects the new one. Two ranges
        // overlap when each starts on or before the other one ends.
        $overlapQuery = LeaveRequest::where('employee_id', $employee->id)
            ->whereIn('status', ['Pending', 'Approved'])
            ->where('from_date', '<=', $to->toDateString())
            ->where('to_date',   '>=', $from->toDateString());

        // LV-08: a half-day does NOT conflict with the OPPOSITE half on the same
        // single day (AM + PM is a valid full day split across two requests).
        // Exclude that complementary case from the overlap match.
        if ($dayType !== 'full' && $from->isSameDay($to)) {
            $opposite = $dayType === 'first_half' ? 'second_half' : 'first_half';
            $day = $from->toDateString();
            $overlapQuery->where(function ($w) use ($opposite, $day) {
                $w->where('day_type', '!=', $opposite)
                  ->orWhere('from_date', '!=', $day)
                  ->orWhere('to_date', '!=', $day);
            });
        }
        $overlap = $overlapQuery->first();
        if ($overlap) {
            abort(422, "You already have a {$overlap->status} leave request for {$overlap->from_date} → {$overlap->to_date}. Cancel it before applying for overlapping dates.");
        }

        // Cover person + notify list must be in the same tenant. The /colleagues
        // search endpoint enforces this in the UI, but a hand-rolled API call
        // can still smuggle cross-tenant IDs in.
        if (!empty($data['cover_person_id'])) {
            $coverClientId = Employee::where('id', $data['cover_person_id'])->value('client_id');
            if ($coverClientId !== null && (int) $coverClientId !== (int) $employee->client_id) {
                abort(422, 'Cover person must be in the same tenant.');
            }
        }
        $notifyIds = is_array($data['notify']['employee_ids'] ?? null)
            ? array_values(array_filter(array_map('intval', $data['notify']['employee_ids']), fn($v) => $v > 0))
            : [];
        if (!empty($notifyIds)) {
            $crossTenant = Employee::whereIn('id', $notifyIds)
                ->where('client_id', '!=', $employee->client_id)
                ->exists();
            if ($crossTenant) {
                abort(422, 'Notify list contains employees outside your tenant.');
            }
        }

        // Find the employee's current leave plan (if any) for stamping. Prefer
        // the pivot; fall back to the plan stamped on the employee record
        // (onboarding wizard / employee form) so either assignment path works.
        $planId = DB::table('leave_plan_employees')
            ->where('employee_id', $employee->id)
            ->value('leave_plan_id');
        if (!$planId && is_numeric($employee->leave_plan)) {
            $planId = (int) $employee->leave_plan;
        }

        // Plan + leave-type sanity. Without a plan there are no quotas
        // and no approval chain config, so let HR fix the assignment
        // before the employee can apply.
        if (!$planId) {
            abort(422, 'You are not assigned to a leave plan yet. Please contact HR.');
        }
        $ptConfigRaw = DB::table('leave_plan_leave_types')
            ->where('leave_plan_id', $planId)
            ->where('leave_type_id', $data['leave_type_id'])
            ->value('config_json');
        if ($ptConfigRaw === null) {
            abort(422, 'The selected leave type is not part of your assigned leave plan.');
        }

        // Balance / quota enforcement. Previously the backend accepted any
        // request regardless of the configured quota, so an employee could
        // file more days than their plan allowed (HRMS-BUG-107: "1 week per
        // month" plan still let a 9-day request through). Block requests that
        // exceed the available balance. Unlimited types are exempt; an opt-in
        // per-type overdraft allowance extends the ceiling. Both Approved and
        // still-Pending days count so a user can't stack several over-quota
        // requests before any is acted on.
        $ptConfig  = json_decode((string) $ptConfigRaw, true);
        $accrual   = (is_array($ptConfig) ? $ptConfig['accrual'] ?? [] : []);
        $unlimited = (bool) ($accrual['unlimited'] ?? false);

        // Chargeable day count — a half-day is 0.5; otherwise count the working
        // days in the range (weekly-offs and holidays inside the range are never
        // charged). This count flows into the balance check, attendance (approved
        // leave overlays the date range) and payroll.
        $leaveApp = (is_array($ptConfig) ? $ptConfig['leaveApp'] ?? [] : []);
        $days = $this->computeLeaveDays($from, $to, $dayType, $employee);

        // Half-day gate — only leave types whose setup enables "Allow half day
        // leave" may be requested as first/second half. (This also blocks the
        // same-day second-half path for types that don't allow half days.)
        if ($dayType !== 'full' && !(bool) ($ptConfig['leaveApp']['allowHalfDay'] ?? false)) {
            abort(422, 'This leave type does not allow half-day leave.');
        }
        if (!$unlimited) {
            // Gate against the FULL annual entitlement (yearly quota + any
            // opt-in overdraft), available from day one — no monthly vesting.
            // Both Approved and still-Pending days count so a user can't stack
            // several over-quota requests before any is acted on. This mirrors
            // the "Available" figure shown on the employee profile.
            $quotaDays = (float) ($accrual['yearlyQuota'] ?? 0);
            $overdraft = !empty($accrual['employeeOverdraft']['enabled'])
                ? (float) ($accrual['employeeOverdraft']['days'] ?? 0)
                : 0.0;
            $usedDays = (float) LeaveRequest::query()
                ->where('employee_id', $employee->id)
                ->where('leave_type_id', $data['leave_type_id'])
                ->whereIn('status', ['Approved', 'Pending'])
                ->sum('days');
            $available = max(0.0, ($quotaDays + $overdraft) - $usedDays);
            if ($days > $available) {
                $fmt = fn (float $n) => rtrim(rtrim(number_format($n, 2), '0'), '.');
                abort(422, "Not enough leave balance — only {$fmt($available)} day(s) available for this leave type, but you requested {$fmt($days)}.");
            }
        }

        // Monthly cap (Bug 60) — even when the annual quota still has balance,
        // block draining a whole quota inside one month. A request is attributed
        // to the calendar month it STARTS in; the cap is per leave type. Applies
        // regardless of `unlimited`, since capping monthly usage is the point.
        // Both Approved and Pending days count so requests can't be stacked
        // before any is acted on.
        $maxPerMonth = is_array($leaveApp['maxPerMonth'] ?? null) ? $leaveApp['maxPerMonth'] : [];
        $monthlyCap = (float) ($maxPerMonth['days'] ?? 0);
        if (!empty($maxPerMonth['enabled']) && $monthlyCap > 0) {
            $usedThisMonth = (float) LeaveRequest::query()
                ->where('employee_id', $employee->id)
                ->where('leave_type_id', $data['leave_type_id'])
                ->whereIn('status', ['Approved', 'Pending'])
                ->whereBetween('from_date', [
                    $from->copy()->startOfMonth()->toDateString(),
                    $from->copy()->endOfMonth()->toDateString(),
                ])
                ->sum('days');
            if ($usedThisMonth + $days > $monthlyCap) {
                $fmt = fn (float $n) => rtrim(rtrim(number_format($n, 2), '0'), '.');
                $remaining = max(0.0, $monthlyCap - $usedThisMonth);
                abort(422, "Monthly limit reached — this leave type allows at most {$fmt($monthlyCap)} day(s) per month. You've already used {$fmt($usedThisMonth)} this month, so only {$fmt($remaining)} more can be applied (you requested {$fmt($days)}).");
            }
        }

        /* Periodic monthly accrual (was Bug #74) is GONE. "Leave accrued
           periodically" was removed from the leave-type setup on request
           (#102), leaving immediate allocation as the only mode: the whole
           yearly quota is available from day one.

           Its enforcement is removed with it rather than left running against
           `accrual.mode === 'periodic'` still sitting in older config_json
           rows. Keeping it would block leave by a rule HR can no longer see or
           switch off in Setup — the balance would read "12 available" while
           the request 422'd at 1/month, with the message naming a dropdown
           that no longer exists.

           Capping monthly usage is still supported and is now the only way to
           do it: `leaveApp.maxPerMonth`, enforced just above. */

        // Snapshot the approval chain from the plan-type config_json so
        // changing the plan rules later doesn't reroute in-flight requests.
        // Pass the computed day count so any skip_if rules (e.g. days_lt: 2)
        // mark the matching levels Skipped right at snapshot time.
        $chain = $this->snapshotApprovalChain($employee, $planId, $data['leave_type_id'], $days);
        $startLevel = $this->firstActionableLevel($chain, 1);
        $autoApproved = $startLevel > count($chain) && count($chain) > 0;

        $row = LeaveRequest::create([
            'client_id' => $employee->client_id,
            'branch_id' => $employee->branch_id,
            'employee_id' => $employee->id,
            'leave_type_id' => $data['leave_type_id'],
            'leave_plan_id' => $planId,
            'from_date' => $from->toDateString(),
            'to_date' => $to->toDateString(),
            'days' => $days,
            'day_type' => $dayType,
            'reason' => $data['reason'] ?? null,
            'attachment_path' => $data['attachment_path'] ?? null,
            'notify' => $data['notify'] ?? null,
            'handover_required' => !empty($data['handover_required']),
            'cover_person_id' => $data['cover_person_id'] ?? null,
            'handover_notes' => $data['handover_notes'] ?? null,
            'critical_tasks' => $data['critical_tasks'] ?? null,
            'avail_on_call' => !empty($data['avail_on_call']),
            'emergency_number' => $data['emergency_number'] ?? null,
            'avail_note' => $data['avail_note'] ?? null,
            'status' => $autoApproved ? 'Approved' : 'Pending',
            'approval_chain' => $chain,
            'current_approval_level' => $startLevel,
            'approved_at' => $autoApproved ? now() : null,
            'approver_comment' => $autoApproved ? 'Auto-approved — every chain level was skipped by rule' : null,
            'created_by' => $user->id,
        ]);

        // Fire-and-forget notifications. Wrap in try/catch so a flaky SMTP
        // doesn't kill a successful submit — the row is already persisted.
        $this->notifyForSubmission($row, $employee);

        // Auto-approved (every chain level was Skipped by rule) — also tell
        // the requester their leave is granted, otherwise they sit waiting
        // for an approval email that will never come.
        if ($autoApproved) {
            $this->notifyForDecision($row, $row->approver_comment);
        }

        return response()->json(['data' => $row->load(['leaveType:id,name,short_code', 'leavePlan:id,plan_name'])], 201);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Colleagues — lightweight employee search for the Notify field of
    // the Request Leave drawer. The main /api/employees endpoint requires
    // master.employees.can_view (an HR-only permission), which regular
    // employees don't hold — so a search there silently 403s. This
    // endpoint is open to any authenticated user, returns only employees
    // in their own client (tenant safety), and includes just the fields
    // the picker needs (id, name, emp_code, designation, photo_url).
    // ─────────────────────────────────────────────────────────────────────
    public function colleagues(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $search = trim((string) $request->input('search', ''));
        $limit = max(1, min(20, (int) $request->integer('limit', 10)));

        $q = Employee::query()
            ->with(['designation:id,name'])
            ->where('status', 'Active');

        // Tenant scope — every authenticated user only sees colleagues
        // in their own client. Super admin sees everyone (rare path).
        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        // Branch scope — "Notify Colleagues" is branch-local: a leave applicant
        // should only see people from their OWN branch, not the whole client.
        // Prefer the user's own branch (can't be spoofed); fall back to the
        // active branch the BranchSwitcher sends (?branch_id=) for admins who
        // aren't pinned to a single branch. Super admin stays unscoped.
        if ($user->user_type !== 'super_admin') {
            $branchId = $user->branch_id ?: ($request->integer('branch_id') ?: null);
            if ($branchId) {
                $q->where('branch_id', $branchId);
            }
        }

        // Exclude the leave applicant themselves — you don't notify yourself.
        // Prefer the explicit employee_id (admin raising a request on behalf of
        // someone) and fall back to the authenticated user's own linked employee
        // (the normal self-service flow). Mirrors how store() resolves the applicant.
        $selfId = $request->integer('employee_id')
            ?: Employee::where('user_id', $user->id)->value('id');
        if ($selfId) {
            $q->where('id', '!=', $selfId);
        }

        if ($search !== '') {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('display_name', 'ilike', $like)
                  ->orWhere('first_name', 'ilike', $like)
                  ->orWhere('last_name', 'ilike', $like)
                  ->orWhere('emp_code', 'ilike', $like)
                  ->orWhere('email', 'ilike', $like);
            });
        }

        $rows = $q->orderBy('first_name')->limit($limit)->get();

        $data = $rows->map(function ($e) {
            $name = trim($e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')));
            return [
                'id' => $e->id,
                'name' => $name,
                'emp_code' => $e->emp_code,
                'designation' => $e->designation?->name,
                'photo_url' => null, // wire when employee_documents['photo'] resolution lands
            ];
        });

        return response()->json(['data' => $data]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Show — single request with every relation the approval modal needs
    // ─────────────────────────────────────────────────────────────────────
    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Tenant guard before loading relations — prevents IDOR.
        $this->findScopedOrFail($id, $user);
        $row = LeaveRequest::with([
            'employee:id,emp_code,first_name,last_name,display_name,department_id,designation_id,reporting_manager_id,email',
            'employee.department:id,name',
            'employee.designation:id,name',
            'employee.reportingManager:id,first_name,last_name,display_name,email',
            'leaveType:id,name,short_code,type,paid_unpaid',
            'leavePlan:id,plan_name',
            'coverPerson:id,first_name,last_name,display_name,emp_code',
            'approver:id,name',
            'creator:id,name',
            'sandwichWaiver:id,name',
        ])->findOrFail($id);

        /* Sandwich context for the approver.
         *
         * `days` alone cannot be read: a 4-day Fri–Mon leave and a genuine
         * 4-working-day leave look identical on screen, so an approver has no
         * way to see that two of those days came from a policy rather than
         * from the dates the employee asked for. These two fields make the
         * policy's contribution explicit, and are what the waiver control
         * keys off — no point offering a waiver on a leave the rule never
         * touched. */
        /* Loaded fresh, NOT reused from the eager-loaded `employee` relation
         * above. That relation selects a trimmed column list for the UI
         * payload, and branch_id / weekly_off / holiday_group_id are not in it
         * — all three arrive as null, so the branch switch reads as off and the
         * off-day detection silently falls back to Sundays. One extra query
         * that cannot be broken by someone tuning the relation's select list. */
        $employee = Employee::find($row->employee_id);
        $applies  = $employee && \App\Support\SandwichPolicy::appliesTo($employee);

        $sandwichDays = 0.0;
        if ($applies) {
            $from = Carbon::parse($row->from_date);
            $to   = Carbon::parse($row->to_date);
            $type = (string) ($row->day_type ?: 'full');
            // The gap between sizing the leave with the rule and without it —
            // derived rather than stored, so it can never drift out of date
            // when a neighbouring leave is added, approved or cancelled.
            $sandwichDays = $this->computeLeaveDays($from, $to, $type, $employee, $row->id, false)
                          - $this->computeLeaveDays($from, $to, $type, $employee, $row->id, true);
        }

        return response()->json([
            'data' => $row,
            'meta' => [
                'sandwich_applicable' => $applies,
                'sandwich_days'       => round($sandwichDays, 2),
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approvals queue — pending requests where the signed-in user is the
    // approver. Currently keyed off employees.reporting_manager_id matching
    // an employee record linked to the current user. HR / admin scopes
    // (super_admin, client_admin, branch_user) see every pending request
    // in their tenant so they can act on behalf when a manager is offline.
    // ─────────────────────────────────────────────────────────────────────
    public function approvals(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $status = $request->input('status', 'Pending');
        $q = LeaveRequest::query()
            ->with([
                'employee:id,emp_code,first_name,last_name,display_name,department_id,reporting_manager_id,reporting_manager_user_id,branch_id,client_id',
                'employee.department:id,name',
                // Reporting manager — may be an Employee row OR a login User
                // (Client/Branch admin); load both so the name resolves either way.
                'employee.reportingManager:id,first_name,middle_name,last_name,display_name',
                'employee.reportingManagerUser:id,name',
                'leaveType:id,name,short_code,type,paid_unpaid',
            ])
            ->orderByDesc('created_at');

        if ($status && $status !== 'All') {
            $q->where('status', $status);
        }

        // Super admin sees everything. Client admin / branch user see their
        // tenant's requests so HR can act regardless of who the direct
        // reporting manager is. Anyone else only sees requests where they
        // are the reporting manager of the requestor OR are explicitly
        // named on the approval chain.
        $isAdminScope = in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true);
        $myEmployeeId = null;
        if (!$isAdminScope) {
            $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
            if (!$myEmployeeId) {
                return response()->json(['data' => []]);
            }
            // Pre-filter: anything in my tenant where I might appear on
            // the chain. We cast a wide net here (RM relation OR approved_by
            // OR any chain row that name-checks me) and then post-filter
            // in PHP using canActOnLevel for per-level precision —
            // approval_chain is JSON so we can't reliably do that match
            // entirely in SQL across PG / MySQL.
            //
            // Match the numeric id with a TRAILING terminator so user 5
            // doesn't accidentally match `"approver_user_id":50` etc.
            // JSON-encoded values are always followed by comma, closing
            // brace, or whitespace (pretty-printed JSON). Three OR'd
            // patterns cover all real shapes; without this guard, every
            // user whose id is a prefix of another approver's id would see
            // cross-row matches in the pre-filter.
            $uid  = (int) $user->id;
            $eid  = (int) $myEmployeeId;
            $q->where(function ($w) use ($myEmployeeId, $user, $uid, $eid) {
                // My OWN leave requests — I'm the requestor, so the Leave page
                // must show them (with their live status) even though I'm never
                // an approver on my own chain. This is what a regular employee
                // with `hr.leave` view expects to see.
                $w->where('employee_id', $myEmployeeId)
                  ->orWhereIn('employee_id', function ($sub) use ($myEmployeeId) {
                    $sub->select('id')->from('employees')->where('reporting_manager_id', $myEmployeeId);
                })->orWhere('approved_by', $user->id)
                  ->orWhere(function ($w2) use ($uid) {
                      $w2->where('approval_chain', 'ilike', '%"approver_user_id":' . $uid . ',%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_user_id":' . $uid . '}%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_user_id": ' . $uid . ',%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_user_id": ' . $uid . '}%');
                  })
                  ->orWhere(function ($w2) use ($eid) {
                      $w2->where('approval_chain', 'ilike', '%"approver_employee_id":' . $eid . ',%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_employee_id":' . $eid . '}%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_employee_id": ' . $eid . ',%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_employee_id": ' . $eid . '}%');
                  });
            });
            if ($user->client_id) {
                $q->where('client_id', $user->client_id);
            }
        } elseif ($user->user_type !== 'super_admin' && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        /* Branch scope. Every branch is an isolated peer, so a branch_user is
         * PINNED to their own branch — the BranchSwitcher cannot widen it
         * (same rule as PayrollController::effectiveBranchId). Previously the
         * filter applied ONLY when the request happened to carry a branch_id,
         * and the Axios interceptor omits it whenever the switcher is on
         * "All branches" (or the stored value is missing/stale) — so a branch
         * user saw every sibling branch's leave requests.
         *
         * Client-level roles keep honouring the switcher: an explicit
         * branch_id narrows, no branch_id means the whole client. */
        $branchId = $request->integer('branch_id') ?: null;
        if ($user->user_type === 'branch_user' && $user->branch_id) {
            $branchId = (int) $user->branch_id;
        }
        if ($branchId) {
            $q->where('branch_id', $branchId);
        }
        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $q->whereIn('employee_id', function ($sub) use ($like) {
                $sub->select('id')->from('employees')
                    ->where(function ($w) use ($like) {
                        $w->where('first_name', 'ilike', $like)
                          ->orWhere('last_name', 'ilike', $like)
                          ->orWhere('display_name', 'ilike', $like)
                          ->orWhere('emp_code', 'ilike', $like);
                    });
            });
        }

        $rows = $q->get();

        // Per-level precision pass for non-admins. For Pending requests
        // only show ones where I can act on the current level. For
        // decided requests fall back to "I was somewhere on the chain"
        // so my history view still includes them.
        if (!$isAdminScope) {
            $rows = $rows->filter(function (LeaveRequest $row) use ($user, $myEmployeeId) {
                // Always keep my own requests — I'm the requestor, not an
                // approver, so the canActOnLevel pass below would otherwise
                // drop them and leave my own Leave page empty.
                if ((int) $row->employee_id === (int) $myEmployeeId) return true;
                $chain = is_array($row->approval_chain) ? $row->approval_chain : [];
                if ($row->status === 'Pending') {
                    $idx = max(0, ((int) ($row->current_approval_level ?? 1)) - 1);
                    return $this->canActOnLevel($user, $chain, $idx, $row);
                }
                foreach (array_keys($chain) as $i) {
                    if ($this->canActOnLevel($user, $chain, $i, $row)) return true;
                }
                return (int) $row->approved_by === (int) $user->id;
            })->values();
        }

        // Per-row "can the viewer act on this RIGHT NOW?" flag. True only when
        // the request is still Pending AND the viewer is the approver for the
        // CURRENT level — i.e. the reporting manager while it sits at the
        // manager level, then HR once the manager has approved and it advances
        // to the HR level. Super admins keep a blanket override. This is what
        // the UI uses to show Approve/Reject vs. a View-only row, so HR can't
        // act before the manager and a manager-rejected request shows View-only.
        $isHrScope = in_array($user->user_type, ['client_admin', 'branch_user'], true);
        /* One pass for the whole page instead of ~3 queries per row.
           isReportingManagerUnavailable() was being called inside the loop,
           so a page of 25 rows cost 75 queries to answer one boolean. */
        $rmAway = $this->rmUnavailableMap($rows);
        $rows->each(function (LeaveRequest $row) use ($user, $isHrScope, $rmAway) {
            $chain = is_array($row->approval_chain) ? $row->approval_chain : [];
            $idx = max(0, ((int) ($row->current_approval_level ?? 1)) - 1);
            $away = (bool) ($rmAway[$row->id] ?? false);

            /* Surfaced to the SPA so the Approval Chain column can show an HR
               step only when HR is genuinely part of this request. Leave is
               reporting-manager-only; HR appears solely when the manager is
               away and someone has to stand in. */
            $row->rm_unavailable = $away;

            // HR can act when the reporting manager is unavailable (Bug 55) —
            // otherwise leave stays reporting-manager-only.
            $row->can_act_now = $row->status === 'Pending'
                && ($user->user_type === 'super_admin'
                    || $this->canActOnLevel($user, $chain, $idx, $row)
                    || ($isHrScope && $away));
        });

        return response()->json(['data' => $rows]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approve / Reject — reporting manager or HR acts on a request
    // ─────────────────────────────────────────────────────────────────────
    public function approve(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Rejected');
    }

    // ─────────────────────────────────────────────────────────────────────
    // HR view acknowledgement — leave is reporting-manager-only, so HR never
    // acts on the chain, but the UI shows an "HR" node that turns green once HR
    // has reviewed the request. This records the FIRST such view (idempotent —
    // set once, never overwritten) so the green state persists across reloads.
    // Only HR / admin tiers can mark a request viewed; the requester opening
    // their own request does not count.
    // ─────────────────────────────────────────────────────────────────────
    public function hrView(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);

        $isHr = in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true);
        if ($isHr && $row->hr_viewed_at === null) {
            $row->hr_viewed_at = now();
            $row->hr_viewed_by = $user->id;
            $row->save();
        }

        return response()->json(['data' => $row]);
    }

    /**
     * Set or clear the Sandwich Leave Policy waiver on a single leave, and
     * re-size `days` to match.
     *
     * Recomputing here is the whole point. `days` is the one number both the
     * leave balance and the payslip read, so a waiver that only changed a flag
     * would leave the employee's balance down 4 while payroll paid 2, with
     * nothing to reconcile the two. Flipping the flag and re-deriving `days` in
     * the same transaction keeps them a single fact.
     *
     * Reachable from the leave approval screen and from the payroll run screen;
     * both write here rather than each keeping their own idea of the waiver.
     */
    public function sandwichWaiver(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Discretionary reversal of a company policy — restricted to the tiers
        // that own payroll and HR, not the requester.
        if (!in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            abort(403, 'Only HR or an administrator can waive the sandwich policy.');
        }

        $data = $request->validate([
            'waived' => 'required|boolean',
            'reason' => 'nullable|string|max:255',
        ]);

        $row = $this->findScopedOrFail($id, $user);
        $employee = Employee::find($row->employee_id);
        if (!$employee) abort(422, 'Leave has no employee on file.');

        if (!\App\Support\SandwichPolicy::appliesTo($employee)) {
            abort(422, "This employee's branch does not run the sandwich leave policy.");
        }

        $waived = (bool) $data['waived'];

        $response = DB::transaction(function () use ($row, $employee, $waived, $data, $user) {
            $before = (float) $row->days;

            $row->days = $this->computeLeaveDays(
                Carbon::parse($row->from_date),
                Carbon::parse($row->to_date),
                (string) ($row->day_type ?: 'full'),
                $employee,
                // Exclude this very leave from the "other approved leave"
                // lookup; its own dates are added back by computeLeaveDays.
                $row->id,
                $waived,
            );

            $row->sandwich_waived         = $waived;
            $row->sandwich_waived_by      = $waived ? $user->id : null;
            $row->sandwich_waived_at      = $waived ? now() : null;
            $row->sandwich_waiver_reason  = $waived ? ($data['reason'] ?? null) : null;
            $row->save();

            return response()->json([
                'data'         => $row->fresh(),
                'days_before'  => $before,
                'days_after'   => (float) $row->days,
                'message'      => $waived
                    ? 'Sandwich policy waived — leave re-sized to ' . (float) $row->days . ' day(s).'
                    : 'Sandwich policy re-applied — leave re-sized to ' . (float) $row->days . ' day(s).',
            ]);
        });

        /* Push the decision through to the draft payslips, exactly as approve()
         * and cancel() do for every other leave change.
         *
         * This was the one leave mutation that did not. Waiving a sandwich on an
         * UNPAID leave changes the payslip directly — PayrollService's
         * leaveAggregates() reads `sandwich_waived` and drops the sandwiched
         * off-days from loss of pay — but nothing recomputed, so the flag flipped
         * and the money did not. The row on screen said "excused" while the
         * payslip beside it still deducted the days, until somebody happened to
         * re-run the whole cycle. It matters more now that the switch is offered
         * inside the run modal itself, where re-running is the very next step and
         * the figures are read before it.
         *
         * Outside the transaction, and best-effort inside propagateToPayroll():
         * the waiver itself is committed either way, and approved/paid runs are
         * frozen so nothing settled can be moved by this. */
        $this->propagateToPayroll($row->employee_id);

        return $response;
    }

    public function cancel(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);
        // Only the requester (or HR) can cancel their own pending request.
        $isOwner = Employee::where('id', $row->employee_id)->where('user_id', $user->id)->exists();
        if (!$isOwner && !in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            abort(403, 'You can only cancel your own leave requests.');
        }
        if ($row->status !== 'Pending') {
            abort(422, 'Only Pending requests can be cancelled.');
        }
        $row->status = 'Cancelled';
        $row->save();

        // Give back any last-working-day extension this leave caused, so an
        // approve→cancel cycle can't ratchet the exit date further out. A
        // Pending request never had one, but this is the single cancellation
        // path — guarding here keeps it correct if approved leave ever becomes
        // cancellable.
        NoticePeriodGuard::revertExtension($row, Employee::find($row->employee_id));

        // Let the current-level approver know they can drop it from the queue.
        $this->notifyForCancellation($row);

        // Cancelling an (already-approved) leave changes payroll days.
        $this->propagateToPayroll($row->employee_id);

        return response()->json(['data' => $row]);
    }

    private function setStatus(Request $request, int $id, string $next)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);
        if ($row->status !== 'Pending') {
            abort(422, "Leave request is already {$row->status}.");
        }
        $data = $request->validate([
            'comment' => ['nullable', 'string'],
        ]);

        $chain = $row->approval_chain ?? [];
        $level = max(1, (int) ($row->current_approval_level ?? 1));
        // Hierarchy gate: only super admins may act out of turn. HR
        // (client_admin / branch_user) must wait for the chain to reach a level
        // they own — the leave goes to the reporting manager FIRST; HR can view
        // a manager-level request but cannot approve/reject it until the manager
        // has confirmed and it advances to the HR level. This matches the
        // per-row `can_act_now` flag the approvals() list already exposes (only
        // super_admin overrides there), so the API can no longer be used to
        // bypass the manager via a direct call.
        $isSuperOverride = $user->user_type === 'super_admin';
        $isApproverForLevel = $this->canActOnLevel($user, $chain, $level - 1, $row);
        // Deadlock escape (Bug 55): if the reporting manager is unavailable (on
        // approved leave, disabled, or unassigned), HR may step in and act so
        // the request doesn't stall under an absent manager.
        $isHr = in_array($user->user_type, ['client_admin', 'branch_user'], true);
        $hrCanActRmAway = $isHr && $this->isReportingManagerUnavailable($row);
        if (!$isApproverForLevel && !$isSuperOverride && !$hrCanActRmAway) {
            abort(403, 'You cannot act on this leave request yet — it is awaiting approval from the reporting manager before HR can act.');
        }

        // LV-11: no one may APPROVE their own leave — not even via the admin
        // override. (Rejecting your own is harmless and handled by /cancel.)
        $ownEmployeeId = (int) (Employee::where('user_id', $user->id)->value('id') ?? 0);
        if ($next === 'Approved' && $ownEmployeeId && (int) $row->employee_id === $ownEmployeeId) {
            abort(403, 'You cannot approve your own leave request.');
        }

        // Record the decision on this chain entry.
        if (isset($chain[$level - 1])) {
            $chain[$level - 1]['status'] = $next;
            $chain[$level - 1]['acted_by'] = $user->id;
            $chain[$level - 1]['acted_at'] = now()->toISOString();
            $chain[$level - 1]['comment'] = $data['comment'] ?? null;
        }
        $row->approval_chain = $chain;

        if ($next === 'Rejected') {
            // Reject at any level terminates the workflow immediately. Mark
            // every downstream level Skipped so a later approver (e.g. HR) no
            // longer shows as Pending once the request has been rejected.
            for ($i = $level; $i < count($chain); $i++) {
                $st = $chain[$i]['status'] ?? 'Pending';
                if (!in_array($st, ['Approved', 'Rejected'], true)) {
                    $chain[$i]['status'] = 'Skipped';
                }
            }
            $row->approval_chain = $chain;
            $row->status = 'Rejected';
            $row->approved_by = $user->id;
            $row->approved_at = now();
            $row->approver_comment = $data['comment'] ?? null;
        } else {
            // Approved — advance to next actionable level or finalize.
            // firstActionableLevel walks past any consecutive Skipped
            // entries so a 3-level chain with the middle level skipped
            // collapses correctly from level 1 → 3.
            $nextLevel = $this->firstActionableLevel($chain, $level + 1);
            if ($nextLevel > count($chain)) {
                $row->status = 'Approved';
                $row->approved_by = $user->id;
                $row->approved_at = now();
                $row->approver_comment = $data['comment'] ?? null;
            } else {
                $row->current_approval_level = $nextLevel;
                // Stays Pending — the next level needs to act.
            }
        }
        $row->save();

        /* Notice-period rule 2 — a FINALLY approved unpaid leave taken while
           serving notice pushes the last working day out by its length, so the
           notice period is still served in full. Runs only on the terminal
           Approved state, never on an intermediate chain level. */
        $noticeDays = 0;
        if ($row->status === 'Approved') {
            $noticeDays = NoticePeriodGuard::applyExtension($row, Employee::find($row->employee_id));
        }

        // Fire notifications based on the new state. Logged-only on failure.
        $this->notifyForDecision($row, $data['comment'] ?? null);

        // A finalized leave decision changes paid/unpaid days — propagate it to
        // any non-locked payroll already generated for this employee.
        if (in_array($row->status, ['Approved', 'Rejected'], true)) {
            $this->propagateToPayroll($row->employee_id);
        }

        return response()->json([
            'data' => $row->fresh(['leaveType:id,name,short_code']),
            // Surfaced so the approver is told the exit date moved rather than
            // discovering it later on the exit screen.
            'notice_extension' => $noticeDays > 0 ? [
                'days'             => $noticeDays,
                'last_working_day' => NoticePeriodGuard::lastWorkingDayLabel(Employee::find($row->employee_id)),
            ] : null,
        ]);
    }

    /** Recompute the employee's draft/generated payslips so a leave change
     *  reflects everywhere (locked runs are untouched). Best-effort. */
    private function propagateToPayroll(?int $employeeId): void
    {
        if (!$employeeId) return;
        try {
            app(\App\Services\PayrollService::class)->recomputeEmployeePayslips((int) $employeeId);
        } catch (\Throwable $e) {
            // Never block a leave action on a payroll recompute hiccup — but LOG
            // it so a silent payroll/leave divergence can be diagnosed. (LV-29)
            \Illuminate\Support\Facades\Log::warning('Leave→payroll propagation failed', [
                'employee_id' => $employeeId,
                'error'       => $e->getMessage(),
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approvers list — surfaces the "View Approvers" popover on a request.
    // Now returns the full snapshotted chain with per-level status + actor.
    // ─────────────────────────────────────────────────────────────────────
    public function approvers(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findScopedOrFail($id, $user);
        $chain = $row->approval_chain ?? [];

        // Hydrate each level with the resolved approver's name / email.
        $employeeIds = collect($chain)->pluck('approver_employee_id')->filter()->unique()->all();
        $employees = Employee::with('user:id,name,email')
            ->whereIn('id', $employeeIds)
            ->get()->keyBy('id');
        // Some levels (e.g. a reporting manager who is a login User, not an
        // Employee) resolve to a user id — hydrate those names too.
        $userIds = collect($chain)->pluck('approver_user_id')->filter()->unique()->all();
        $users = \App\Models\User::whereIn('id', $userIds)->get(['id', 'name', 'email'])->keyBy('id');

        $out = [];
        foreach ($chain as $i => $entry) {
            $empId = $entry['approver_employee_id'] ?? null;
            $emp = $empId ? ($employees[$empId] ?? null) : null;
            $uId = $entry['approver_user_id'] ?? null;
            $u = $uId ? ($users[$uId] ?? null) : null;
            $name = $emp
                ? trim($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')))
                : ($u ? trim((string) $u->name) : ($entry['approver_label'] ?? 'Unassigned'));
            $out[] = [
                'level' => $entry['level'] ?? ($i + 1),
                'role' => $entry['approver_role'] ?? ucfirst(str_replace('_', ' ', $entry['approver_kind'] ?? 'Approver')),
                'kind' => $entry['approver_kind'] ?? 'reporting_manager',
                'employee_id' => $empId,
                'name' => $name,
                'email' => $emp?->email ?? $u?->email,
                'status' => $entry['status'] ?? 'Pending',
                'acted_at' => $entry['acted_at'] ?? null,
                'comment' => $entry['comment'] ?? null,
                'is_current' => ($i + 1) === (int) ($row->current_approval_level ?? 1)
                                && $row->status === 'Pending',
            ];
        }

        // Backward compat: if a request has no chain (pre-migration data),
        // return the v1 single-line response so existing UI keeps working.
        if (empty($out)) {
            $employee = Employee::find($row->employee_id);
            if ($employee && $employee->reporting_manager_id) {
                $rm = Employee::find($employee->reporting_manager_id);
                if ($rm) {
                    $out[] = [
                        'level' => 1,
                        'role' => 'Reporting Manager',
                        'kind' => 'reporting_manager',
                        'employee_id' => $rm->id,
                        'name' => trim($rm->display_name ?: trim(($rm->first_name ?? '') . ' ' . ($rm->last_name ?? ''))),
                        'email' => $rm->email,
                        'status' => 'Pending',
                        'acted_at' => null,
                        'comment' => null,
                        'is_current' => true,
                    ];
                }
            }
        }

        return response()->json(['data' => $out]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers — chain snapshotting + per-level approver checks
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Build the approval chain that gets frozen onto a new leave_request.
     * Reads the plan-type Setup config_json.approval.chain when present;
     * otherwise falls back to a single "Reporting Manager" level so v1
     * behaviour is preserved.
     *
     * Conditional skip rules: each chain entry may carry `skip_if` with
     * one or more numeric thresholds (e.g. {"days_lt": 2}). When a rule
     * matches at submission time the level is created with status =
     * Skipped, so it never blocks the request. snapshotApprovalChain
     * evaluates against the leave's day count and returns the chain
     * already-marked; setStatus / firstActionableLevel then walk past
     * skipped levels automatically.
     */
    private function snapshotApprovalChain(Employee $employee, ?int $planId, int $leaveTypeId, float $days = 0): array
    {
        $rawChain = null;
        if ($planId) {
            $pivot = DB::table('leave_plan_leave_types')
                ->where('leave_plan_id', $planId)
                ->where('leave_type_id', $leaveTypeId)
                ->value('config_json');
            if ($pivot) {
                $cfg = is_string($pivot) ? json_decode($pivot, true) : $pivot;
                $approval = $cfg['approval'] ?? null;
                // Two shapes supported:
                //   - new: approval.chain = [{kind, role, user_id, ...}, ...]
                //   - legacy: approval.required + approval.approverRole — wrap as a single level
                if (is_array($approval['chain'] ?? null) && count($approval['chain']) > 0) {
                    $rawChain = $approval['chain'];
                } elseif (!empty($approval['required']) && !empty($approval['approverRole'])) {
                    $rawChain = [['approver_kind' => 'role', 'approver_role' => $approval['approverRole']]];
                }
            }
        }
        if ($rawChain === null) {
            // No saved config — default to Reporting Manager only. The manager
            // approves or rejects and that decision is final; HR is view-only.
            $rawChain = [
                ['approver_kind' => 'reporting_manager'],
            ];
        }

        // HR is view-only: strip any HR role level from the chain so it ends at
        // the reporting manager, even for leave types whose config_json still
        // carries a legacy RM → HR chain. If filtering empties the chain (e.g. a
        // legacy HR-only config), fall back to the reporting manager.
        $rawChain = array_values(array_filter($rawChain, function ($r) {
            $kind = $r['approver_kind'] ?? ($r['kind'] ?? null);
            $role = strtolower((string) ($r['approver_role'] ?? ($r['role'] ?? '')));
            return !($kind === 'role' && $role === 'hr');
        }));
        if (empty($rawChain)) {
            $rawChain = [['approver_kind' => 'reporting_manager']];
        }

        $chain = [];
        foreach ($rawChain as $i => $r) {
            $kind = $r['approver_kind'] ?? ($r['kind'] ?? 'reporting_manager');
            $role = $r['approver_role'] ?? ($r['role'] ?? null);
            $userId = $r['approver_user_id'] ?? ($r['user_id'] ?? null);
            $empIdOverride = $r['approver_employee_id'] ?? ($r['employee_id'] ?? null);

            // Resolve to a concrete employee_id when possible. Reporting
            // Manager is read off the requesting employee. Role-based and
            // user-based references stay symbolic — resolution happens at
            // approval time in canActOnLevel().
            $resolvedEmpId = $empIdOverride;
            $resolvedUserId = $userId;
            if (!$resolvedEmpId && $kind === 'reporting_manager') {
                $resolvedEmpId = $employee->reporting_manager_id;
                // The reporting manager may be stored as a login User (a
                // Client/Branch admin) rather than an Employee row — fall back
                // to it so the level resolves to that user instead of staying
                // Unassigned.
                if (!$resolvedEmpId && !$resolvedUserId) {
                    $resolvedUserId = $employee->reporting_manager_user_id;
                }
            }

            // If the resolved approver is soft-deleted (active employee
            // record gone but reporting_manager_id still points at the
            // legacy id), treat as missing so the chain auto-skips this
            // level instead of stalling forever.
            $resolvedExists = $resolvedEmpId
                ? Employee::where('id', $resolvedEmpId)->exists()
                : true;

            $skipIf = $r['skip_if'] ?? null;
            $shouldSkip = $this->evaluateSkipRule($skipIf, ['days' => $days]);
            $skipReason = $shouldSkip ? 'Auto-skipped by rule' : null;

            // Defensive: a level that ultimately points back at the
            // requester themselves (self-loop, common when HR forgot to
            // set the RM during onboarding so it defaults to their own
            // id) would otherwise stall forever or — worse — let the
            // requester self-approve. Catches both:
            //   - kind === 'reporting_manager' resolving to self
            //   - kind === 'role' with role === 'reporting_manager'
            //     where employee.reporting_manager_id is the requester
            //   - explicit approver_employee_id / approver_user_id that
            //     happens to point at the requester
            $loopsToSelf = false;
            if (!$shouldSkip) {
                if ($kind === 'reporting_manager'
                    && $resolvedEmpId
                    && (int) $resolvedEmpId === (int) $employee->id
                ) {
                    $loopsToSelf = true;
                } elseif ($kind === 'role'
                    && strtolower((string) $role) === 'reporting_manager'
                    && $employee->reporting_manager_id
                    && (int) $employee->reporting_manager_id === (int) $employee->id
                ) {
                    $loopsToSelf = true;
                } elseif ($empIdOverride
                    && (int) $empIdOverride === (int) $employee->id
                ) {
                    $loopsToSelf = true;
                } elseif ($resolvedUserId
                    && (int) $resolvedUserId === (int) ($employee->user_id ?? 0)
                ) {
                    $loopsToSelf = true;
                }
            }
            if ($loopsToSelf) {
                $shouldSkip = true;
                $skipReason = 'Auto-skipped — approver resolves to the requester (self-loop)';
            } elseif (!$shouldSkip
                && $resolvedEmpId
                && !$resolvedExists
            ) {
                if ($kind === 'reporting_manager') {
                    // The reporting manager was removed / soft-deleted. Do NOT
                    // skip this level: on the default sole-RM chain, skipping the
                    // only level makes firstActionableLevel run past the end and
                    // the request auto-approves with no human review (bug #68).
                    // Keep it Pending — an inactive/disabled/missing RM is treated
                    // as unavailable by isReportingManagerUnavailable(), so HR can
                    // step in (Bug 55) and the request is actually reviewed
                    // instead of silently granted.
                    $skipReason = 'Reporting manager unavailable — awaiting HR review';
                } else {
                    // A non-RM explicit approver that no longer exists → skip to
                    // the next level so the chain doesn't stall on a dead entry.
                    $shouldSkip = true;
                    $skipReason = "Auto-skipped — approver employee #{$resolvedEmpId} no longer exists";
                }
            }

            $chain[] = [
                'level' => $i + 1,
                'approver_kind' => $kind,
                'approver_role' => $role,
                'approver_user_id' => $resolvedUserId,
                'approver_employee_id' => $resolvedEmpId,
                'approver_label' => $r['label'] ?? null,
                'skip_if' => $skipIf,
                'status' => $shouldSkip ? 'Skipped' : 'Pending',
                'acted_by' => null,
                'acted_at' => null,
                'comment' => $skipReason,
            ];
        }
        return $chain;
    }

    /**
     * Decide if a chain entry should be auto-skipped at submission time
     * based on the request's runtime values. Supported keys (extend as
     * needed):
     *   days_lt / days_lte / days_gt / days_gte — compare to ctx.days
     */
    private function evaluateSkipRule(mixed $rule, array $ctx): bool
    {
        if (!is_array($rule) || empty($rule)) return false;
        $days = (float) ($ctx['days'] ?? 0);
        if (array_key_exists('days_lt', $rule)  && $days < (float) $rule['days_lt'])  return true;
        if (array_key_exists('days_lte', $rule) && $days <= (float) $rule['days_lte']) return true;
        if (array_key_exists('days_gt', $rule)  && $days > (float) $rule['days_gt'])  return true;
        if (array_key_exists('days_gte', $rule) && $days >= (float) $rule['days_gte']) return true;
        return false;
    }

    /**
     * Walk forward from `start` (1-based) past every Skipped level until
     * we hit a Pending one (or run past the end of the chain). Used at
     * snapshot time to set current_approval_level, and after each
     * approval to fast-forward through consecutive skips.
     */
    private function firstActionableLevel(array $chain, int $start): int
    {
        $i = max(1, $start);
        while ($i <= count($chain)) {
            $status = $chain[$i - 1]['status'] ?? 'Pending';
            if ($status === 'Pending') return $i;
            $i++;
        }
        return count($chain) + 1; // past the end → fully approved
    }

    /**
     * Can the given user act on the given chain entry? True when their
     * linked employee matches approver_employee_id, OR their user_id
     * matches approver_user_id, OR (for role-based levels) they hold the
     * named role. Admin / HR scopes bypass via the caller.
     */
    /** Public so cross-module inboxes (e.g. MyTeamController approvals) can
     *  reuse the exact per-level approver resolution without duplicating it. */
    public function canActOnLevel($user, array $chain, int $idx, ?LeaveRequest $request = null): bool
    {
        if (!isset($chain[$idx])) return false;
        $entry = $chain[$idx];
        if (!empty($entry['approver_user_id']) && (int)$entry['approver_user_id'] === (int)$user->id) {
            return true;
        }
        if (!empty($entry['approver_employee_id'])) {
            $myEmpId = Employee::where('user_id', $user->id)->value('id');
            if ($myEmpId && (int)$entry['approver_employee_id'] === (int)$myEmpId) {
                return true;
            }
        }
        if (!empty($entry['approver_role'])) {
            // Role gating — `branch_user` and `client_admin` are treated as
            // HR-equivalent here. Extend with proper role-table lookups if
            // org structure formalizes more roles later.
            $role = strtolower($entry['approver_role']);
            if ($role === 'hr' && in_array($user->user_type, ['branch_user', 'client_admin'], true)) {
                return true;
            }
            if ($role === 'branch_admin' && $user->user_type === 'branch_user') {
                return true;
            }
            if ($role === 'reporting_manager' && $request) {
                $emp = Employee::find($request->employee_id);
                if ($emp && $emp->reporting_manager_id) {
                    $myEmpId = Employee::where('user_id', $user->id)->value('id');
                    if ($myEmpId && (int)$emp->reporting_manager_id === (int)$myEmpId) return true;
                }
            }
        }
        if (($entry['approver_kind'] ?? '') === 'reporting_manager' && $request) {
            $emp = Employee::find($request->employee_id);
            if ($emp && $emp->reporting_manager_id) {
                $myEmpId = Employee::where('user_id', $user->id)->value('id');
                if ($myEmpId && (int)$emp->reporting_manager_id === (int)$myEmpId) return true;
            }
        }
        return false;
    }

    /**
     * Chargeable leave days for [from, to]. A single half-day is 0.5; otherwise
     * each working day in the range counts 1, and weekly-offs / holidays inside
     * the range are free.
     *
     * Unless the employee's BRANCH runs the Sandwich Leave Policy, in which case
     * an off-day flanked by leave on both sides is charged as well — see
     * App\Support\SandwichPolicy. The extra days can fall outside [from, to]:
     * when Friday and Monday were applied for separately, the Monday request is
     * the one that pays for the weekend between them.
     */
    private function computeLeaveDays(
        Carbon $from,
        Carbon $to,
        string $dayType,
        Employee $employee,
        ?int $ignoreRequestId = null,
        bool $sandwichWaived = false,
    ): float {
        if ($dayType !== 'full' && $from->isSameDay($to)) return 0.5;

        $weeklyOffLabel = (string) ($employee->weekly_off ?? '');

        // Holidays are fetched for a PADDED window. The sandwich scan steps
        // outside the request on both sides, and a holiday just beyond the
        // edge is part of the run it is testing — loading only [from, to]
        // would make that day look like a working day and silently break the
        // flanking test.
        $pad     = \App\Support\SandwichPolicy::LOOKAROUND_DAYS;
        $padFrom = $from->copy()->subDays($pad);
        $padTo   = $to->copy()->addDays($pad);

        $holidaySet = $employee->holiday_group_id
            ? $this->holidayDatesInRange((int) $employee->holiday_group_id, $padFrom, $padTo)
            : [];

        $isOff = fn (Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        $total = 0.0;
        foreach (CarbonPeriod::create($from->copy()->startOfDay(), $to->copy()->startOfDay()) as $d) {
            if (!$isOff($d)) $total += 1.0;
        }

        // A waiver spares THIS leave only. The employee was still absent on
        // those days, so the leave keeps counting as leave for any neighbouring
        // request's own sandwich test — waiving one leave must not quietly
        // un-sandwich another.
        if (!$sandwichWaived && \App\Support\SandwichPolicy::appliesTo($employee)) {
            $approved = \App\Support\SandwichPolicy::approvedLeaveDates(
                (int) $employee->id, $padFrom, $padTo, $ignoreRequestId,
            );
            $rangeStart = $from->copy()->startOfDay();
            $rangeEnd   = $to->copy()->startOfDay();
            // "On leave" means this request's own days OR any other approved
            // leave — the two halves of a sandwich are routinely filed apart.
            $isLeave = function (Carbon $d) use ($approved, $rangeStart, $rangeEnd): bool {
                $day = $d->copy()->startOfDay();
                if ($day->gte($rangeStart) && $day->lte($rangeEnd)) return true;
                return isset($approved[$day->toDateString()]);
            };
            $total += count(
                \App\Support\SandwichPolicy::chargeableOffDays($from, $to, $isOff, $isLeave)
            );
        }

        return $total;
    }

    /* parseWeeklyOffSet() lived here — a duplicate of the one in
     * AttendanceController. Both are gone: App\Support\WeekOff::isOff() is now
     * the single answer to "is this date an off day?", and it understands the
     * nth-Saturday patterns a day-of-week set never could. */

    /** Holiday dates (Y-m-d => true) for a group within [start, end], re-anchoring
     *  recurring holidays to the window's year. */
    private function holidayDatesInRange(int $groupId, Carbon $start, Carbon $end): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('holidays')) return [];
        $rows = DB::table('holidays')
            ->where('holiday_group_id', $groupId)
            ->whereNull('deleted_at')
            ->get(['date', 'is_recurring']);
        $out = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $d = Carbon::parse($r->date);

            if ($r->is_recurring) {
                /* Anchor to EVERY year the window touches, not just the start
                 * year. Callers pad this window by SandwichPolicy::LOOKAROUND_DAYS
                 * on both sides, so a leave in late December is looked up across
                 * a range that ends in January — and anchoring a recurring 1 Jan
                 * to the START year produced last January's date, which then
                 * failed the range test and was dropped. New Year read as an
                 * ordinary working day, which both truncated the off-run being
                 * walked and broke the flanking test beside it.
                 *
                 * PayrollService::holidayDateSet() has always anchored this way,
                 * so the leave screen and the payslip were sizing the same leave
                 * off different calendars across a year boundary. */
                foreach (range($start->year, $end->year) as $year) {
                    $anchored = Carbon::create($year, $d->month, $d->day);
                    if ($anchored->gte($start) && $anchored->lte($end)) {
                        $out[$anchored->toDateString()] = true;
                    }
                }
                continue;
            }

            if ($d->lt($start) || $d->gt($end)) continue;
            $out[$d->toDateString()] = true;
        }
        return $out;
    }

    /**
     * Is the requester's reporting manager currently UNAVAILABLE to approve —
     * i.e. on an approved leave that covers today, an inactive/soft-deleted
     * employee, a disabled login user, or simply not assigned? When true, leave
     * approval is allowed to fall through to HR so requests don't deadlock under
     * a manager who is away on vacation. (Bug 55)
     */
    /**
     * isReportingManagerUnavailable() for a whole page, in a fixed number of
     * queries rather than three per row.
     *
     * Same four conditions as the single-row version — RM record missing,
     * inactive, login disabled, or on an approved leave covering today — just
     * answered set-at-a-time.
     *
     * @param  \Illuminate\Support\Collection<int, LeaveRequest>  $rows
     * @return array<int, bool>  keyed by leave_request id
     */
    private function rmUnavailableMap($rows): array
    {
        if ($rows->isEmpty()) return [];

        $empIds = $rows->pluck('employee_id')->filter()->unique()->values()->all();
        if (empty($empIds)) return [];

        $employees = Employee::whereIn('id', $empIds)
            ->get(['id', 'reporting_manager_id', 'reporting_manager_user_id'])
            ->keyBy('id');

        $rmEmpIds = $employees->pluck('reporting_manager_id')->filter()->unique()->values()->all();
        $rmUserIds = $employees->pluck('reporting_manager_user_id')->filter()->unique()->values()->all();

        $rmEmployees = $rmEmpIds
            ? Employee::whereIn('id', $rmEmpIds)->get(['id', 'status', 'user_id'])->keyBy('id')
            : collect();

        // Logins to check: the RMs' own, plus any RM stored directly as a user.
        $userIds = array_values(array_unique(array_merge(
            $rmEmployees->pluck('user_id')->filter()->all(),
            $rmUserIds,
        )));
        $users = $userIds
            ? User::whereIn('id', $userIds)->get(['id', 'status'])->keyBy('id')
            : collect();

        $todayStr = now(self::DISPLAY_TZ)->toDateString();
        $onLeave = $rmEmpIds
            ? LeaveRequest::whereIn('employee_id', $rmEmpIds)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $todayStr)
                ->whereDate('to_date', '>=', $todayStr)
                ->pluck('employee_id')
                ->map(fn ($v) => (int) $v)
                ->flip()
            : collect();

        $out = [];
        foreach ($rows as $row) {
            $emp = $employees->get($row->employee_id);
            if (!$emp) { $out[$row->id] = false; continue; }

            if ($emp->reporting_manager_id) {
                $rm = $rmEmployees->get($emp->reporting_manager_id);
                if (!$rm) { $out[$row->id] = true; continue; }                  // record gone
                if (strcasecmp((string) $rm->status, 'Active') !== 0) { $out[$row->id] = true; continue; }
                if ($rm->user_id) {
                    $u = $users->get($rm->user_id);
                    if ($u && strcasecmp((string) $u->status, 'active') !== 0) { $out[$row->id] = true; continue; }
                }
                $out[$row->id] = $onLeave->has((int) $emp->reporting_manager_id);
                continue;
            }

            if ($emp->reporting_manager_user_id) {
                $u = $users->get($emp->reporting_manager_user_id);
                $out[$row->id] = !$u || strcasecmp((string) $u->status, 'active') !== 0;
                continue;
            }

            // No manager assigned at all — same verdict as the per-row version.
            $out[$row->id] = true;
        }

        return $out;
    }

    public function isReportingManagerUnavailable(LeaveRequest $row): bool
    {
        $emp = Employee::find($row->employee_id);
        if (!$emp) return false;
        $todayStr = now(self::DISPLAY_TZ)->toDateString();

        // RM stored as an Employee row.
        if ($emp->reporting_manager_id) {
            $rm = Employee::find($emp->reporting_manager_id);
            if (!$rm) return true; // RM record gone
            if (strcasecmp((string) $rm->status, 'Active') !== 0) return true; // inactive
            if ($rm->user_id) {
                $u = User::find($rm->user_id);
                if ($u && strcasecmp((string) $u->status, 'active') !== 0) return true; // disabled login
            }
            // RM on an approved leave that covers today.
            $onLeave = LeaveRequest::where('employee_id', $rm->id)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $todayStr)
                ->whereDate('to_date', '>=', $todayStr)
                ->exists();
            return $onLeave;
        }

        // RM stored as a login user (Client/Branch admin acting as manager).
        if ($emp->reporting_manager_user_id) {
            $u = User::find($emp->reporting_manager_user_id);
            if (!$u) return true;
            return strcasecmp((string) $u->status, 'active') !== 0;
        }

        // No reporting manager at all → must route to HR.
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Notification dispatchers — fire and forget. Every send is wrapped
    // in try/catch + Log::warning so a flaky SMTP / missing recipient
    // doesn't break the API call that triggered it.
    // ─────────────────────────────────────────────────────────────────────

    private function notifyForSubmission(LeaveRequest $row, Employee $employee): void
    {
        // 1) Every approver at level 1 (role-based levels can fan out
        //    to multiple users, e.g. all HRs in the tenant).
        foreach ($this->resolveApproverNotifiables($row, 1, $employee) as $r) {
            $this->safeSend($r, new LeaveRequestNotification($row, 'submitted_to_approver'));
        }

        // 1b) Deadlock escape (Bug 55): if the reporting manager is unavailable
        //     (on approved leave, disabled, or unassigned), the only level-1
        //     recipient above is an absent manager — the request would sit
        //     silently. Also notify HR (every branch_user / client_admin in the
        //     tenant) so they know to step in and approve/reject in the RM's
        //     place. Backend already permits HR to act in this case.
        if ($this->isReportingManagerUnavailable($row)) {
            foreach ($this->resolveRoleRecipients('hr', $employee) as $r) {
                $this->safeSend($r, new LeaveRequestNotification($row, 'escalated_to_hr'));
            }
        }

        // 2) CC'd colleagues from notify.employee_ids
        $ccIds = $this->extractNotifyEmployeeIds($row);
        foreach ($ccIds as $ccEmpId) {
            $cc = Employee::find($ccEmpId);
            if (!$cc) continue;
            $n = LeaveRequestNotification::notifiableFromEmployee($cc);
            $this->safeSend($n instanceof AnonymousNotifiable ? $n->route('mail', $cc->email) : $n,
                new LeaveRequestNotification($row, 'cc_submitted'));
        }
    }

    private function notifyForDecision(LeaveRequest $row, ?string $comment): void
    {
        $employee = Employee::find($row->employee_id);
        if (!$employee) return;
        $employeeNotifiable = LeaveRequestNotification::notifiableFromEmployee($employee);
        $employeeNotifiable = $employeeNotifiable instanceof AnonymousNotifiable
            ? $employeeNotifiable->route('mail', $employee->email)
            : $employeeNotifiable;

        if ($row->status === 'Rejected') {
            $this->safeSend($employeeNotifiable, new LeaveRequestNotification($row, 'rejected', $comment));
            return;
        }

        if ($row->status === 'Approved') {
            // Final approval reached — tell the employee
            $this->safeSend($employeeNotifiable, new LeaveRequestNotification($row, 'approved', $comment));
            return;
        }

        // Still Pending → advanced to a new level. Notify every approver
        // at the new level (role-based fans out to all users).
        foreach ($this->resolveApproverNotifiables($row, (int)$row->current_approval_level, $employee) as $r) {
            $this->safeSend($r, new LeaveRequestNotification($row, 'submitted_to_approver'));
        }
    }

    private function notifyForCancellation(LeaveRequest $row): void
    {
        $employee = Employee::find($row->employee_id);
        if (!$employee) return;
        foreach ($this->resolveApproverNotifiables($row, (int)$row->current_approval_level, $employee) as $r) {
            $this->safeSend($r, new LeaveRequestNotification($row, 'cancelled'));
        }
    }

    /**
     * Resolve recipients for the given chain level (1-based) on a request.
     * Returns an ARRAY of notifiables — most levels have one (RM, specific
     * user/employee) but role-based levels can have many (every HR user
     * in the tenant). Empty array means "couldn't resolve to anyone".
     *
     * Also handles the pre-migration fallback when a request has no
     * approval_chain — defaults to the single Reporting Manager line.
     */
    private function resolveApproverNotifiables(LeaveRequest $row, int $level, Employee $employee): array
    {
        $chain = $row->approval_chain ?? [];
        $entry = $chain[$level - 1] ?? null;
        if (!$entry) {
            if ($employee->reporting_manager_id) {
                $rm = Employee::find($employee->reporting_manager_id);
                $r = $rm ? $this->employeeAsRecipient($rm) : null;
                return $r ? [$r] : [];
            }
            return [];
        }

        $kind = $entry['approver_kind'] ?? 'reporting_manager';

        if (!empty($entry['approver_user_id'])) {
            $u = User::find((int)$entry['approver_user_id']);
            return $u && $u->email ? [$u] : [];
        }

        if (!empty($entry['approver_employee_id'])) {
            $emp = Employee::find((int)$entry['approver_employee_id']);
            $r = $emp ? $this->employeeAsRecipient($emp) : null;
            return $r ? [$r] : [];
        }

        if ($kind === 'reporting_manager' && $employee->reporting_manager_id) {
            $rm = Employee::find($employee->reporting_manager_id);
            $r = $rm ? $this->employeeAsRecipient($rm) : null;
            return $r ? [$r] : [];
        }

        if ($kind === 'role' && !empty($entry['approver_role'])) {
            return $this->resolveRoleRecipients((string)$entry['approver_role'], $employee);
        }

        return [];
    }

    /**
     * Map a chain role-name to the set of users that fill that role for
     * the requestor's tenant.
     *
     *   hr / branch_admin → all branch_user + client_admin in the same
     *                        client (and same branch when set)
     *   reporting_manager → the requestor's RM (treated like the kind)
     *
     * We don't have a roles table per se yet — branch_user / client_admin
     * are the de-facto HR roles in this codebase. Extend with proper
     * master_roles lookups later if/when org structure formalizes more
     * named approval roles.
     */
    private function resolveRoleRecipients(string $role, Employee $employee): array
    {
        $role = strtolower($role);

        if ($role === 'reporting_manager') {
            if (!$employee->reporting_manager_id) return [];
            // Self-loop guard — never notify the requester as their own
            // approver (handled at snapshot time too, but the runtime
            // resolver might be called with a stale chain).
            if ((int) $employee->reporting_manager_id === (int) $employee->id) return [];
            $rm = Employee::find($employee->reporting_manager_id);
            $r = $rm ? $this->employeeAsRecipient($rm) : null;
            return $r ? [$r] : [];
        }

        if (!in_array($role, ['hr', 'branch_admin'], true)) {
            return [];
        }

        $userTypes = $role === 'branch_admin'
            ? ['branch_user']
            : ['branch_user', 'client_admin'];

        $q = User::query()
            ->whereIn('user_type', $userTypes)
            ->whereNotNull('email');
        if ($employee->client_id) $q->where('client_id', $employee->client_id);
        if ($role === 'branch_admin' && $employee->branch_id) {
            $q->where('branch_id', $employee->branch_id);
        }

        return $q->get()->all();
    }

    /**
     * Backward-compatible wrapper used by older callers — returns the
     * FIRST recipient or null. New code should call the array version
     * directly so role-based levels notify everyone.
     */
    private function resolveApproverNotifiable(LeaveRequest $row, int $level, Employee $employee): mixed
    {
        $list = $this->resolveApproverNotifiables($row, $level, $employee);
        return $list[0] ?? null;
    }

    private function employeeAsRecipient(Employee $emp): mixed
    {
        if ($emp->user_id) {
            $u = User::find($emp->user_id);
            if ($u && $u->email) return $u;
        }
        if (!empty($emp->email)) {
            return (new AnonymousNotifiable)->route('mail', $emp->email);
        }
        return null;
    }

    private function extractNotifyEmployeeIds(LeaveRequest $row): array
    {
        $notify = $row->notify;
        if (!is_array($notify)) return [];
        $ids = $notify['employee_ids'] ?? null;
        if (!is_array($ids)) return [];
        return array_values(array_filter(array_map('intval', $ids), fn($v) => $v > 0));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Tenant scope guard — every single-row endpoint (show / approve /
    // reject / cancel / approvers) must hit this so a user in client X
    // can't read or act on a leave_request belonging to client Y just by
    // guessing the ID. Super admins bypass the check; everyone else is
    // pinned to their own client_id.
    // ─────────────────────────────────────────────────────────────────────
    private function findScopedOrFail(int $id, $user): LeaveRequest
    {
        $row = LeaveRequest::findOrFail($id);
        if ($user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $row->client_id !== (int) $user->client_id) {
            abort(404);
        }
        // Branch isolation. This guard fronts show / hrView / approve / reject
        // / approvers, so without it a branch user who knew (or guessed) an id
        // could read AND decide a sibling branch's leave request — the listing
        // leak with worse consequences. A NULL branch_id row is client-level
        // and stays visible, matching the convention used elsewhere.
        if (($user->user_type ?? null) === 'branch_user'
            && $user->branch_id
            && $row->branch_id
            && (int) $row->branch_id !== (int) $user->branch_id) {
            abort(404);
        }
        return $row;
    }

    private function safeSend(mixed $notifiable, LeaveRequestNotification $notif): void
    {
        if (!$notifiable) return;
        try {
            // LV-28: the notification implements ShouldQueue, but there is no
            // queue worker — so a normal send()/notify() would sit undelivered
            // forever. Force SYNCHRONOUS delivery so approval emails actually go.
            if ($notifiable instanceof AnonymousNotifiable) {
                Notification::sendNow($notifiable, $notif);
            } else {
                $notifiable->notifyNow($notif);
            }
        } catch (\Throwable $e) {
            Log::warning('[leave-notify] dispatch failed: ' . $e->getMessage(), [
                'request_id' => $notif->request->id ?? null,
                'kind'       => $notif->kind ?? null,
            ]);
        }
    }
}
