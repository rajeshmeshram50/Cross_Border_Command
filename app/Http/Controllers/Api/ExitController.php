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
        return response()->json($this->format($row, $employee));
    }

    public function upsert(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee);
        $data = $this->validatePayload($request);

        $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
        $lockedType = $this->lockedExitType($row);
        $row->fill($data);
        $this->assertExitTypeUnchanged($lockedType, $row);
        $row->employee_id          = $employee->id;
        $row->client_id            = $employee->client_id;
        $row->branch_id            = $employee->branch_id;
        $row->reporting_manager_id = $row->reporting_manager_id ?? $employee->reporting_manager_id;
        // Never trust a client-sent settlement mode — it follows the exit type.
        $row->notice_settlement_mode = $this->resolveSettlementMode((string) ($row->exit_type ?? ''));
        $this->clearBlacklistIfNotApplicable($row);
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
        $this->guardSameTenant($request, $employee);
        $data = $this->validatePayload($request);

        /* The notice-period settlement has to be closed before the case can be.
           Money owed in either direction (recovered from the employee, or paid
           to them in lieu) is a hard gate — the SPA greys the button, and this
           is the server-side twin so a crafted request can't slip past it. */
        $mode   = $this->resolveSettlementMode((string) ($data['exit_type'] ?? ''));
        $amount = (float) ($data['notice_settlement_amount'] ?? 0);
        $status = (string) ($data['notice_settlement_status'] ?? 'NA');
        if ($mode !== 'served' && $amount > 0 && $status !== 'Settled') {
            abort(422, $mode === 'recover'
                ? 'The notice-period recovery from this employee is not settled yet — record the payment and approve it before completing the exit.'
                : 'The notice-period payment to this employee is not settled yet — disburse the full amount before completing the exit.');
        }

        $row = DB::transaction(function () use ($request, $data, $employee, $mode) {
            $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
            $lockedType = $this->lockedExitType($row);
            $row->fill($data);
            $this->assertExitTypeUnchanged($lockedType, $row);
            $row->employee_id          = $employee->id;
            $row->client_id            = $employee->client_id;
            $row->branch_id            = $employee->branch_id;
            $row->reporting_manager_id = $row->reporting_manager_id ?? $employee->reporting_manager_id;
            $row->notice_settlement_mode = $mode;
            $this->clearBlacklistIfNotApplicable($row);
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

            // Disable the paired login + revoke tokens (mirrors
            // EmployeeController::destroy, minus the soft-delete).
            if ($employee->user) {
                $employee->user->update(['status' => 'inactive']);
                $employee->user->tokens()->delete();
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
        $this->guardSameTenant($request, $employee);

        $data = $request->validate([
            'restart_onboarding' => 'nullable|boolean',
            'note'               => 'nullable|string|max:500',
        ]);

        $exit = EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->orderByDesc('id')
            ->first();

        abort_if(!$exit, 422, 'This employee has no exit on record to rehire from.');

        $type = (string) ($exit->exit_type ?? '');
        if ($this->resolveSettlementMode($type) !== 'served') {
            abort(422, $type === 'Termination'
                ? 'A terminated employee cannot be rehired from here — this needs a fresh hiring process.'
                : 'An employee who left without serving their notice period cannot be rehired from here — this needs a fresh hiring process.');
        }
        abort_if(strcasecmp((string) $exit->blacklisted, 'Yes') === 0, 422,
            'This employee is blacklisted and cannot be rehired.');

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

            // Switch the paired login back on. Tokens were revoked at exit, so
            // they sign in fresh.
            if ($employee->user) {
                $employee->user->update(['status' => 'active']);
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
            'payroll'          => $this->fnfEarnedSalary($employee, $lwd),
            'advances'         => $this->fnfAdvances($employee, $lwd),
            'claims'           => $this->fnfClaims($employee),
        ]]);
    }

    /**
     * Salary earned in the exit month, up to and including the last working
     * day. Pro-rated on CALENDAR days — the same basis the notice period uses,
     * so the two never disagree.
     */
    private function fnfEarnedSalary(Employee $employee, \Carbon\Carbon $lwd): array
    {
        $annual  = (float) ($employee->annual_salary ?? 0);
        $monthly = $annual > 0 ? round($annual / 12, 2) : 0.0;

        $monthDays  = (int) $lwd->daysInMonth;
        // Someone who joined mid-month is only owed from their joining date.
        $start = $lwd->copy()->startOfMonth();
        if ($employee->date_of_joining) {
            $doj = \Carbon\Carbon::parse($employee->date_of_joining)->startOfDay();
            if ($doj->gt($start)) $start = $doj;
        }
        $earnedDays = $lwd->lt($start) ? 0 : $start->diffInDays($lwd) + 1;

        return [
            'cycle'         => $lwd->format('F Y'),
            'monthly_gross' => $monthly,
            'month_days'    => $monthDays,
            'earned_days'   => $earnedDays,
            'amount'        => $monthDays > 0 ? round($monthly * $earnedDays / $monthDays, 2) : 0.0,
            'note'          => 'Excluded from the ' . $lwd->format('F Y')
                . ' payroll run — settle the earned salary here.',
        ];
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
            return ['total' => 0.0, 'items' => []];
        }

        // NB: advance_requests / expense_claims are hard-delete tables — no
        // deleted_at column, so don't filter on one.
        $rows = DB::table('advance_requests')
            ->where('employee_id', $employee->id)
            ->whereRaw('LOWER(hr_status) = ?', ['approved'])
            ->get(['id', 'advance_no', 'advance_type', 'amount', 'recovery_start',
                   'recovery_mode', 'recovery_months', 'monthly_emi']);

        $items = [];
        $total = 0.0;
        foreach ($rows as $r) {
            $amount = (float) $r->amount;
            if ($amount <= 0) continue;

            $recovered = 0.0;
            if ($r->recovery_start) {
                $start = \Carbon\Carbon::parse($r->recovery_start)->startOfDay();
                if ($start->lte($lwd)) {
                    if ($r->recovery_mode === 'emi') {
                        $emi     = (float) ($r->monthly_emi ?: round($amount / max(1, (int) ($r->recovery_months ?: 1)), 2));
                        // Instalments whose month has been reached by the LWD.
                        $elapsed = $start->copy()->startOfMonth()->diffInMonths($lwd->copy()->startOfMonth()) + 1;
                        $elapsed = min($elapsed, max(1, (int) ($r->recovery_months ?: 1)));
                        $recovered = min($amount, round($emi * $elapsed, 2));
                    } else {
                        $recovered = $amount;   // lumpsum, start month reached
                    }
                }
            }

            $outstanding = round($amount - $recovered, 2);
            if ($outstanding <= 0.005) continue;

            $total += $outstanding;
            $items[] = [
                'id'          => $r->id,
                'reference'   => $r->advance_no,
                'type'        => $r->advance_type,
                'amount'      => round($amount, 2),
                'recovered'   => round($recovered, 2),
                'outstanding' => $outstanding,
            ];
        }

        return ['total' => round($total, 2), 'items' => $items];
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

    /**
     * The blacklist question is only asked when the notice wasn't served —
     * a resignation without notice, or a termination. If the exit type is
     * changed back to a standard resignation, any answer recorded under the
     * old type has to go: leaving a stale "Yes" behind would blacklist someone
     * on the strength of a question their exit type never poses.
     */
    private function clearBlacklistIfNotApplicable(EmployeeExit $row): void
    {
        if ($this->resolveSettlementMode((string) ($row->exit_type ?? '')) === 'served') {
            $row->blacklisted      = null;
            $row->blacklist_reason = null;
        }
    }

    private function resolveSettlementMode(string $exitType): string
    {
        return match ($exitType) {
            'Resignation without notice period', 'Absconding' => 'recover',
            'Termination' => 'pay_in_lieu',
            default       => 'served',
        };
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

            // Process meta — per-stage status map + current wizard step. The
            // stage list is dynamic (4 base stages, plus a settlement stage for
            // two of the three exit types), so the ceiling is no longer 4.
            'stage_status'          => 'nullable|array',
            'current_stage'         => 'nullable|integer|min:1|max:6',
        ]);
    }

    /** Same scope rule as EmployeeController. Super admins see everything;
     *  other roles must share the employee's client_id. */
    private function guardSameTenant(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        $this->authorizeMaster($user);
        if ($user->isSuperAdmin()) return;
        if ($employee->client_id && $user->client_id !== $employee->client_id) {
            abort(403, 'Employee belongs to a different organization.');
        }
    }

    /** Cap the granular permission check to the 'master.employees' module —
     *  exit management piggy-backs on it since it's a per-employee action. */
    private function authorizeMaster($user): void
    {
        if ($user->isSuperAdmin()) return;
        $moduleId = Module::where('slug', 'master.employees')->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Employees module not enabled.');
        }
        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_edit', true)
            ->exists();
        if (!$allowed) abort(403, 'Missing can_edit on master.employees');
    }

    /**
     * Project a (possibly null) exit row into a stable JSON shape. Falls
     * back to the employee's current `reporting_manager_id` so the form
     * pre-fills even on first open.
     */
    private function format(?EmployeeExit $row, Employee $employee): array
    {
        $managerId = $row?->reporting_manager_id ?? $employee->reporting_manager_id;
        $manager   = $row?->manager;
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
            // an older mapping) still reports the right settlement on read.
            'notice_settlement_mode'   => $this->resolveSettlementMode((string) ($row?->exit_type ?? '')),
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
        ];
    }
}
