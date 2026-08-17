<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\Module;
use App\Models\Permission;
use App\Mail\ExitFarewellMail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Exit Process — Stage 1 (Exit Initiation & Approval) backend.
 *
 *   GET /api/employees/{employee}/exit          show
 *   PUT /api/employees/{employee}/exit          upsert
 *
 * Subsequent stages (asset return, clearance, FnF, etc.) will layer on
 * additional endpoints; this controller's `show` always returns one row
 * (created lazily on first PUT), so the SPA can render the form
 * regardless of whether the admin has saved anything yet.
 */
class ExitController extends Controller
{
    /** Dates are decided in IST — the app runs in UTC, so a raw now() reports
     *  yesterday for the first 5.5h of every local day. */
    private const DISPLAY_TZ = 'Asia/Kolkata';


    public function show(Request $request, $employee)
    {
        // Resolve withTrashed — a disabled (soft-deleted) employee still appears
        // in the Exit hub, so its exit form must load instead of 404-ing.
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee);
        $row = EmployeeExit::with(['manager:id,first_name,middle_name,last_name,display_name,emp_code'])
            ->where('employee_id', $employee->id)
            ->first();
        /* A REHIRED case is spent history, not this person's exit. The table
           keeps one row per employee (unique index on employee_id), so the row
           an exited-then-rehired employee carries is the PREVIOUS employment's
           closed case — F&F approved and paid, every clearance ticked, HR
           signed off. Handing it back here made a freshly initiated exit open
           with Stage 4 already at 100% before Stage 1 was even filled in, and
           the whole wizard pre-completed with work nobody did this time round.
           The new case starts blank; upsert() clears the spent row on save. */
        if ($row && $row->rehired_at) {
            $row = null;
        }
        return response()->json($this->format($row, $employee));
    }

    /** Statuses that mean the person is no longer on the active roll. */
    private const EXITED_STATUSES = ['Resigned', 'Terminated', 'Inactive'];

    /**
     * Employee ids with an exit already in progress.
     *
     * They are still `Active` — the status only flips at complete() — so the
     * status filter alone would happily offer them as replacement managers, and
     * handing reports to someone who is themselves leaving just moves the
     * blocker onto their case.
     */
    private function employeeIdsExiting(?int $clientId): array
    {
        return EmployeeExit::query()
            ->when($clientId !== null, fn ($q) => $q->where('client_id', $clientId))
            ->whereNotNull('exit_type')
            ->where('exit_case_status', 'Open')
            ->whereNull('rehired_at')
            ->pluck('employee_id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    /**
     * Would making $managerId the manager of $reportId create a loop?
     *
     * PositionHierarchy::eligible() is deliberately LENIENT when either rank is
     * unknown (a custom designation outside the seeded map) — it allows the
     * pairing rather than blocking a legitimate save over an unrecognised
     * title. That leniency is the gap: two employees whose designations are
     * both unranked can be pointed at each other, and A → B → A makes every
     * reader that walks the chart (My Team, the permission subordinate check,
     * approval routing) loop forever.
     *
     * So the chain is walked upward from the proposed manager: if the report
     * appears anywhere above, the assignment is a cycle. The depth cap is a
     * backstop against a loop that ALREADY exists in the data — without it this
     * guard would itself hang on the corruption it is meant to detect.
     */
    private function wouldCycle(int $reportId, int $managerId): bool
    {
        $seen    = [];
        $current = $managerId;
        for ($depth = 0; $depth < 64 && $current; $depth++) {
            if ($current === $reportId) return true;
            if (isset($seen[$current])) return true;   // pre-existing loop
            $seen[$current] = true;
            $current = (int) Employee::whereKey($current)->value('reporting_manager_id');
        }
        return false;
    }

    /**
     * Everyone who still reports to this employee and is still on the roll.
     *
     * A manager cannot be deactivated while people report to them — the org
     * chart would keep pointing at a disabled row, and every reader that walks
     * it (My Team, leave and expense approvals, the permission subordinate
     * check) would dead-end there. So the exit is blocked until each of these
     * is moved to someone else. See complete().
     *
     * Soft-deleted reports are excluded: they are already switched off, so they
     * have no live approval chain to strand.
     */
    private function activeDirectReports(Employee $employee)
    {
        return Employee::query()
            ->where('reporting_manager_id', $employee->id)
            ->whereNotIn('status', self::EXITED_STATUSES)
            ->with(['department:id,name', 'designation:id,name'])
            ->orderBy('display_name')
            ->get();
    }

    /**
     * Columns that belong to ONE exit case. Cleared when a rehired employee
     * starts a new exit, so the previous employment's answers can't bleed into
     * it. Identity/tenancy columns (employee, client, branch) are deliberately
     * absent — they survive the reset.
     */
    private const CASE_COLUMNS = [
        'exit_type', 'initiated_by', 'reason_for_exit', 'other_reason',
        'notice_date', 'last_working_day', 'reporting_manager_id', 'comments',
        'business_impact', 'replacement_required',
        'clearances', 'asset_returns', 'handover_notes',
        'validation', 'final_employee_status', 'profile_lock',
        'exit_case_status', 'hr_sign_off', 'stage_status', 'current_stage', 'completed_at',
        'notice_settlement_mode', 'notice_payment_choice',
        'notice_days_required', 'notice_days_served',
        'notice_days_unserved', 'notice_settlement_basis', 'notice_per_day_rate',
        'notice_settlement_amount', 'notice_settlement_status', 'notice_payment', 'fnf',
        'blacklisted', 'blacklist_reason',
        'documents_released', 'documents_released_at', 'documents_released_by',
        // The rehire stamps go too: the row is a LIVE case again, so leaving
        // them set would make every "is this person exited?" reader treat the
        // new exit as already spent.
        'rehired_at', 'rehired_by', 'rehire_restart_onboarding', 'rehire_note',
    ];

    /**
     * Wipe a spent (rehired) case so the row can host a brand-new exit.
     *
     * NOTE: the previous case's detail is overwritten — employee_exits carries
     * a UNIQUE index on employee_id, so the two employment spells cannot both
     * live here. Nothing reads a rehired case (the SPA only reads `rehired_at`
     * to know the person is back), so the loss is the historical detail of an
     * exit that was undone, not anything the app shows.
     */
    private function resetSpentCase(EmployeeExit $row): void
    {
        if (!$row->exists || !$row->rehired_at) {
            return;
        }
        // These four are NOT NULL on the table, so they reset to their column
        // default rather than to null; everything else in CASE_COLUMNS clears.
        $defaults = [
            'exit_case_status'          => 'Open',
            'current_stage'             => 1,
            'documents_released'        => false,
            'rehire_restart_onboarding' => false,
        ];
        foreach (self::CASE_COLUMNS as $col) {
            $row->{$col} = $defaults[$col] ?? null;
        }
    }

    public function upsert(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        /* Opening a case is an ADD, continuing one is an EDIT — the same split
           the Exit Management list draws between its "Initiate Exit" and
           "Continue" buttons, so a grant that hides one of those buttons also
           refuses the matching call. */
        $isNewCase = !EmployeeExit::where('employee_id', $employee->id)->exists();
        $this->guardSameTenant($request, $employee, $isNewCase ? 'can_add' : 'can_edit');
        $this->guardNotSelf($request, $employee);
        $data = $this->validatePayload($request);

        $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);

        /* An exit cannot be STARTED for a disabled employee — re-enable them
           first. Disabling (HR > Employees toggle) soft-deletes the row and
           kills the login; an exit process needs a live employee to serve
           notice, hand over, clear assets and sign off, so opening a case
           against a switched-off record produces one nobody can complete.
           HR > Employees > Disabled Employees has the Enable toggle.

           Only NEW cases are refused. An exit already in progress carries on
           even if the employee is disabled midway — that pair is legitimate and
           deliberately shows in both the Disabled and Exit In Progress lists. */
        if (!$row->exists && $employee->trashed()) {
            abort(422, 'This employee is disabled, so an exit cannot be started for them. Re-enable them from HR > Employees > Disabled Employees, then run the exit process.');
        }

        /* Re-exiting a rehired employee starts a CLEAN case. Must run before
           anything below reads the row: the locked-type, locked-F&F and
           already-released guards all exist to protect work done on THIS exit,
           and the previous employment's answers are not that. Left in place
           they froze the new case to the old exit type and its paid F&F. */
        $this->resetSpentCase($row);

        $lockedType     = $this->lockedExitType($row);
        $wasReleased    = (bool) $row->documents_released;
        $storedLwd      = $row->last_working_day;   // captured BEFORE fill()
        $storedCase     = (string) ($row->exit_case_status ?? 'Open');
        /* A PAID Full & Final is frozen — captured before fill() and restored
           after it. Once the money has gone out, the blob is the record of what
           was paid: amend a line or the payment mode afterwards and the stored
           net no longer matches the transfer, with nothing to reconcile them.
           The SPA locks every field on that stage; this is the server-side twin,
           so a stale tab opened before the payment can't post over it. */
        $fnfIsPaid      = $row->exists && $this->isFnfPaid($row);
        $lockedFnf      = $fnfIsPaid ? $row->fnf : null;
        /* The Pay / No-Pay answer is frozen by the same payment. It is what
           priced the notice line inside that settled F&F, so flipping it
           afterwards would restate an amount that has already been transferred
           — and 'no_pay' would zero a figure the employee was actually paid. */
        $lockedChoice   = $fnfIsPaid ? $row->notice_payment_choice : null;
        $row->fill($data);
        if ($fnfIsPaid) {
            $row->fnf                   = $lockedFnf;
            $row->notice_payment_choice = $lockedChoice;
        }

        /* Closing the case is complete()'s job ALONE — that is what stamps the
           terminal employee status, kills the login and disables the employee
           so they show in HR > Employees > Disabled Employees.
           `exit_case_status` is fillable, so a plain Save Draft carrying
           "Closed" could close a case through the side door and skip every one
           of those side effects, leaving a fully "Exited" person sitting in the
           ACTIVE employee list with a working login. An already-closed case
           stays closed; anything else stays Open. */
        $row->exit_case_status = $storedCase === 'Closed' ? 'Closed' : 'Open';
        $this->assertExitTypeUnchanged($lockedType, $row);
        $this->assertLastWorkingDayWithinNotice($row, $employee, $storedLwd);
        $this->stampDocumentRelease($row, $wasReleased, $request);
        $row->employee_id          = $employee->id;
        $row->client_id            = $employee->client_id;
        $row->branch_id            = $employee->branch_id;
        /* Mirror the employee master, don't snapshot it. An open case must name
           the employee's CURRENT reporting manager — reassign them mid-exit and
           the next save picks the new one up. Only falls back to the stored
           value when the master has none, so a case that recorded a manager
           before the employee record was cleared doesn't lose it. See format(),
           which applies the same rule on read. */
        $row->reporting_manager_id = $employee->reporting_manager_id ?? $row->reporting_manager_id;
        /* Never trust a client-sent settlement mode — it follows the exit type,
           and for a Termination also HR's Pay / No-Pay answer. The choice is
           normalised FIRST so a type switch can't leave a stale one behind for
           the mode to read. */
        $this->applyNoticeChoice($row);
        $row->notice_settlement_mode = $this->resolveSettlementMode(
            (string) ($row->exit_type ?? ''),
            $row->notice_payment_choice,
        );
        $this->applyNoticeWaiver($row, $employee);
        $this->applyTerminationBlacklist($row);
        if (!$row->exists) $row->created_by = $request->user()?->id;
        $row->save();

        $row->load(['manager:id,first_name,middle_name,last_name,display_name,emp_code']);
        return response()->json([
            'message' => 'Saved',
            'exit'    => $this->format($row, $employee),
        ]);
    }

    /**
     * Finalise the exit. This is the ONE action that moves an employee into
     * the "Exited" bucket: it persists the final-stage form, locks the case
     * Closed, flips employees.status to the right terminal value, and
     * disables the paired login. No soft-delete — the row stays visible in
     * the Exited tab and is reversible (re-activate the employee).
     */
    public function complete(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');
        $this->guardNotSelf($request, $employee);
        $data = $this->validatePayload($request);

        /* The notice-period settlement has to be closed before the case can be.
           Money owed in either direction (recovered from the employee, or paid
           to them in lieu) is a hard gate — the SPA greys the button, and this
           is the server-side twin so a crafted request can't slip past it. */
        $mode   = $this->resolveSettlementMode(
            (string) ($data['exit_type'] ?? ''),
            /* Falls back to the SAVED choice when the payload omits it, so the
               gate reads the same answer the row will store — a Complete Exit
               posted without the field must not silently re-price the notice. */
            $data['notice_payment_choice']
                ?? EmployeeExit::where('employee_id', $employee->id)->value('notice_payment_choice'),
        );
        $amount = (float) ($data['notice_settlement_amount'] ?? 0);
        $status = (string) ($data['notice_settlement_status'] ?? 'NA');
        /* No notice period applies (probation, or resigned within 15 days of
           joining) → nothing can be owed, so a stale amount left on the payload
           must not gate the completion. applyNoticeWaiver() zeroes what is
           actually stored; this keeps the gate consistent with it. Falls back
           to the saved notice date when the payload omits it, so the gate reads
           the same date the waiver will. */
        $noticeDate = $data['notice_date']
            ?? EmployeeExit::where('employee_id', $employee->id)->value('notice_date');
        if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $noticeDate)) {
            $amount = 0.0;
        }
        if ($mode !== 'served' && $amount > 0 && $status !== 'Settled') {
            abort(422, $mode === 'recover'
                ? 'The notice-period recovery from this employee is not settled yet — record the payment and approve it before completing the exit.'
                : 'The notice-period payment to this employee is not settled yet — disburse the full amount before completing the exit.');
        }

        /* Company advances must be fully reconciled before the case can close:
           an unsettled advance, an unreturned (used-less) balance whose payments
           aren't all approved, or an un-raised (used-more) reimbursement each
           block completion. Self advances are recovered from the F&F itself, so
           they never block. Mirrors the frontend gate. */
        $gateLwd = !empty($data['last_working_day'])
            ? \Carbon\Carbon::parse($data['last_working_day'])->startOfDay()
            : (($stored = EmployeeExit::where('employee_id', $employee->id)->value('last_working_day'))
                ? \Carbon\Carbon::parse($stored)->startOfDay()
                : \Carbon\Carbon::now(self::DISPLAY_TZ)->startOfDay());
        $advCheck = $this->fnfAdvances($employee, $gateLwd);
        if (!($advCheck['all_complete'] ?? true)) {
            $refs = collect($advCheck['items'] ?? [])
                ->filter(fn ($i) => empty($i['complete']))
                ->map(fn ($i) => $i['reference'])
                ->filter()->values()->all();
            abort(422, 'Company advance(s) not fully settled: ' . implode(', ', $refs)
                . '. Settle, return the balance (with each payment approved), or raise the reimbursement before completing the exit.');
        }

        /* An employee who still manages people cannot be deactivated. Completing
           the exit flips their status and disables their login, and every reader
           that walks the org chart — My Team, leave and expense approval chains,
           the permission subordinate check — would then dead-end at a switched-
           off row. HR reassigns the reports first (reassignReports above); this
           is the gate that makes that mandatory rather than advisory.

           Checked LAST of the three gates and outside the transaction, same as
           the others, so the message names the real blocker. */
        $orphans = $this->activeDirectReports($employee);
        if ($orphans->isNotEmpty()) {
            $names = $orphans->take(5)
                ->map(fn ($e) => $e->display_name ?: $e->emp_code)
                ->filter()->implode(', ');
            $more = $orphans->count() > 5 ? ' and ' . ($orphans->count() - 5) . ' more' : '';
            abort(422, $orphans->count() . ' employee(s) still report to this person (' . $names . $more
                . '). Assign them a new reporting manager before completing the termination.');
        }

        $row = DB::transaction(function () use ($request, $data, $employee, $mode) {
            $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
            // Same clean slate as upsert(): a rehired employee's old case must
            // never be the thing this completion writes on top of. The SPA
            // always saves Stage 1 first (which resets it), but a direct call
            // here would otherwise inherit the previous exit's clearances,
            // validation and sign-off and close on work nobody redid.
            $this->resetSpentCase($row);
            $lockedType = $this->lockedExitType($row);
            $storedLwd  = $row->last_working_day;   // captured BEFORE fill()
            // Same freeze as upsert(): completing the exit must not be a way to
            // rewrite an F&F that has already been paid, nor the Pay / No-Pay
            // answer that priced its notice line.
            $fnfIsPaid    = $row->exists && $this->isFnfPaid($row);
            $lockedFnf    = $fnfIsPaid ? $row->fnf : null;
            $lockedChoice = $fnfIsPaid ? $row->notice_payment_choice : null;
            $row->fill($data);
            if ($fnfIsPaid) {
                $row->fnf                   = $lockedFnf;
                $row->notice_payment_choice = $lockedChoice;
            }
            $this->assertExitTypeUnchanged($lockedType, $row);
            $this->assertLastWorkingDayWithinNotice($row, $employee, $storedLwd);
            $row->employee_id          = $employee->id;
            $row->client_id            = $employee->client_id;
            $row->branch_id            = $employee->branch_id;
            /* Last write of the live value: this is the manager the exit closed
               under, and format() stops re-syncing once the case is Closed, so
               what lands here is what the finished record keeps. */
            $row->reporting_manager_id = $employee->reporting_manager_id ?? $row->reporting_manager_id;
            $this->applyNoticeChoice($row);
            $row->notice_settlement_mode = $mode;
            $this->applyNoticeWaiver($row, $employee);
            $this->applyTerminationBlacklist($row);
            if (!$row->exists) $row->created_by = $request->user()?->id;

            // Lock the case closed regardless of what the client sent.
            $row->exit_case_status = 'Closed';
            $row->current_stage    = 4;
            $row->completed_at     = now();
            $row->save();

            // Map exit type → terminal employees.status so the list buckets
            // the person as Exited and the login gate (EnsureUserActive) trips.
            $employee->status = $this->resolveFinalStatus((string) ($row->exit_type ?? ''));
            $employee->save();

            // Disable the paired login + revoke tokens. Without revoking, an
            // already-issued token keeps authenticating — no middleware
            // re-checks users.status on subsequent requests.
            if ($employee->user) {
                // Disable the login AND free its email slot (email_active=false):
                // the person has exited, so their email can be reused for a new
                // registration. Reset to true if they are ever rehired.
                $employee->user->update(['status' => 'inactive', 'email_active' => false]);
                $employee->user->tokens()->delete();
            }

            /* Completing an exit also DISABLES the employee, so they appear in
               HR > Employees > Disabled Employees alongside the Exited tab.
               This used to be deliberately skipped ("minus the soft-delete"),
               which left a fully-exited person sitting in the ACTIVE employee
               list — their login was dead but every picker and list still
               offered them as live staff.

               Soft-delete is how "disabled" is expressed everywhere else
               (EmployeeController::destroy, which the HR toggle calls), so
               using the same mechanism means the Disabled tab, the enable
               toggle and rehire() all just work — rehire() already restores a
               trashed row, so the two halves were always meant to pair up.

               Guarded: an exit re-completed after a rehire must not fail on an
               already-trashed row. */
            if (!$employee->trashed()) {
                $employee->delete();
            }

            return $row;
        });

        // Farewell email — sent AFTER the transaction commits so a mail failure
        // can never roll back a completed exit. Goes to the employee's PERSONAL
        // email (the contact email captured on the Add Employee form).
        $this->sendFarewellEmail($employee, $row);

        $row->load(['manager:id,first_name,middle_name,last_name,display_name,emp_code']);
        return response()->json([
            'message' => 'Exit completed — employee marked as exited and login disabled.',
            'exit'    => $this->format($row, $employee->fresh()),
        ]);
    }

    /**
     * Who still reports to this employee, and who could take them on.
     *
     * Drives the Reporting Manager Dependency step on the closure stage. Returns
     * the affected employees plus the pool of eligible replacements, so the SPA
     * never has to guess which managers the server will accept.
     */
    public function directReports(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee);

        $reports = $this->activeDirectReports($employee);

        /* Replacement pool — active employees of the same client, minus the
           person being exited. Deliberately NOT filtered by branch: an HOD's
           reports may need to move to a manager in another branch when the
           branch has no one senior left, and blocking that would deadlock the
           termination with no way out from this screen. */
        $exiting = $this->employeeIdsExiting($employee->client_id);

        $pool = Employee::query()
            ->where('client_id', $employee->client_id)
            ->whereNotIn('status', self::EXITED_STATUSES)
            ->where('id', '!=', $employee->id)
            /* No designation, no candidacy.
             *
             * PositionHierarchy::eligible() is lenient by design — an unknown
             * rank passes, so a custom job title never blocks a legitimate
             * save. But a MISSING designation is indistinguishable from an
             * unrecognised one, so an employee with the field left blank
             * qualified as a manager for everyone, Interns included. That is
             * how the PayrollTestSeeder's PT-* fixtures ended up offered as
             * reporting managers.
             *
             * Seniority is the whole point of this screen, and it cannot be
             * judged without a designation — so those rows are not offered
             * here. This is deliberately NARROWER than the employee master,
             * which still allows them: fix the designation there and the
             * person appears here on the next open. */
            ->whereNotNull('designation_id')
            ->with(['department:id,name', 'designation:id,name'])
            ->orderBy('display_name')
            ->get()
            ->map(fn ($e) => [
                'id'          => $e->id,
                'name'        => $e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')),
                'emp_code'    => $e->emp_code,
                'department'  => $e->department?->name,
                'designation' => $e->designation?->name,
                // Lower = more senior. The SPA uses this to grey out picks the
                // server would reject anyway (PositionHierarchy).
                'rank'        => \App\Support\PositionHierarchy::rankForDesignationName($e->designation?->name),
                /* Still Active, but their own exit is already open. Sent so the
                   SPA can show them greyed WITH a reason rather than silently
                   omitting them — "why isn't X in the list?" is a support call.
                   Rejected server-side too. */
                'exiting'     => in_array((int) $e->id, $exiting, true),
            ])
            ->values();

        /* Tenant login users — Branch User / Client Admin — as the fallback when
         * the employee hierarchy runs out.
         *
         * PositionHierarchy puts them at TOP_RANK, above every designation, so
         * they are eligible for anyone. That matters here because seniority can
         * genuinely dead-end: a Team Leader may only report to an HOD, and if
         * every HOD is themselves exiting there is no employee left to take
         * them — the exit would be unblockable with no way out of the screen.
         * The org chart already models this (employees.reporting_manager_user_id
         * is how the employee master stores an admin manager), so this uses the
         * same column rather than inventing anything.
         */
        /* Scoped to the BRANCHES THE REPORTS ARE IN, not just the client.
           Unscoped, every branch user of the tenant was offered — so a branch-2
           admin could be made the manager of a branch-3 employee, which is a
           cross-branch assignment nothing else in the app allows. Client-level
           users (branch_id NULL) stay eligible everywhere, same rule the
           employee master's manager picker uses. */
        $reportBranchIds = $reports->pluck('branch_id')->filter()->unique()->values()->all();
        if ($employee->branch_id) $reportBranchIds[] = (int) $employee->branch_id;
        $reportBranchIds = array_values(array_unique($reportBranchIds));

        $loginUsers = \App\Models\User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user'])
            ->where('status', 'active')
            ->when($employee->client_id, fn ($q) => $q->where('client_id', $employee->client_id))
            ->when($reportBranchIds !== [], fn ($q) => $q->where(
                fn ($w) => $w->whereNull('branch_id')->orWhereIn('branch_id', $reportBranchIds)
            ))
            ->orderBy('name')
            ->get(['id', 'name', 'user_type', 'designation'])
            ->map(fn ($u) => [
                'id'          => $u->id,
                // Flags this as a USER id, not an employee id — the two id
                // spaces overlap, so the client must send the kind back.
                'kind'        => 'user',
                'name'        => $u->name,
                'emp_code'    => null,
                'department'  => null,
                'designation' => $u->designation ?: ucfirst(str_replace('_', ' ', $u->user_type)),
                'rank'        => \App\Support\PositionHierarchy::TOP_RANK,
                'exiting'     => false,
            ])
            ->values();

        return response()->json([
            'employee_id' => $employee->id,
            'login_users' => $loginUsers,
            'reports'     => $reports->map(fn ($e) => [
                'id'          => $e->id,
                'name'        => $e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')),
                'emp_code'    => $e->emp_code,
                'department'  => $e->department?->name,
                'designation' => $e->designation?->name,
                'rank'        => \App\Support\PositionHierarchy::rankForDesignationName($e->designation?->name),
            ])->values(),
            'managers'    => $pool,
        ]);
    }

    /**
     * Move direct reports onto a new reporting manager.
     *
     * Accepts one assignment per employee, so the SPA can do a bulk "everyone to
     * this manager" or individual picks with the same call. Every assignment is
     * re-validated here: the SPA greys out ineligible options, but the rules
     * that matter (tenant scope, seniority, self-reference, not the person being
     * exited) are enforced on this side too.
     *
     * All-or-nothing — a partial reassignment would leave the org chart in a
     * state neither the operator nor the closure gate can reason about.
     */
    public function reassignReports(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');

        /* A manager is EITHER an employee or a tenant login user (Branch User /
           admin) — the same either/or the employee master models with its two
           columns. Exactly one must be sent. */
        $data = $request->validate([
            'assignments'                             => 'required|array|min:1',
            'assignments.*.employee_id'               => 'required|integer|exists:employees,id',
            'assignments.*.reporting_manager_id'      => 'nullable|integer|exists:employees,id',
            'assignments.*.reporting_manager_user_id' => 'nullable|integer|exists:users,id',
        ]);

        // Only people who ACTUALLY report to the exiting employee may be moved
        // through this endpoint — it is not a general-purpose manager editor.
        $reportIds = $this->activeDirectReports($employee)->pluck('id')->all();

        DB::transaction(function () use ($data, $employee, $reportIds) {
            foreach ($data['assignments'] as $a) {
                $reportId    = (int) $a['employee_id'];
                $managerId   = (int) ($a['reporting_manager_id'] ?? 0);
                $managerUser = (int) ($a['reporting_manager_user_id'] ?? 0);

                if (!in_array($reportId, $reportIds, true)) {
                    abort(422, 'One of the selected employees does not report to the employee being exited.');
                }
                if (($managerId > 0) === ($managerUser > 0)) {
                    abort(422, 'Choose exactly one new reporting manager — either an employee or a login user.');
                }

                /* LOGIN-USER MANAGER (Branch User / admin). PositionHierarchy
                   puts them at TOP_RANK, above every designation, so there is no
                   seniority test to run — they outrank everyone by definition.
                   This is the escape hatch for a hierarchy dead-end: a Team
                   Leader whose only possible managers (the HODs) are all exiting
                   would otherwise have nowhere to go and the exit could never be
                   completed. Cycles are impossible too — a login user is not an
                   employee, so the chain simply ends there. */
                if ($managerUser > 0) {
                    $u = \App\Models\User::find($managerUser);
                    if (!$u
                        || !in_array($u->user_type, ['client_admin', 'client_user', 'branch_user'], true)
                        || (string) $u->status !== 'active'
                        || ($employee->client_id && (int) $u->client_id !== (int) $employee->client_id)) {
                        abort(422, 'The selected login user is not an active manager for this client.');
                    }
                    $report = Employee::findOrFail($reportId);
                    /* Branch-bound login users only manage their own branch —
                       the server-side twin of the pool's branch filter. A NULL
                       branch means a client-level user (Director / CEO), who is
                       above branches and eligible everywhere. */
                    if ($u->branch_id !== null && $report->branch_id !== null
                        && (int) $u->branch_id !== (int) $report->branch_id) {
                        abort(422, "{$u->name} belongs to a different branch and cannot manage "
                            . ($report->display_name ?: $report->emp_code) . '.');
                    }
                    $report->reporting_manager_user_id = $managerUser;
                    // The two columns are alternatives — clear the employee side
                    // so the employee doesn't report to two different people
                    // depending on which reader looks.
                    $report->reporting_manager_id = null;
                    $report->save();
                    continue;
                }

                if ($managerId === $employee->id) {
                    abort(422, 'The employee being exited cannot be chosen as the new reporting manager.');
                }
                if ($managerId === $reportId) {
                    abort(422, 'An employee cannot be their own reporting manager.');
                }

                $report  = Employee::findOrFail($reportId);
                $manager = Employee::findOrFail($managerId);

                // Same tenant. Never trust an id from the body to belong to us.
                if ((int) $manager->client_id !== (int) $employee->client_id) {
                    abort(422, 'The selected reporting manager belongs to another client.');
                }
                if (in_array((string) $manager->status, self::EXITED_STATUSES, true) || $manager->trashed()) {
                    abort(422, 'The selected reporting manager is not an active employee.');
                }

                /* Server-side twin of the pool's whereNotNull('designation_id').
                   Without a designation there is no rank, and eligible() waves
                   an unknown rank through — so this is the check that actually
                   stops a designation-less employee being made someone's
                   manager through a direct call. */
                if ($manager->designation_id === null) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} has no designation set, so their position in the hierarchy cannot be verified. Set their designation on the employee record first.");
                }

                // Seniority — the same rule the employee master enforces.
                $reportRank  = \App\Support\PositionHierarchy::rankForDesignationName($report->designation?->name);
                $managerRank = \App\Support\PositionHierarchy::rankForDesignationName($manager->designation?->name);
                if (!\App\Support\PositionHierarchy::eligible($reportRank, $managerRank)) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} cannot manage " . ($report->display_name ?: $report->emp_code)
                        . ' — a reporting manager must hold a higher position in the hierarchy.');
                }

                /* Their own exit is already open. Still Active (the status only
                   flips at completion), so the status check above lets them
                   through — but moving reports onto someone who is leaving just
                   relocates this same blocker onto their case. */
                if (in_array($managerId, $this->employeeIdsExiting($employee->client_id), true)) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} has an exit in progress and cannot take on reporting responsibilities.");
                }

                /* Cycle guard. eligible() passes any pairing where either
                   designation is outside the seeded rank map, so two unranked
                   employees can be pointed at each other — and A → B → A hangs
                   every reader that walks the chart. Nothing else in the app
                   checks this, including the employee master. */
                if ($this->wouldCycle($reportId, $managerId)) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} already reports to " . ($report->display_name ?: $report->emp_code)
                        . ' (directly or through their chain) — this would create a reporting loop.');
                }

                $report->reporting_manager_id = $managerId;
                /* Clear the login-user manager in the same breath. The two
                   columns are alternatives, and leaving a stale user-side
                   manager behind would have the employee reporting to two
                   different people depending on which reader looked. */
                $report->reporting_manager_user_id = null;
                $report->save();
            }
        });

        $remaining = $this->activeDirectReports($employee);

        return response()->json([
            'message'   => count($data['assignments']) === 1
                ? 'Reporting manager updated.'
                : count($data['assignments']) . ' employees reassigned.',
            'remaining' => $remaining->count(),
        ]);
    }

    /**
     * Best-effort "Thank You for Being a Part of Our Journey" farewell email to
     * the exiting employee's personal email. Failures are logged, never thrown.
     */
    private function sendFarewellEmail(Employee $employee, EmployeeExit $row): void
    {
        try {
            $personal = trim((string) ($employee->email ?? ''));
            if ($personal === '') return; // no personal email on file → skip

            $orgName = \App\Models\Client::find($employee->client_id)?->org_name
                ?: config('mail.from.name', 'Our Company');

            $lwd = $row->last_working_day ? $row->last_working_day->format('jS M Y') : '';
            $name = $employee->display_name
                ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? ''));

            Mail::to($personal)->send(new ExitFarewellMail([
                'org_name'         => $orgName,
                'employee_name'    => $name ?: 'Employee',
                'last_working_day' => $lwd,
                'hr_email'         => config('mail.from.address', 'hr@company.com'),
                'hr_phone'         => '',
                'gender'           => (string) ($employee->gender ?? ''),
            ]));
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning(
                'Exit farewell email failed: ' . $e->getMessage(),
                ['employee_id' => $employee->id],
            );
        }
    }

    /**
     * Upload the Full & Final settlement document (signed F&F sheet, payment
     * advice, bank proof). Mandatory before the settlement can be marked paid —
     * an F&F closed with no paperwork is exactly the thing an audit asks for.
     *
     *   POST /api/employees/{employee}/exit/fnf-attachment   (multipart)
     */
    public function uploadFnfAttachment(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');
        $this->guardNotSelf($request, $employee);

        /* Sealed once the settlement is paid. This document is what finance
         * approved and paid AGAINST, so replacing it afterwards would leave the
         * payment record pointing at paperwork nobody signed off. The UI locks
         * the picker, but the endpoint has to refuse on its own — a stale tab
         * left open before the payment would otherwise still post here. */
        $paidRow = EmployeeExit::where('employee_id', $employee->id)->first();
        if ($paidRow && $this->isFnfPaid($paidRow)) {
            return response()->json([
                'message' => 'This Full & Final has already been paid — its document can no longer be replaced.',
                'errors'  => ['attachment' => ['The settlement is already paid.']],
            ], 422);
        }

        /* PDF or image only. The F&F attachment is the SIGNED sheet / payment
         * advice — a piece of evidence, not a working document. A spreadsheet
         * or Word file is editable after the fact, which is exactly what an
         * audit trail must not be, so doc/docx/xls/xlsx are refused here.
         *
         * `mimes` validates the file's real type (guessed from its contents),
         * not the filename, so an .xlsx renamed to .pdf is still rejected. */
        $request->validate([
            'attachment' => ['required', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:10240'],
        ], [
            'attachment.required' => 'Select the Full & Final document to upload.',
            'attachment.mimes'    => 'Only PDF, JPG or PNG files are accepted for the Full & Final document.',
        ]);

        $file = $request->file('attachment');
        $path = $file->store('exit-fnf/' . $employee->id, 'public');

        $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
        // A spent (rehired) case is cleared first, so the merge below can't
        // fold this upload into the PREVIOUS employment's F&F blob.
        $this->resetSpentCase($row);
        $row->employee_id = $employee->id;
        $row->client_id   = $row->client_id ?: $employee->client_id;
        $row->branch_id   = $row->branch_id ?: $employee->branch_id;
        // Merge into the wizard-owned fnf blob rather than replacing it, so an
        // upload never wipes the lines/meta HR has already entered.
        $fnf = is_array($row->fnf) ? $row->fnf : [];
        $fnf['attachment'] = [
            'path' => $path,
            'name' => $file->getClientOriginalName(),
            /* file_url(), not Storage::url() — the same resolver every other
               document endpoint uses. Storage::url() THROWS "This driver does
               not support retrieving URLs" whenever the public disk resolves to
               Azure with AZURE_STORAGE_URL unset (or a config cache left over
               from a previous deploy), which turned a successful upload into a
               500 on the server. file_url() catches that and falls back to a
               constructed URL, and also normalises backslashes, leading
               slashes and a duplicated "storage/" prefix. */
            'url'  => file_url($path),
            'uploaded_at' => now()->toIso8601String(),
        ];
        $row->fnf = $fnf;
        $row->save();

        return response()->json([
            'message'    => 'Full & Final document uploaded.',
            'attachment' => $fnf['attachment'],
        ]);
    }

    /**
     * Rehire an exited employee — bring them back as active staff.
     *
     *   POST /api/employees/{employee}/rehire
     *   { "restart_onboarding": bool, "note": string|null }
     *
     * Only a STANDARD RESIGNATION can be rehired here. Someone who walked out
     * without serving notice, or who was terminated, is not re-activated with
     * one click: that decision needs a fresh hiring process, and a blacklisted
     * leaver must not come back at all. The SPA greys the button for those
     * cases; this is the server-side twin so a direct call can't bypass it.
     *
     * The exit row is kept and stamped `rehired_at` rather than deleted — the
     * exit is history worth having, and every "is this person exited?" reader
     * treats a stamped row as spent.
     *
     * `restart_onboarding` sends them back through onboarding so HR can refresh
     * bank details, address and documents; otherwise the login is simply
     * switched back on with the record as it stood.
     */
    public function rehire(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');
        $this->guardNotSelf($request, $employee);

        $data = $request->validate([
            'restart_onboarding' => 'nullable|boolean',
            'note'               => 'nullable|string|max:500',
        ]);

        $exit = EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->orderByDesc('id')
            ->first();

        abort_if(!$exit, 422, 'This employee has no exit on record to rehire from.');

        if ($why = self::rehireBlockedReason($exit, $employee)) {
            abort(422, $why);
        }

        $restart = (bool) ($data['restart_onboarding'] ?? false);

        DB::transaction(function () use ($employee, $exit, $request, $restart, $data) {
            // Undo the exit's deactivation: status back to Active, and restore
            // the row if disabling it had soft-deleted it.
            if ($employee->trashed()) {
                $employee->restore();
            }
            $employee->status = 'Active';
            if ($restart) {
                // Back to the start of onboarding so the wizard reopens and HR
                // can correct anything. Below the >= 6 gate that payroll, the
                // manager picker and Exit Management all use for "fully
                // onboarded", so they're held out until it's finished again.
                $employee->onboarding_stage_completed = 0;
            }
            $employee->save();

            // Switch the paired login back on and re-claim its email slot
            // (email_active=true) — the person is active again. Tokens were
            // revoked at exit, so they sign in fresh. But if their freed email was
            // meanwhile taken by another ACTIVE account in the same org, re-claiming
            // it would collide (unique per client) — fail with a clear message
            // instead of a raw DB error.
            if ($employee->user) {
                $u = $employee->user;
                $clash = \App\Models\User::where('id', '!=', $u->id)
                    ->whereNull('deleted_at')
                    ->where('email_active', true)
                    ->whereRaw('LOWER(email) = ?', [mb_strtolower((string) $u->email)])
                    ->where(fn ($q) => $u->client_id === null
                        ? $q->whereNull('client_id')
                        : $q->where('client_id', $u->client_id))
                    ->exists();
                abort_if($clash, 409, 'This email is now used by another active employee — update this person’s email before rehiring.');
                $u->update(['status' => 'active', 'email_active' => true]);
            }

            $exit->rehired_at = now();
            $exit->rehired_by = $request->user()?->id;
            $exit->rehire_restart_onboarding = $restart;
            $exit->rehire_note = $data['note'] ?? null;
            $exit->save();
        });

        return response()->json([
            'message' => $restart
                ? 'Employee reactivated — onboarding has been reopened so their details can be updated.'
                : 'Employee reactivated and now shows in the active employee list.',
            'employee' => [
                'id'     => $employee->id,
                'status' => $employee->fresh()->status,
                'restart_onboarding' => $restart,
            ],
        ]);
    }

    /**
     * Everything owed to, or recoverable from, this employee at exit — the
     * inputs to the Full & Final settlement, pulled from the modules that
     * actually hold them instead of being retyped by HR.
     *
     *   GET /api/employees/{employee}/exit/fnf-summary
     *
     * A leaver is dropped from the regular payroll run for their exit month
     * (PayrollService::eligibleEmployees excludes anyone whose last working day
     * falls in the cycle), so the salary they earned up to that day is one of
     * the lines here — otherwise it would never be paid at all.
     *
     * Read-only. Nothing is written; the exit stage decides what to carry over.
     */
    public function fnfSummary(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee);

        $exit = EmployeeExit::where('employee_id', $employee->id)->first();
        $lwd  = $exit?->last_working_day
            ? \Carbon\Carbon::parse($exit->last_working_day)->startOfDay()
            : \Carbon\Carbon::now(self::DISPLAY_TZ)->startOfDay();

        return response()->json(['data' => [
            'last_working_day' => $lwd->toDateString(),
            // notice_date is the RESIGNATION date — the early-exit waiver is
            // keyed on it (the last working day is derived from whether a
            // notice period applies, so keying on that would be circular).
            'payroll'          => $this->fnfEarnedSalary($employee, $lwd, $exit?->notice_date),
            'advances'         => $this->fnfAdvances($employee, $lwd),
            'claims'           => $this->fnfClaims($employee),
        ]]);
    }

    /**
     * Salary earned in the exit month, up to and including the last working
     * day — delegated to the payroll engine.
     *
     * This used to pro-rate annual_salary ÷ 12 across CALENDAR days here,
     * which ignored the employee's salary structure, their attendance, loss of
     * pay, overtime and every allowance — and returned ₹0 outright for anyone
     * paid through a salary structure with no annual_salary set. The F&F now
     * settles exactly what payroll would have paid for that month — including
     * paying NOTHING for an early exit, which payroll also skips entirely.
     */
    private function fnfEarnedSalary(Employee $employee, \Carbon\Carbon $lwd, $resignationDate = null): array
    {
        return app(\App\Services\PayrollService::class)
            ->earnedSalaryForExitMonth($employee, $lwd, $resignationDate);
    }

    /**
     * Outstanding salary/travel advances — money the company is still owed.
     *
     * Recovered-to-date is derived from the SAME schedule payroll recovers on
     * (PayrollService::advanceRecovery): EMI advances recover one instalment
     * per month from recovery_start; lumpsum recovers fully in its start month.
     * Anything the schedule hasn't reached by the last working day is still
     * outstanding and has to come out of the F&F.
     */
    private function fnfAdvances(Employee $employee, \Carbon\Carbon $lwd): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('advance_requests')) {
            return ['total' => 0.0, 'items' => [], 'all_complete' => true, 'incomplete_count' => 0];
        }

        // NB: advance_requests / expense_claims are hard-delete tables — no
        // deleted_at column, so don't filter on one.
        $rows = DB::table('advance_requests')
            ->where('employee_id', $employee->id)
            ->whereRaw('LOWER(hr_status) = ?', ['approved'])
            ->get(['id', 'advance_no', 'advance_type', 'amount', 'used_for',
                   'recovery_start', 'recovery_mode', 'recovery_months', 'monthly_emi',
                   'recovery_direct_payments',
                   'employee_settled_at', 'settle_type', 'settle_balance',
                   'settle_approval_status', 'settle_returned_at', 'settle_return_scheduled_at',
                   'settle_return_payments', 'settle_reimbursement_claim_id']);

        $hasReturnLedger = \Illuminate\Support\Facades\Schema::hasTable('advance_recovery_ledger');
        $items = [];
        $total = 0.0;         // money the employee still owes → recovered in the F&F
        $incomplete = 0;      // company advances not fully reconciled → block close

        foreach ($rows as $r) {
            $amount = (float) $r->amount;
            if ($amount <= 0) continue;
            $usedFor = strtolower((string) ($r->used_for ?? 'self'));

            // ── SELF advance — recovered from salary on the EMI/lumpsum schedule.
            //    Whatever the schedule hasn't reached by the LWD is recovered from
            //    the F&F. Always resolvable at F&F time, so never blocking.
            if ($usedFor !== 'company') {
                $recovered = 0.0;
                // One-time DIRECT pay-offs the employee already made from their
                // profile (not payroll) — count them so the F&F doesn't re-recover
                // money that's already been paid back.
                $directPaid = round(array_sum(array_map(
                    fn ($p) => (float) ($p['amount'] ?? 0),
                    json_decode((string) ($r->recovery_direct_payments ?? '[]'), true) ?: []
                )), 2);
                if ($r->recovery_start) {
                    $start = \Carbon\Carbon::parse($r->recovery_start)->startOfDay();
                    if ($start->lte($lwd)) {
                        if ($r->recovery_mode === 'emi') {
                            $emi     = (float) ($r->monthly_emi ?: round($amount / max(1, (int) ($r->recovery_months ?: 1)), 2));
                            $elapsed = $start->copy()->startOfMonth()->diffInMonths($lwd->copy()->startOfMonth()) + 1;
                            $elapsed = min($elapsed, max(1, (int) ($r->recovery_months ?: 1)));
                            $recovered = min($amount, round($emi * $elapsed, 2));
                        } else {
                            $recovered = $amount;
                        }
                    }
                }
                // Payroll-schedule recovery + one-time direct pay-offs, capped at
                // the advance amount.
                $recovered   = round(min($amount, $recovered + $directPaid), 2);
                $outstanding = round($amount - $recovered, 2);
                if ($outstanding <= 0.005) continue;   // fully recovered — nothing to do
                $total += $outstanding;
                $items[] = [
                    'id' => $r->id, 'reference' => $r->advance_no, 'type' => $r->advance_type,
                    'used_for' => 'self', 'amount' => round($amount, 2),
                    'recovered' => round($recovered, 2), 'outstanding' => $outstanding,
                    'settle_state' => 'self_recover', 'complete' => true,
                    'note' => $directPaid > 0.005
                        ? 'Balance after direct pay-off recovered from the final settlement.'
                        : 'Recover the outstanding balance from the final settlement.',
                ];
                continue;
            }

            // ── COMPANY advance — reconciled through the SETTLEMENT flow, NOT
            //    recovered from salary. What the F&F does depends on how it settled.
            $settled = (bool) $r->employee_settled_at && ($r->settle_approval_status === 'approved');
            $balance = round((float) $r->settle_balance, 2);

            // Not settled (or settlement not approved) → the spend is unknown, so
            // there is nothing to auto-recover, but the exit CANNOT be closed until
            // it is settled. Flag it as blocking.
            if (!$settled) {
                $incomplete++;
                $items[] = [
                    'id' => $r->id, 'reference' => $r->advance_no, 'type' => $r->advance_type,
                    'used_for' => 'company', 'amount' => round($amount, 2),
                    'recovered' => 0.0, 'outstanding' => 0.0,
                    'settle_state' => 'not_settled', 'complete' => false,
                    'note' => 'Company advance not settled/approved yet — settle it before closing the exit.',
                ];
                continue;
            }

            $type = (string) ($r->settle_type ?? 'equal');

            if ($type === 'return') {
                // Used LESS → employee owes the unspent balance back. Count what is
                // already returned: APPROVED direct payments + payroll recovery.
                $pays = json_decode((string) ($r->settle_return_payments ?? '[]'), true) ?: [];
                $approvedDirect = 0.0;
                foreach ($pays as $p) {
                    if (($p['status'] ?? 'approved') === 'approved') $approvedDirect += (float) ($p['amount'] ?? 0);
                }
                $payrollReturned = $hasReturnLedger
                    ? (float) DB::table('advance_recovery_ledger')
                        ->where('advance_request_id', $r->id)->where('stream', 'return')->sum('amount')
                    : 0.0;
                $returned    = round(min($balance, $approvedDirect + $payrollReturned), 2);
                $outstanding = round(max(0, $balance - $returned), 2);
                $complete    = (bool) $r->settle_returned_at || $outstanding <= 0.005;
                if (!$complete) $incomplete++;
                if ($outstanding > 0.005) $total += $outstanding;
                $items[] = [
                    'id' => $r->id, 'reference' => $r->advance_no, 'type' => $r->advance_type,
                    'used_for' => 'company', 'amount' => round($amount, 2),
                    'recovered' => $returned, 'outstanding' => $outstanding,
                    'settle_state' => $complete ? 'return_complete' : 'return_pending', 'complete' => $complete,
                    'note' => $complete
                        ? 'Unspent balance returned in full.'
                        : 'Employee still owes the unreturned balance — recover it in the F&F (or wait for approval of pending payments).',
                ];
                continue;
            }

            if ($type === 'reimburse') {
                // Used MORE → the company owes the EMPLOYEE the excess. That is paid
                // via an expense claim (owed TO the employee), so it belongs in the
                // claims section — not a recovery here. Complete once it was raised.
                $raised = (bool) $r->settle_reimbursement_claim_id;
                if (!$raised) $incomplete++;
                $items[] = [
                    'id' => $r->id, 'reference' => $r->advance_no, 'type' => $r->advance_type,
                    'used_for' => 'company', 'amount' => round($amount, 2),
                    'recovered' => round($amount, 2), 'outstanding' => 0.0,
                    'settle_state' => $raised ? 'reimburse_raised' : 'reimburse_pending', 'complete' => $raised,
                    'note' => $raised
                        ? 'Over-spend reimbursement raised — paid to the employee via the claims section.'
                        : 'Over-spend not yet raised as a reimbursement claim — raise it before closing the exit.',
                ];
                continue;
            }

            // Settled 'equal' — spend equals the advance, nothing owed either way.
            $items[] = [
                'id' => $r->id, 'reference' => $r->advance_no, 'type' => $r->advance_type,
                'used_for' => 'company', 'amount' => round($amount, 2),
                'recovered' => round($amount, 2), 'outstanding' => 0.0,
                'settle_state' => 'settled_equal', 'complete' => true,
                'note' => 'Settled — spend equals the advance.',
            ];
        }

        return [
            'total'            => round($total, 2),
            'items'            => $items,
            'all_complete'     => $incomplete === 0,
            'incomplete_count' => $incomplete,
        ];
    }

    /**
     * Approved expense claims not yet paid out — money owed TO the employee.
     * The sanctioned figure wins over the claimed one (HR may have trimmed it),
     * and anything already disbursed is netted off.
     */
    private function fnfClaims(Employee $employee): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('expense_claims')) {
            return ['total' => 0.0, 'items' => []];
        }

        $rows = DB::table('expense_claims')
            ->where('employee_id', $employee->id)
            ->whereRaw('LOWER(hr_status) = ?', ['approved'])
            ->where(fn ($q) => $q->whereNull('settlement_status')
                                 ->orWhereRaw('LOWER(settlement_status) <> ?', ['paid']))
            ->get(['id', 'claim_no', 'title', 'category_name', 'amount', 'sanctioned_amount', 'total_paid']);

        $items = [];
        $total = 0.0;
        foreach ($rows as $r) {
            $payable = (float) ($r->sanctioned_amount ?? 0) > 0
                ? (float) $r->sanctioned_amount
                : (float) $r->amount;
            $due = round($payable - (float) ($r->total_paid ?? 0), 2);
            if ($due <= 0.005) continue;

            $total += $due;
            $items[] = [
                'id'        => $r->id,
                'reference' => $r->claim_no,
                'title'     => $r->title ?: $r->category_name,
                'amount'    => round($payable, 2),
                'paid'      => round((float) ($r->total_paid ?? 0), 2),
                'due'       => $due,
            ];
        }

        return ['total' => round($total, 2), 'items' => $items];
    }

    /* ── Helpers ───────────────────────────────────────────────────── */

    /**
     * Terminal employees.status for a given exit type. Constrained to the
     * values the employees.status enum actually allows (Active, Inactive,
     * On Leave, Probation, Notice Period, Resigned, Terminated) — there is
     * no 'Retired'/'Exited' value, so Retirement maps to the nearest valid
     * terminal state. Using an out-of-enum value would trip the Postgres
     * CHECK constraint and 500 the whole completion.
     */
    private function resolveFinalStatus(string $exitType): string
    {
        return match ($exitType) {
            'Termination', 'Absconding' => 'Terminated',
            // Resignation / Resignation without notice period / Retirement /
            // End of Contract / Other / blank — all resignations either way.
            default                     => 'Resigned',
        };
    }

    /**
     * How the notice period is settled for a given exit type. This is the
     * single rule the whole feature turns on — the wizard's stage list, the
     * money's direction, and the completion gate all read it:
     *
     *   served      → the notice was worked; nothing is recovered or paid.
     *   recover     → the employee did not serve it and PAYS the unserved days.
     *   pay_in_lieu → the company relieves them and PAYS the unserved days.
     *
     * Legacy types (Retirement / End of Contract / Other) keep the old
     * behaviour of no settlement; Absconding recovers, matching how an
     * unserved notice has always been treated.
     */
    /**
     * The last working day may fall ON the notice period end date, never AFTER
     * it. The notice end (notice start + the employee's notice period, counted
     * in CALENDAR days — the same basis the wizard derives it on) is the last
     * date the employee is on the books; a later last working day would have
     * them working days they are no longer employed for, and it inflated the
     * "days served" figure the notice settlement is priced on.
     *
     * Deliberately NOT enforced in three cases:
     *   · No notice period applies (probation, or a resignation within
     *     EARLY_EXIT_DAYS of joining) — there is no end date to cap against.
     *   · The employee record carries no notice period, so nothing derives.
     *   · The value is UNCHANGED from what is already stored. An approved
     *     UNPAID leave during notice legitimately pushes the last working day
     *     past the notice end (NoticePeriodGuard::applyExtension writes it
     *     directly), and re-saving that case must not be refused for a date the
     *     policy itself set. Mirrors the SPA, which likewise only validates a
     *     date the user has actually touched.
     */
    private function assertLastWorkingDayWithinNotice(EmployeeExit $row, Employee $employee, $storedLwd): void
    {
        $lwd = $row->last_working_day;
        if (!$lwd || !$row->notice_date) {
            return;
        }
        $normalize = fn ($d) => $d ? \Carbon\Carbon::parse($d)->toDateString() : null;
        if ($normalize($lwd) === $normalize($storedLwd)) {
            return;   // untouched — see the extension carve-out above
        }
        if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $row->notice_date)) {
            return;
        }
        $days = $this->noticePeriodDays($employee);
        if ($days <= 0) {
            return;
        }

        // Inclusive of the notice start day: an N-day notice served from the
        // notice date ends on notice date + N − 1 (a 1-day notice ends the day
        // it starts). Same basis as the wizard's Notice Period End Date and as
        // ExitNoticePaymentController's days-served count.
        $end = \Carbon\Carbon::parse($row->notice_date)->startOfDay()->addDays($days - 1);
        if (\Carbon\Carbon::parse($lwd)->startOfDay()->gt($end)) {
            abort(422, 'Last working day cannot be after the notice period end date ('
                . $end->format('j M Y') . '). It may be the same day, or earlier.');
        }
    }

    /**
     * Why this exit cannot be rehired from here — null when it can.
     *
     * ONE rule, used by the server guard in rehire() and mirrored by the SPA's
     * Reactivate button, so what the button offers and what the endpoint
     * accepts can never drift apart:
     *
     *   Blacklisted                     never. Applies whatever the exit type.
     *   Termination                     never — and it is blacklisted by
     *                                   default, so this is belt-and-braces.
     *   Absconding / no type            never; there is nothing to reactivate
     *                                   cleanly from.
     *   Resignation                     yes, unless blacklisted.
     *   Resignation w/o notice period   yes, unless blacklisted — EXCEPT when
     *                                   they left DURING probation. Someone who
     *                                   walked out mid-probation without
     *                                   serving notice has not shown the
     *                                   company anything to reactivate on; that
     *                                   is a fresh hiring decision.
     *
     * Probation is judged as at the exit — the notice date, falling back to the
     * last working day — not as at today, or a probation window that has since
     * elapsed on paper would quietly make a mid-probation walkout rehirable.
     */
    public static function rehireBlockedReason(?EmployeeExit $exit, ?Employee $employee): ?string
    {
        if (!$exit) {
            return 'This employee has no exit on record to rehire from.';
        }
        if (strcasecmp((string) $exit->blacklisted, 'Yes') === 0) {
            return 'This employee is blacklisted and cannot be rehired.';
        }

        $type = trim((string) ($exit->exit_type ?? ''));
        if ($type === '') {
            return 'No exit type on record — rehire is unavailable.';
        }
        if (strcasecmp($type, 'Termination') === 0) {
            return 'A terminated employee cannot be rehired from here — this needs a fresh hiring process.';
        }
        if (strcasecmp($type, 'Absconding') === 0) {
            return 'An employee who absconded cannot be rehired from here — this needs a fresh hiring process.';
        }

        if (strcasecmp($type, 'Resignation without notice period') === 0) {
            $asOf = $exit->notice_date ?: $exit->last_working_day;
            if ($asOf && \App\Support\ProbationGuard::isOnProbation($employee, \Carbon\Carbon::parse($asOf)->startOfDay())) {
                return 'This employee resigned during their probation period without serving notice — rehiring needs a fresh hiring process.';
            }
        }

        return null;
    }

    /**
     * A TERMINATION ALWAYS blacklists the employee.
     *
     * Not "by default" — the answer is forced to Yes and a posted `No` is
     * overwritten. A terminated employee can never be rehired from here
     * (rehire() only accepts a standard resignation), so a case reading
     * "Terminated / Not Blacklisted" claimed a door was open that every rule
     * downstream keeps shut. The exit type decides this, not the operator: the
     * SPA locks the dropdown to Yes and this is the server-side twin, so a
     * direct API call cannot record what the UI won't.
     *
     * An auto-blacklist with no reason typed gets one stating the mechanism, so
     * the record is never a bare "Yes" with no explanation, and HR is not held
     * at the closing gate to retype what the exit type already says.
     */
    private function applyTerminationBlacklist(EmployeeExit $row): void
    {
        if (strcasecmp((string) ($row->exit_type ?? ''), 'Termination') !== 0) {
            return;
        }
        $row->blacklisted = 'Yes';
        if (trim((string) $row->blacklist_reason) === '') {
            $row->blacklist_reason = 'Blacklisted automatically — exit type: Termination.';
        }
    }

    /**
     * The employee's notice period in whole days. `notice_period_days` is often
     * NULL while the human-readable `notice_period` holds "15 Days", so the
     * label is parsed as a fallback — the same rule the SPA and
     * ExitNoticePaymentController::noticeDays() use.
     */
    private function noticePeriodDays(Employee $employee): int
    {
        $n = $employee->notice_period_days;
        if ($n !== null && $n !== '' && is_numeric($n)) {
            return (int) $n;
        }
        return preg_match('/(\d+)/', (string) $employee->notice_period, $m) ? (int) $m[1] : 0;
    }

    /**
     * Notice-period waiver — an employee on probation, or one who RESIGNED
     * within ProbationGuard::EARLY_EXIT_DAYS of joining, serves no notice
     * period at all. With no notice period there are no unserved days, so
     * nothing can be recovered from them and nothing paid to them in lieu.
     *
     * The wizard already collapses these figures to zero; this is the
     * server-side twin, so a stale draft or a crafted payload cannot save a
     * recovery against someone the policy exempts. Applied on every save
     * (not just the first) because the notice date is editable — moving it
     * into or out of the 15-day window has to move the settlement with it.
     */
    private function applyNoticeWaiver(EmployeeExit $row, Employee $employee): void
    {
        if (\App\Support\ProbationGuard::noticePeriodApplies($employee, $row->notice_date)) {
            return;
        }
        $row->notice_days_required     = 0;
        $row->notice_days_served       = 0;
        $row->notice_days_unserved     = 0;
        $row->notice_per_day_rate      = 0;
        $row->notice_settlement_amount = 0;
        $row->notice_settlement_status = 'NA';
    }

    /**
     * Record WHO released the exit documents and WHEN, on the transition only.
     * Toggling it back off clears the stamp, so the pair always describes the
     * current state rather than the last time it happened to be switched on.
     */
    private function stampDocumentRelease(EmployeeExit $row, bool $wasReleased, Request $request): void
    {
        $isReleased = (bool) $row->documents_released;

        /* Exit documents follow the money. The relieving letter and experience
           certificate are only released once the Full & Final settlement has
           actually been PAID — which is why F&F sits before Exit Documents in
           the stage order. The SPA disables the switch; this is the
           server-side twin so a direct call can't do what the UI won't.
           Reopening F&F (back to unpaid) also revokes an existing release.

           "Settled", not "paid": an F&F with nothing in it is never paid, so
           gating on the payment alone held the relieving letter behind a
           disbursement that could never happen. */
        if (!$this->isFnfSettled($row)) {
            $row->documents_released    = false;
            $row->documents_released_at = null;
            $row->documents_released_by = null;
            abort_if($isReleased, 422,
                'Exit documents cannot be released until the Full & Final settlement has been paid.');
            return;
        }

        if ($isReleased === $wasReleased) {
            return;
        }
        $row->documents_released_at = $isReleased ? now() : null;
        $row->documents_released_by = $isReleased ? $request->user()?->id : null;
    }

    /** Has the Full & Final settlement been marked paid? The F&F stage stores
     *  its state as a JSON blob owned by the wizard; the payment status lives
     *  at fnf.meta.payStatus.
     *
     *  The approval + payment-date fallback is what the SPA has always used to
     *  decide `fnfMarkedPaid` on load, and it is the only signal older rows
     *  carry — nothing ever wrote `payStatus`, so reading it alone made this
     *  return false for every case on file, including fully approved and paid
     *  ones. */
    private function isFnfPaid(EmployeeExit $row): bool
    {
        $status = data_get($row->fnf, 'meta.payStatus');
        if (is_string($status) && strcasecmp($status, 'Paid') === 0) {
            return true;
        }
        $approval = data_get($row->fnf, 'meta.approval');
        $payDate  = data_get($row->fnf, 'meta.payDate');

        return is_string($approval) && strcasecmp($approval, 'Approved') === 0
            && is_string($payDate) && trim($payDate) !== '';
    }

    /** Is there NOTHING to settle — every earning and every deduction zero, so
     *  no money moves in either direction? Typically an early exit (resigned
     *  within days of joining): no salary processed, nothing encashed, no
     *  advance or reimbursement outstanding.
     *
     *  Both sides are tested, not the net: earnings and deductions that merely
     *  cancel out also net zero, but there real money is disbursed and
     *  collected, so that case still needs finance approval and a payment
     *  record. The SPA sends `earn` / `ded` alongside `net` for exactly this
     *  distinction; a row saved before they existed simply reports false and
     *  gets them back on its next save from the wizard. */
    private function isFnfEmpty(EmployeeExit $row): bool
    {
        $earn = data_get($row->fnf, 'earn');
        $ded  = data_get($row->fnf, 'ded');

        return is_numeric($earn) && is_numeric($ded)
            && (float) $earn === 0.0 && (float) $ded === 0.0;
    }

    /** Settled = paid, OR there was never anything to pay. Use for anything
     *  DOWNSTREAM of the settlement (exit-document release). The blob/document
     *  LOCKS keep using isFnfPaid(): an empty settlement has no payment to
     *  protect, and freezing it would strand HR if a due surfaced later. */
    private function isFnfSettled(EmployeeExit $row): bool
    {
        return $this->isFnfPaid($row) || $this->isFnfEmpty($row);
    }

    /** The exit type already on file for a saved case, or null for a new one. */
    private function lockedExitType(EmployeeExit $row): ?string
    {
        $existing = trim((string) ($row->exists ? $row->exit_type : ''));
        return $existing !== '' ? $existing : null;
    }

    /**
     * The exit type is IMMUTABLE once the case exists.
     *
     * It decides the stage list, the notice settlement, whether the blacklist
     * question is asked and whether the employee can ever be rehired — so
     * changing it mid-process would strand everything already recorded against
     * the old one (a verified notice recovery, an F&F priced on a pay-in-lieu).
     * The SPA shows it locked; this is the server-side twin so a direct call
     * can't do what the UI won't.
     */
    private function assertExitTypeUnchanged(?string $locked, EmployeeExit $row): void
    {
        if ($locked === null) {
            return;   // first save — anything goes
        }
        $incoming = trim((string) ($row->exit_type ?? ''));
        if ($incoming === '' || $incoming === $locked) {
            $row->exit_type = $locked;   // absent or unchanged → keep it
            return;
        }
        abort(422, "The exit type cannot be changed once the exit has started (this case is a \"{$locked}\"). Cancel this exit and start a new one if the type is wrong.");
    }

    private function resolveSettlementMode(string $exitType, ?string $noticeChoice = null): string
    {
        if ($exitType === 'Resignation without notice period' || $exitType === 'Absconding') {
            return 'recover';
        }
        if ($exitType === 'Termination') {
            /* The ONE type whose settlement is not decided by the type alone.
               A company can terminate with pay in lieu of notice or without it,
               and only HR knows which, so the answer is asked in the Initiate
               Exit picker and stored on the case.

               'no_pay'  → nothing is paid AND nothing is recovered. That is the
                           'served' mode: it settles the notice at zero without
                           opening a recovery stage against someone who was
                           dismissed.
               'pay'     → pay in lieu, as before.
               NULL      → a case opened before the choice existed. Keeps the old
                           behaviour so no recorded termination changes meaning. */
            return $noticeChoice === 'no_pay' ? 'served' : 'pay_in_lieu';
        }
        return 'served';
    }

    /**
     * Apply HR's Pay / No-Pay answer to the row.
     *
     * Two jobs, both about keeping the stored case self-consistent:
     *
     * 1. Only a Termination carries a choice. Anything else stores NULL —
     *    otherwise a case switched from Termination to Resignation keeps a
     *    stale answer that resolveSettlementMode() ignores but every reader
     *    still sees, describing a decision that no longer applies.
     *
     * 2. 'no_pay' zeroes the notice figures. Switching from Pay to No-Pay has
     *    to reset what Pay calculated (FDD §12.1 / TC-20) — left alone, the
     *    stored amount would keep flowing into the F&F total that the SPA has
     *    already stopped showing, and Complete Exit would gate on money nobody
     *    intends to pay. Same fields applyNoticeWaiver() clears, for the same
     *    reason: nothing is owed, so nothing may be left priced.
     */
    private function applyNoticeChoice(EmployeeExit $row): void
    {
        if (strcasecmp((string) ($row->exit_type ?? ''), 'Termination') !== 0) {
            $row->notice_payment_choice = null;
            return;
        }
        if ($row->notice_payment_choice === 'no_pay') {
            $row->notice_days_required     = 0;
            $row->notice_days_served       = 0;
            $row->notice_days_unserved     = 0;
            $row->notice_per_day_rate      = 0;
            $row->notice_settlement_amount = 0;
            $row->notice_settlement_status = 'NA';
        }
    }

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            // The wizard now offers exactly three types, chosen up-front in the
            // "Initiate Exit" picker, because each one resolves to a different
            // notice-period settlement (and therefore a different stage list).
            // The legacy values stay accepted so exits recorded before this
            // change still load and save instead of 422-ing on reopen.
            'exit_type'             => 'nullable|in:Resignation,Resignation without notice period,Termination,Retirement,End of Contract,Absconding,Other',
            'initiated_by'          => 'nullable|in:Employee,HR,Manager',
            // `reason_for_exit` is a free-text field on the form (the HR
            // can describe the reason in their own words), so we don't
            // gate it against a fixed enum. Cap matches the column size
            // on employee_exits.reason_for_exit (varchar(60)).
            'reason_for_exit'       => 'nullable|string|max:60',
            'other_reason'          => 'nullable|string|max:255',
            'notice_date'           => 'nullable|date',
            'last_working_day'      => 'nullable|date|after_or_equal:notice_date',
            'reporting_manager_id'  => 'nullable|integer|exists:employees,id',
            'comments'              => 'nullable|string|max:2000',
            'business_impact'       => 'nullable|in:Low,Medium,High,Critical',
            'replacement_required'  => 'nullable|in:Yes — Immediate,Yes — Within 30 days,Yes — Within 90 days,No',

            // Stage 2 — Clearance & Handover. Free-form JSON shapes the React
            // wizard owns; stored verbatim so reopening restores HR's progress.
            'clearances'            => 'nullable|array',
            'asset_returns'         => 'nullable|array',
            'handover_notes'        => 'nullable|string|max:5000',

            // Exit Documents — HR's decision to release the paperwork. The
            // stamp/actor are set server-side on the transition, never trusted
            // from the client.
            'documents_released'    => 'nullable|boolean',

            // Stage 4 — Final Deactivation & Closure
            'validation'            => 'nullable|array',
            'final_employee_status' => 'nullable|in:Active,Inactive,Exited',
            'profile_lock'          => 'nullable|in:Locked,Unlocked',
            'exit_case_status'      => 'nullable|in:Open,Closed',
            'hr_sign_off'           => 'nullable|in:Pending,Approved,Rejected',
            // Blacklist decision. Only meaningful for an exit that didn't serve
            // its notice or was a termination — the SPA hides the field
            // otherwise and sends null, which reads as "never asked".
            'blacklisted'           => 'nullable|in:Yes,No',
            'blacklist_reason'      => 'nullable|string|max:500',

            // Notice-period settlement. The mode is DERIVED from exit_type (see
            // resolveSettlementMode) — a client-sent value is ignored, so the
            // settlement and the exit type can never disagree.
            //
            // Termination is the one exception: the mode ALSO depends on this
            // answer, which the Initiate Exit picker asks for and only HR can
            // give. Still not free-form — it is one of two values, it is
            // ignored for every other exit type (applyNoticeChoice nulls it),
            // and it is frozen once the F&F has been paid.
            'notice_payment_choice'    => 'nullable|in:pay,no_pay',
            'notice_days_required'     => 'nullable|integer|min:0|max:365',
            'notice_days_served'       => 'nullable|integer|min:0|max:365',
            'notice_days_unserved'     => 'nullable|integer|min:0|max:365',
            'notice_settlement_basis'  => 'nullable|in:gross,basic',
            'notice_per_day_rate'      => 'nullable|numeric|min:0|max:99999999.99',
            'notice_settlement_amount' => 'nullable|numeric|min:0|max:99999999.99',
            'notice_settlement_status' => 'nullable|in:NA,Pending,Settled,Rejected',
            'notice_payment'           => 'nullable|array',

            // Full & Final settlement (Termination) — lines + finance approval.
            'fnf'                   => 'nullable|array',
            /* The blob is otherwise stored verbatim (the React wizard owns its
               shape), but the payment date is money-movement data and gets a
               rule of its own: a settlement cannot be recorded as paid on a day
               that hasn't happened yet. The SPA already caps the picker at today
               and re-checks on submit — this is the server-side twin, so a
               crafted call or a tab left open past midnight can't store one.
               Path matches the payload the wizard builds: fnf.meta.payDate. */
            'fnf.meta.payDate'      => 'nullable|date|before_or_equal:' . \Carbon\Carbon::now(self::DISPLAY_TZ)->toDateString(),

            // Process meta — per-stage status map + current wizard step. The
            // stage list is dynamic (4 base stages, plus a settlement stage for
            // two of the three exit types), so the ceiling is no longer 4.
            'stage_status'          => 'nullable|array',
            'current_stage'         => 'nullable|integer|min:1|max:6',
        ], [
            /* Laravel would otherwise name the dotted path back at the user
               ("The fnf.meta.pay date field must be..."), which means nothing to
               HR. Wording matches the SPA's inline message. */
            'fnf.meta.payDate.before_or_equal' => 'Payment Date cannot be a future date. Please select today or a previous date.',
            'fnf.meta.payDate.date'            => 'Enter a valid payment date.',
        ]);
    }

    /** Same scope rule as EmployeeController. Super admins see everything;
     *  other roles must share the employee's client_id.
     *
     *  @param string $flag Permission column this endpoint needs — 'can_view'
     *         for reads, 'can_add' to open a case, 'can_edit' to change one.
     */
    private function guardSameTenant(Request $request, Employee $employee, string $flag = 'can_view'): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        $this->authorizeExit($user, $flag);
        if ($user->isSuperAdmin()) return;
        if ($employee->client_id && $user->client_id !== $employee->client_id) {
            abort(403, 'Employee belongs to a different organization.');
        }
    }

    /**
     * NOBODY RUNS THEIR OWN EXIT.
     *
     * Exit Management is granted per-user, and the grant is module-wide — an HR
     * executive who can process every colleague's exit can equally open their
     * own case. That is self-dealing on the one process that decides their
     * notice recovery, their Full & Final figures, whether they are
     * blacklisted, and whether they stay eligible for rehire. Someone else with
     * the same access has to run it.
     *
     * Applied to the MUTATING endpoints only (upsert / complete / F&F
     * attachment / rehire). Reads stay open so an employee can still see the
     * state of a case someone else is running for them.
     */
    private function guardNotSelf(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);

        /* employees.user_id is the authoritative link. users.employee_code is
           checked too because a login created before that column was populated
           can still be matched by code — and a user with no employee row at all
           (super admin, client admin, branch admin) matches neither, which is
           correct: they have no own exit to run. */
        $selfByUserId = $employee->user_id !== null && (int) $employee->user_id === (int) $user->id;
        $selfByCode   = filled($user->employee_code) && filled($employee->emp_code)
            && strcasecmp(trim($user->employee_code), trim($employee->emp_code)) === 0;

        $isSelf = $selfByUserId || $selfByCode;

        abort_if($isSelf, 403,
            'You cannot run your own exit process. Ask another user with Exit Management access to process your exit.');
    }

    /**
     * Granular check against the EXIT module (`hr.exit`), per action.
     *
     * This used to demand `can_edit` on hr.employee for every endpoint, which
     * was wrong in both directions once Exit Management became its own module:
     * reading a case required edit rights (so a view-only user couldn't open
     * the page the menu offered them), and the flags an admin actually ticks
     * on the Exit Management row governed nothing. The menu and route guard
     * have keyed off hr.exit all along; the API now agrees with them.
     *
     *   show / fnfSummary            → can_view
     *   upsert on a NEW case         → can_add    (initiating an exit)
     *   upsert on an existing case,
     *   complete / F&F / rehire      → can_edit
     */
    private function authorizeExit($user, string $flag): void
    {
        if ($user->isSuperAdmin()) return;
        $moduleId = Module::where('slug', 'hr.exit')->value('id');
        if (!$moduleId) {
            // First-run: module row not seeded yet. Same fallback the other
            // controllers use — admins pass, everyone else is refused.
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Exit Management module not enabled.');
        }
        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($flag, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$flag} on hr.exit");
    }

    /**
     * Project a (possibly null) exit row into a stable JSON shape.
     *
     * REPORTING MANAGER — the employee master is the source of truth while the
     * case is OPEN. The stored `employee_exits.reporting_manager_id` used to
     * win, which meant the manager was frozen at whatever it was the first time
     * Stage 1 was saved: reassign the employee to a new manager afterwards and
     * the exit went on naming the old one, through clearance and sign-off. HR
     * had no way to correct it from the exit screen either, since the field is
     * read-only there and only the employee record can change it.
     *
     * A CLOSED case keeps its stored value. By then the manager is history —
     * who signed this exit off — not a live pointer, and a later reassignment
     * of some other employee must not rewrite a finished record.
     */
    private function format(?EmployeeExit $row, Employee $employee): array
    {
        $isClosed  = (string) ($row?->exit_case_status ?? 'Open') === 'Closed';
        $managerId = $isClosed
            ? ($row?->reporting_manager_id ?? $employee->reporting_manager_id)
            : ($employee->reporting_manager_id ?? $row?->reporting_manager_id);

        /* Only reuse the eager-loaded relation when it still describes the id
           we resolved above. On an open case whose manager has since changed,
           $row->manager holds the PREVIOUS manager — rendering it would pair
           the new manager's id with the old manager's name. */
        $manager = ($row?->manager && (int) $row->manager->id === (int) $managerId)
            ? $row->manager
            : null;
        if (!$manager && $managerId) {
            // Include soft-deleted managers — the manager record might
            // have been disabled after the employee row was set up.
            $manager = Employee::withTrashed()
                ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code', 'status', 'deleted_at')
                ->find($managerId);
        }

        // Build the manager projection. Prefer the Employee-side manager
        // (reporting_manager_id). Fall back to the login-User manager
        // (reporting_manager_user_id) — the employee wizard stores the manager
        // THERE whenever the chosen manager is a Client/Branch admin who was
        // never onboarded as an Employee row. Without this fallback the Exit
        // form showed "Not set on employee record" for every such employee
        // even though a reporting manager WAS assigned on the employee.
        $managerPayload = null;
        if ($manager) {
            // Disabled = soft-deleted (toggled off in Employee module) OR an
            // exited/inactive status. The exit flow blocks on this so HR fixes
            // the reporting manager on the employee record first.
            $mgrDisabled = $manager->deleted_at !== null
                || in_array((string) $manager->status, ['Resigned', 'Terminated', 'Inactive'], true);
            $managerPayload = [
                'id'           => $manager->id,
                'display_name' => $manager->display_name
                                  ?: trim(($manager->first_name ?? '') . ' ' . ($manager->last_name ?? '')),
                'emp_code'     => $manager->emp_code,
                'disabled'     => $mgrDisabled,
            ];
        } elseif ($employee->reporting_manager_user_id) {
            $employee->loadMissing('reportingManagerUser');
            $u = $employee->reportingManagerUser;
            if ($u) {
                $managerPayload = [
                    'id'           => null,            // not an Employee id
                    'display_name' => $u->name ?: $u->email,
                    'emp_code'     => null,
                ];
            }
        }

        return [
            'id'                    => $row?->id,
            'employee_id'           => $employee->id,
            'exit_type'             => $row?->exit_type,
            'initiated_by'          => $row?->initiated_by,
            'reason_for_exit'       => $row?->reason_for_exit,
            'other_reason'          => $row?->other_reason,
            'notice_date'           => $row?->notice_date?->toDateString(),
            'last_working_day'      => $row?->last_working_day?->toDateString(),
            'reporting_manager_id'  => $managerId,
            'reporting_manager'     => $managerPayload,
            'comments'              => $row?->comments,
            'business_impact'       => $row?->business_impact,
            'replacement_required'  => $row?->replacement_required,

            // Notice-period settlement. `mode` is always re-derived from the
            // stored exit type so a row written before this feature (or under
            // an older mapping) still reports the right settlement on read —
            // and, for a Termination, from HR's Pay / No-Pay answer alongside it.
            'notice_settlement_mode'   => $this->resolveSettlementMode(
                (string) ($row?->exit_type ?? ''),
                $row?->notice_payment_choice,
            ),
            /* NULL on a legacy termination means the question was never asked.
               The SPA reads that as "pay" (matching resolveSettlementMode) so an
               old case renders exactly as it did before this field existed. */
            'notice_payment_choice'    => $row?->notice_payment_choice,
            'notice_days_required'     => $row?->notice_days_required,
            'notice_days_served'       => $row?->notice_days_served,
            'notice_days_unserved'     => $row?->notice_days_unserved,
            'notice_settlement_basis'  => $row?->notice_settlement_basis,
            'notice_per_day_rate'      => $row?->notice_per_day_rate,
            'notice_settlement_amount' => $row?->notice_settlement_amount,
            'notice_settlement_status' => $row?->notice_settlement_status ?? 'NA',
            'notice_payment'           => $row?->notice_payment ?? null,

            // Full & Final settlement (Termination).
            'fnf'                   => $row?->fnf ?? null,

            // Stage 2 — Clearance & Handover
            'clearances'            => $row?->clearances ?? [],
            'asset_returns'         => $row?->asset_returns ?? [],
            'handover_notes'        => $row?->handover_notes,
            'documents_released'    => (bool) ($row?->documents_released ?? false),
            'documents_released_at' => $row?->documents_released_at?->toIso8601String(),

            // Stage 4 — Final Deactivation & Closure
            'validation'            => $row?->validation ?? [],
            'final_employee_status' => $row?->final_employee_status,
            'profile_lock'          => $row?->profile_lock,
            'exit_case_status'      => $row?->exit_case_status ?? 'Open',
            'hr_sign_off'           => $row?->hr_sign_off,
            'blacklisted'           => $row?->blacklisted,
            'blacklist_reason'      => $row?->blacklist_reason,

            // Process meta
            'stage_status'          => $row?->stage_status ?? null,
            'current_stage'         => $row?->current_stage ?? 1,
            'completed_at'          => $row?->completed_at?->toIso8601String(),
            'employee_status'       => $employee->status,
            'updated_at'            => $row?->updated_at?->toIso8601String(),

            /* Monthly BASIC the notice-period settlement is priced on. Resolved
               here rather than on the SPA, which derived it from annual_salary
               alone and so showed ₹0 (and a ₹0 per-day rate, and a ₹0 payable)
               for anyone paid through a salary structure with no annual figure
               set. Sent on the per-employee exit payload, not appended to the
               Employee model, so the employees LIST doesn't take a structure
               lookup per row. */
            'monthly_basic'         => $this->resolveMonthlyBasic($employee),
        ];
    }

    /**
     * Monthly basic for the exit settlement, using the SAME precedence as
     * PayrollService::resolveCompensation() so the exit and a payroll run price
     * a day off the same figure:
     *   1. the employee's in-force salary structure (its own basic component)
     *   2. annual_salary ÷ 12 × 50%  (the engine's fallback split)
     *   3. 0 — nothing on file; HR types the figure in, as before.
     *
     * The structure lookup mirrors PayrollService::structureFor(): statuses are
     * stored LOWER-case and 'superseded' still counts (a newer draft must not
     * hide the version actually in force), ordered by effective date then
     * version. Matching that query is the whole point — a different one here
     * would quietly price the exit off a different structure than payroll used.
     */
    private function resolveMonthlyBasic(Employee $employee): float
    {
        $structure = \App\Models\SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->whereDate('effective_from', '<=', \Carbon\Carbon::now(self::DISPLAY_TZ))
            ->orderByDesc('effective_from')
            ->orderByDesc('version')
            ->first();
        if ($structure) {
            $basic = (float) $structure->basicAmount();
            if ($basic > 0) return round($basic, 2);
            // A structure with no explicit basic component still carries a
            // gross; fall back to the engine's 50% split of it rather than to 0.
            $gross = (float) $structure->monthly_gross;
            if ($gross > 0) return round($gross * 0.5, 2);
        }

        $annual = (float) ($employee->annual_salary ?? 0);
        return $annual > 0 ? round(($annual / 12) * 0.5, 2) : 0.0;
    }
}
