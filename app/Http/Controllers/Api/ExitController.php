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
        'notice_settlement_mode', 'notice_days_required', 'notice_days_served',
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
        $this->guardSameTenant($request, $employee);
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
        $lockedFnf      = $row->exists && $this->isFnfPaid($row) ? $row->fnf : null;
        $row->fill($data);
        if ($lockedFnf !== null) {
            $row->fnf = $lockedFnf;
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
        $row->reporting_manager_id = $row->reporting_manager_id ?? $employee->reporting_manager_id;
        // Never trust a client-sent settlement mode — it follows the exit type.
        $row->notice_settlement_mode = $this->resolveSettlementMode((string) ($row->exit_type ?? ''));
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
        $this->guardSameTenant($request, $employee);
        $this->guardNotSelf($request, $employee);
        $data = $this->validatePayload($request);

        /* The notice-period settlement has to be closed before the case can be.
           Money owed in either direction (recovered from the employee, or paid
           to them in lieu) is a hard gate — the SPA greys the button, and this
           is the server-side twin so a crafted request can't slip past it. */
        $mode   = $this->resolveSettlementMode((string) ($data['exit_type'] ?? ''));
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
            // rewrite an F&F that has already been paid.
            $lockedFnf  = $row->exists && $this->isFnfPaid($row) ? $row->fnf : null;
            $row->fill($data);
            if ($lockedFnf !== null) {
                $row->fnf = $lockedFnf;
            }
            $this->assertExitTypeUnchanged($lockedType, $row);
            $this->assertLastWorkingDayWithinNotice($row, $employee, $storedLwd);
            $row->employee_id          = $employee->id;
            $row->client_id            = $employee->client_id;
            $row->branch_id            = $employee->branch_id;
            $row->reporting_manager_id = $row->reporting_manager_id ?? $employee->reporting_manager_id;
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
        $this->guardSameTenant($request, $employee);
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
        $this->guardSameTenant($request, $employee);
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
        ];
    }
}
