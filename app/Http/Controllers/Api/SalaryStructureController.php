<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\SalaryStructure;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Versioned salary-structure management (Rule 5 + Rule 19).
 *
 * Creating a structure for an employee who already has an active one does NOT
 * overwrite it — the old row is superseded and a new version is inserted with
 * its own effective_from, preserving history for past payslips.
 *
 *   GET    /salary-structures?employee_id=   list (latest first)
 *   POST   /salary-structures                create / revise
 *   GET    /salary-structures/{id}           show
 *   DELETE /salary-structures/{id}           soft delete (draft only)
 */
class SalaryStructureController extends Controller
{
    /** Rupees per year a breakup may exceed the configured salary by before it
     *  is rejected — one rupee a month, enough to absorb the rounding in the
     *  form's annual ÷ 12 seed and nothing more. */
    private const SALARY_ROUNDING_SLACK = 12;

    /** Stages in the onboarding wizard; below this the employee is still being set up. */
    private const ONBOARDING_STAGES = 6;

    /** Memoised hr.payroll grant answer for this request — see hasPayrollGrant(). */
    private ?bool $payrollGrant = null;

    /**
     * Salary roster — every payable employee with their CURRENT structure
     * status. Drives the "Salary Setup" tab so HR can see who has a salary
     * configured (and who falls back to annual_salary / nothing) before running
     * payroll. Tenant + branch scoped.
     */
    /**
     * Branch filter for the salary roster.
     *
     * Branch-tier logins (branch_user AND employee — an employee with the HRMS
     * permission reaches this tab too) are pinned to their OWN branch and the
     * request's branch_id is ignored; otherwise an employee of one branch saw
     * every branch's staff in Salary Setup.
     *
     * Client-tier logins may use the branch switcher, but only for a branch that
     * belongs to their own client — same validation EmployeeController does
     * before honouring a switcher branch.
     */
    private function rosterBranchFilter(Request $request, $user): ?int
    {
        if (! $user) return null;

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return $user->branch_id ?: null;
        }

        $requested = $request->integer('branch_id') ?: null;
        if (! $requested) return null;

        if ($user->user_type === 'super_admin') return $requested;

        $belongs = \App\Models\Branch::where('id', $requested)
            ->where('client_id', $user->client_id)
            ->exists();

        return $belongs ? $requested : null;
    }

    public function employees(Request $request)
    {
        if ($deny = $this->denyUnlessManager($request, 'view')) return $deny;
        $user = $request->user();
        $branch = $this->rosterBranchFilter($request, $user);

        $eq = Employee::query()
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            /* Fully-onboarded staff only — the same gate PayrollService's
             * eligibleEmployees() applies, so this list means "everyone payroll
             * will actually pay" rather than "everyone on the books".
             *
             * Without it, someone still part-way through onboarding appeared
             * here with a "Set Salary" action beside fully-onboarded staff,
             * even though payroll excludes them from every run — HR could
             * configure a salary that would never be used, and the tab's
             * "needs setup" badge counted people who did not need it.
             * Same gate Exit Management and the reporting-manager picker use. */
            ->where('onboarding_stage_completed', '>=', 6)
            ->orderBy('first_name');
        if ($user && $user->client_id) $eq->where('client_id', $user->client_id);
        if ($branch) $eq->where('branch_id', $branch);

        /* Nobody who had not joined yet. (#116)
         *
         * Salary Setup is a TAB INSIDE a payroll cycle — the strip above it says
         * which month is being worked on — but the roster was fetched without
         * any notion of that cycle, so it listed every active employee on the
         * books. An employee joining 15 August therefore appeared in the July
         * setup, where payroll will never pay them: eligibleEmployees() prices a
         * cycle from the joining date, so July has nothing to run for them.
         * Worse, the "needs setup" badge counted them, so July looked
         * permanently unfinished because of people who do not belong to it.
         *
         * The cut is the LAST DAY of the cycle, not its first: someone joining
         * on the 20th is genuinely part of that month (paid pro-rata from the
         * 20th), and only a joining date after the month has ended puts them
         * outside it.
         *
         * A null joining date is KEPT. It cannot be judged, and dropping those
         * rows would hide an employee from every cycle rather than the wrong
         * one — a worse fault than the one being fixed here.
         *
         * Applied only when the caller names a cycle, so a request without
         * month/year still returns the whole roster and no existing caller
         * changes behaviour. */
        $month = (int) $request->query('month', 0);
        $year  = (int) $request->query('year', 0);
        if ($month >= 1 && $month <= 12 && $year >= 2000 && $year <= 2100) {
            $cycleEnd = \Carbon\Carbon::create($year, $month, 1)->endOfMonth()->toDateString();
            $eq->where(fn ($q) => $q
                ->whereNull('date_of_joining')
                ->orWhereDate('date_of_joining', '<=', $cycleEnd));
        }

        $employees = $eq->get();
        $ids = $employees->pluck('id')->all();

        /* Employees with a LIVE exit case are REMOVED from Salary Setup, not
         * flagged in it.
         *
         * The status column cannot catch them on its own: an exit under way
         * leaves employees.status on 'Active' until ExitController::complete(),
         * so without this they sat here as ordinary rows.
         *
         * They used to be kept and badged, on the reasoning that payroll still
         * had to pay them to their last working day so a missing structure still
         * mattered. That reasoning no longer holds — an open exit case now takes
         * the employee out of regular payroll entirely
         * (PayrollService::eligibleEmployees) and their dues are settled by the
         * Full & Final in Exit Management, which prices off the structure already
         * in force. There is nothing left to set up here, and leaving the row
         * only offered an action that would never be used.
         *
         * "Live" is ExitInProgress' reading — exit_type set, case Open, not
         * rehired. The old query here matched ANY non-rehired exit row, so
         * completed and closed exits were badged "Exit in progress" too, which is
         * why tenants with historic exits saw the badge on nearly every row. */
        $exiting = \App\Support\ExitInProgress::employeeIds(null, $ids);
        if (!empty($exiting)) {
            $employees = $employees->reject(fn (Employee $e) => in_array((int) $e->id, $exiting, true))->values();
            $ids = $employees->pluck('id')->all();
        }

        // Active structure per employee (one query).
        $active = SalaryStructure::whereIn('employee_id', $ids)
            ->where('status', 'active')
            ->get()->keyBy('employee_id');

        // Master name caches.
        $deptNames = $this->masterNames('master_departments');
        $desigNames = $this->masterNames('master_designations');

        $rows = $employees->map(function (Employee $e) use ($active, $deptNames, $desigNames) {
            $s = $active->get($e->id);
            return [
                /* Always false now that exiting employees are dropped above.
                 * Kept in the payload so the existing badge / disabled-"Exiting"
                 * button in HrPayroll.tsx keep compiling and stay correct if the
                 * exclusion is ever relaxed — the screen does not need a change
                 * to benefit from this one. */
                'exit_in_progress'  => false,
                'exit_last_working_day' => null,
                'employee_id'   => $e->id,
                'emp_code'      => $e->emp_code,
                'name'          => trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: $e->display_name,
                'department'    => $deptNames[$e->department_id] ?? null,
                'designation'   => $desigNames[$e->designation_id] ?? null,
                'pf_eligible'   => (bool) $e->pf_eligible,
                'pf_type'       => $e->pf_type, // statutory | standard | null
                'esi_applicable'=> strtolower((string) ($e->esi_applicable ?? '')) === 'yes',
                'annual_salary' => $e->annual_salary !== null ? (float) $e->annual_salary : null,
                // The first salary runs from the day they joined, so the modal
                // seeds Effective From with this instead of today, and refuses
                // anything earlier (#87).
                'date_of_joining' => $e->date_of_joining
                    ? \Carbon\Carbon::parse($e->date_of_joining)->toDateString()
                    : null,
                'has_structure' => (bool) $s,
                'structure_id'  => $s?->id,
                'monthly_gross' => $s ? (float) $s->monthly_gross : ($e->annual_salary ? round((float) $e->annual_salary / 12, 2) : 0),
                'version'       => $s?->version,
                'effective_from'=> optional($s?->effective_from)->toDateString(),
                'source'        => $s ? 'structure' : ($e->annual_salary ? 'annual_salary' : 'none'),
            ];
        })->values();

        return response()->json(['data' => $rows]);
    }

    private function masterNames(string $table): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable($table) || !\Illuminate\Support\Facades\Schema::hasColumn($table, 'name')) {
            return [];
        }
        return DB::table($table)->pluck('name', 'id')->all();
    }

    public function index(Request $request)
    {
        $user = $request->user();
        $q = SalaryStructure::query()->orderByDesc('id');

        if ($user && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }
        /* The employee tier is pinned to its OWN structure rather than refused
         * outright: their profile page legitimately reads their own breakup
         * (EmployeeProfile.tsx), and only the ability to read EVERYONE's was
         * the problem. A login with no employee record behind it has no own
         * structure to show, so it matches nothing rather than everything. */
        if ($user && !$this->canManage($request)) {
            $q->where('employee_id', (int) ($user->employee_id ?? 0));
        }
        if ($branch = $this->rosterBranchFilter($request, $user)) {
            $q->where('branch_id', $branch);
        }
        if ($employeeId = $request->integer('employee_id')) {
            $q->where('employee_id', $employeeId);
        }
        if ($request->boolean('active_only')) {
            $q->where('status', 'active');
        }

        return response()->json(['data' => $q->get()->map(fn ($s) => $this->serialize($s))]);
    }

    public function show(Request $request, int $id)
    {
        $s = $this->findScoped($request, $id);
        abort_unless($s, 404, 'Salary structure not found.');
        // Same self-only rule as index() — an employee may read their own
        // breakup and nobody else's.
        $user = $request->user();
        if ($user && !$this->canManage($request)
            && (int) $s->employee_id !== (int) ($user->employee_id ?? 0)) {
            abort(403, 'You can only view your own salary structure.');
        }
        return response()->json(['data' => $this->serialize($s)]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'employee_id'     => ['required', 'integer'],
            'effective_from'  => ['required', 'date'],
            'earnings'        => ['required', 'array', 'min:1'],
            'earnings.*.code'   => ['required', 'string', 'max:40'],
            'earnings.*.label'  => ['required', 'string', 'max:120'],
            'earnings.*.amount' => ['required', 'numeric', 'min:0', 'max:99999999.99'],
            'deductions'      => ['nullable', 'array'],
            'deductions.*.code'   => ['required_with:deductions', 'string', 'max:40'],
            'deductions.*.label'  => ['required_with:deductions', 'string', 'max:120'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0', 'max:99999999.99'],
            'pf_applicable'   => ['boolean'],
            /* PF Type, same rule and same two values as EmployeeController's
             * own pf_type rule — Revise Salary now offers the dropdown the
             * Employee form always had, and both write the one column. Nullable
             * because the form sends null when PF is not applied. (#127) */
            'pf_type'         => ['nullable', 'in:statutory,standard'],
            'esi_applicable'  => ['boolean'],
            'pt_applicable'   => ['boolean'],
            'revision_note'   => ['nullable', 'string', 'max:500'],
            /* The Annual CTC this revision agrees (QA #101).
             *
             * Optional, so every existing caller keeps working: when it is
             * absent the breakup is still checked against whatever is already on
             * the employee record, exactly as before. When it is present it
             * REPLACES that figure and the breakup is checked against it — which
             * is what makes an increment possible from this screen at all.
             *
             * Bounds mirror EmployeeController's own annual_salary rule (the
             * decimal(14,2) column ceiling, and a positive minimum) so the two
             * entry points to the same column cannot disagree. */
            'annual_ctc'      => ['nullable', 'numeric', 'min:0.01', 'max:999999999999.99'],
        ], [
            'annual_ctc.numeric' => 'Annual CTC must be a valid number.',
            'annual_ctc.min'     => 'Annual CTC must be greater than 0.',
            'annual_ctc.max'     => 'Annual CTC must be ≤ 999,999,999,999.99.',
        ]);

        $user = $request->user();
        // Tenant-safe: derive client/branch from the employee, never the body.
        $employee = Employee::find($data['employee_id']);
        abort_unless($employee, 422, 'Employee not found.');
        if ($user && $user->client_id && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Employee belongs to another tenant.');
        }
        /* Branch-tier managers configure their own branch only — the roster no
         * longer lists other branches, and the write path has to agree or the
         * same reach is still available by posting an employee_id directly. */
        if ($user && in_array($user->user_type, ['branch_user', 'employee'], true)
            && $user->branch_id && (int) $employee->branch_id !== (int) $user->branch_id) {
            abort(403, 'Employee belongs to another branch.');
        }

        /* Add vs Edit. (QA #153)
         *
         * There is no separate revise route — this one endpoint both creates
         * the first structure and supersedes it — so the two cases have to be
         * told apart here or the Permissions matrix cannot distinguish them.
         * An employee who already has a structure is being REVISED (can_edit);
         * one who has none is being SET UP (can_add). */
        $isRevision = SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->exists();
        /* Still being set up? The onboarding wizard re-posts the structure
         * every time the CTC or the breakup changes, so only the FIRST of
         * those posts is a "create" — the rest are revisions of a salary that
         * has never been paid. Gating those on Payroll would block the wizard
         * from its second CTC edit onwards, which is the same wall by another
         * name. (#153 follow-up) */
        $inSetup = !$isRevision
            || (int) ($employee->onboarding_stage_completed ?? 0) < self::ONBOARDING_STAGES;

        if (!$inSetup) {
            // An onboarded employee's salary is payroll's to revise.
            if (!$this->canAct($request, 'can_edit')) {
                return $this->denyResponse('revise');
            }
        } elseif (!$this->canAct($request, $isRevision ? 'can_edit' : 'can_add')
               && !$this->hasGrant($request->user(), 'hr.employee', ['can_add', 'can_edit'])) {
            /* The FIRST structure is part of setting an employee up, not of
             * managing payroll. The onboarding wizard posts it from Stage 1
             * (Employee Onboarding Setup) as soon as a CTC is entered, and the
             * Add Employee wizard does the same from its Compensation step —
             * both run as HR who may hold hr.employee without any hr.payroll
             * grant. Gating this on Payroll alone blocked onboarding outright.
             *
             * So whoever may create or edit employees may lay down their
             * opening salary. Revising one afterwards still needs Payroll,
             * which is what #153 was actually about. */
            return $this->denyResponse($isRevision ? 'revise' : 'create');
        }

        /* Bound the effective date. (QA #87)
         *
         * The rule was `['required','date']` and nothing else, so the API
         * accepted 1990-01-01 and 2099-12-31 alike. The modal seeds the joining
         * date and sets minDate from it, but a date picker is not a validation
         * rule — the field is editable, the endpoint is callable directly, and
         * neither end had an upper bound at all.
         *
         * Two things are actually invalid:
         *
         *  · BEFORE the employee joined. There is no cycle for payroll to apply
         *    it to, and activeStructure() picks by effective_from, so a
         *    pre-joining date silently becomes the version every historic
         *    lookup resolves to.
         *
         *  · Absurdly far ahead. A forward-dated revision is a real feature —
         *    Rule 19 prices each cycle on the version in force during it, and
         *    the payslip now names a pending one — so this cannot be "no future
         *    dates". It only has to stop a typo'd year, which a one-year
         *    horizon does while leaving every genuine revision room. */
        $effective = Carbon::parse($data['effective_from'])->startOfDay();

        if ($employee->date_of_joining) {
            $joined = Carbon::parse($employee->date_of_joining)->startOfDay();
            if ($effective->lt($joined)) {
                throw ValidationException::withMessages(['effective_from' =>
                    'Salary cannot take effect before the joining date ('
                    . $joined->format('j M Y') . ').']);
            }
        }

        /* A revision may not be back-dated BEHIND an existing version. (CBC #9)
         *
         * activeStructure() resolves a cycle to the version with the latest
         * effective_from on or before it — correct, and what keeps a closed
         * month priced on the terms that were in force then. But nothing
         * stopped a NEW revision being saved with an effective date earlier
         * than a version that already exists, and the modal seeds that date
         * from the JOINING date, so it was the default path rather than a
         * corner case.
         *
         * The result is a version that is flagged active, shown as current by
         * Salary Setup and the Employee form, and yet can never price a cycle:
         * an older row dated later always wins. Reported as payroll ignoring an
         * edited breakup — a structure changed to two components kept paying
         * three, because payroll was still reading the superseded version.
         *
         * Rejecting it here keeps one timeline: each revision starts on or
         * after the one before it. Same-day is allowed — that is a correction
         * to the current terms, and the version number breaks the tie. */
        $latestExisting = SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->orderByDesc('effective_from')
            ->first();

        if ($latestExisting && $latestExisting->effective_from) {
            $latestIso = Carbon::parse($latestExisting->effective_from)->startOfDay();
            if ($effective->lt($latestIso)) {
                throw ValidationException::withMessages(['effective_from' =>
                    'This employee already has a salary version effective '
                    . $latestIso->format('j M Y')
                    . '. A new revision cannot start before it, or payroll would keep using the older'
                    . ' version — choose ' . $latestIso->format('j M Y') . ' or later.']);
            }
        }

        $horizon = Carbon::now()->startOfDay()->addYear();
        if ($effective->gt($horizon)) {
            throw ValidationException::withMessages(['effective_from' =>
                'Salary cannot take effect more than a year ahead (latest '
                . $horizon->format('j M Y') . '). Check the date.']);
        }

        $monthlyGross = collect($data['earnings'])->sum(fn ($c) => (float) $c['amount']);
        $monthlyDeductions = collect($data['deductions'] ?? [])->sum(fn ($c) => (float) $c['amount']);

        /* The breakup must ADD UP to the salary agreed on the employee record —
         * not more (#70) and not less (#74). It is a split of that figure, not
         * a second opinion on it.
         *
         * Neither direction was enforced. Over: the larger figure saved and
         * every payroll run afterwards paid it. Under: setting components to
         * ₹1 saved a ₹2,00,004 structure against a ₹4,00,000 salary, and the
         * modal reported "₹1,99,996 under the salary" while still saving —
         * which, now that an accepted revision writes back to the employee
         * record, would have silently halved someone's agreed pay.
         *
         * Tolerance: the form seeds the split from annual_salary / 12 ROUNDED
         * to the rupee, so a legitimate breakup can land a few rupees either
         * side (₹5,00,000 → ₹41,667/mo → ₹5,00,004/yr). One rupee a month
         * absorbs that and nothing more.
         *
         * No configured salary means there is nothing to validate against —
         * the structure then IS the source of truth, so it is allowed. */
        /* WHICH figure the breakup is measured against (QA #101).
         *
         * A submitted annual_ctc is the salary being AGREED by this revision and
         * wins; without one, the employee record's existing figure is the target,
         * as before.
         *
         * This is what unblocked the screen. The rule was "the breakup must equal
         * employee.annual_salary", and the write-back below then set
         * annual_salary to the breakup — which, having just passed that check,
         * could only ever be the same number. So the modal could re-split a CTC
         * but never change it: an increment 422'd with "raise the salary on the
         * employee record first", and the button labelled "Revise Salary" could
         * not revise the salary. The comparison still exists and is still strict;
         * it now just compares against the figure HR actually typed. */
        $submittedCtc     = array_key_exists('annual_ctc', $data) && $data['annual_ctc'] !== null
            ? round((float) $data['annual_ctc'], 2)
            : null;
        $configuredAnnual = $submittedCtc ?? (float) ($employee->annual_salary ?? 0);
        if ($configuredAnnual > 0) {
            $annualised = $monthlyGross * 12;
            $diff = $annualised - $configuredAnnual;          // + over, − under
            if (abs($diff) > self::SALARY_ROUNDING_SLACK) {
                $over = $diff > 0;
                $gap  = number_format(abs($diff), 2);
                $name = $employee->first_name ?: 'this employee';
                /* The remedy differs by which figure is in play. Against a
                 * submitted CTC the fix is here on this form (adjust one side or
                 * the other); against the stored one the old advice — go and
                 * change the employee record — still reads correctly. */
                $target = $submittedCtc !== null ? 'the Annual CTC entered' : "{$name}'s configured salary";
                return response()->json([
                    'message' => 'Total earnings come to ₹' . number_format($annualised, 2)
                        . ' a year, which is ₹' . $gap . ($over ? ' more than' : ' short of')
                        . ' ' . $target . ' of ₹' . number_format($configuredAnnual, 2)
                        . '. The breakup has to add up to the CTC — '
                        . ($submittedCtc !== null
                            ? ($over
                                ? 'reduce the components, or raise the Annual CTC.'
                                : 'add the ₹' . $gap . ' back (Basic Salary usually carries the balance), '
                                  . 'or lower the Annual CTC.')
                            : ($over
                                ? 'reduce the components, or raise the salary on the employee record first.'
                                : 'add the ₹' . $gap . ' back (Basic Salary usually carries the balance), '
                                  . 'or lower the salary on the employee record first.')),
                    'errors' => ['earnings' => [
                        'Annual total ₹' . number_format($annualised, 2) . ' does not match ₹'
                        . number_format($configuredAnnual, 2) . '.',
                    ]],
                ], 422);
            }
        }

        /* $submittedCtc MUST be in this use() list. (CBC #19)
         *
         * It was not, so inside the closure it was an UNDEFINED variable —
         * which PHP evaluates as null with only a warning — and the write-back
         * below silently took its `?? round($monthlyGross * 12, 2)` branch.
         * The typed CTC was therefore discarded exactly as before the fix:
         * ₹4,00,000 came back ₹3,99,996. The bug looked fixed in the source
         * and was not fixed in the running code. */
        /* A revision that revises NOTHING must not create a version. (QA)
         *
         * Saving the Revise form untouched used to insert a second row with the
         * identical breakup, supersede the first, and bump the version number —
         * so the history panel showed "Version 1" and "Version 2" carrying the
         * same components, the same gross and the same effective date, and the
         * only honest reading of that pair was that the audit trail was noise.
         *
         * Worse, the superseded row inherited a window ending the day BEFORE its
         * own start date ("applicable from 29 Aug 2023 to 28 Aug 2023") because
         * both versions began on the same day. A version that was never in force
         * for a single day is not a revision; it is a save button being pressed.
         *
         * Compared against the version currently in force, on everything payroll
         * or the history panel can actually see: the component fingerprints, the
         * statutory flags, the PF type, and the effective date. The revision NOTE
         * is deliberately excluded — a note is a comment on a change, not a
         * change, and letting it through would reopen the same hole one field
         * narrower.
         *
         * Returns 200 with the EXISTING version rather than 422: nothing failed,
         * and the caller's intent (these are this employee's terms) is already
         * true. The response carries `unchanged` so the form can say so plainly
         * instead of claiming a save that did not happen. */
        $current = SalaryStructure::where('employee_id', $employee->id)
            ->where('status', 'active')
            ->orderByDesc('version')
            ->first();

        if ($current && $this->sameTerms($current, $data, $employee, $monthlyGross)) {
            return response()->json([
                'unchanged' => true,
                'message'   => 'Nothing changed — version ' . $current->version
                    . ' already holds exactly these terms (effective '
                    . Carbon::parse($current->effective_from)->format('j M Y')
                    . '). No new version was created.',
                'data'      => $this->serialize($current),
            ], 200);
        }
        $structure = DB::transaction(function () use ($data, $employee, $user, $monthlyGross, $monthlyDeductions, $submittedCtc) {
            // Supersede the current active structure (Rule 19 — never overwrite).
            $prev = SalaryStructure::where('employee_id', $employee->id)
                ->where('status', 'active')
                ->orderByDesc('version')
                ->first();
            $version = $prev ? $prev->version + 1 : 1;
            if ($prev) {
                $prev->update(['status' => 'superseded']);
            }

            $created = SalaryStructure::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'employee_id'     => $employee->id,
                'version'         => $version,
                'effective_from'  => $data['effective_from'],
                'status'          => 'active',
                'earnings'        => array_values($data['earnings']),
                'deductions'      => array_values($data['deductions'] ?? []),
                'monthly_gross'   => round($monthlyGross, 2),
                'monthly_ctc'     => round($monthlyGross, 2),
                'pf_applicable'   => $data['pf_applicable'] ?? (bool) $employee->pf_eligible,
                'esi_applicable'  => $data['esi_applicable'] ?? ($monthlyGross <= 21000),
                'pt_applicable'   => $data['pt_applicable'] ?? true,
                'approval_status' => 'approved',
                'approved_by'     => $user?->id,
                'approved_at'     => now(),
                'revision_note'   => $data['revision_note'] ?? null,
                'created_by'      => $user?->id,
            ]);

            /* Keep the employee record in step with the revision.
             *
             * PF / ESI flags so the Employee + onboarding forms reflect a flag
             * enabled here — and annual_salary, which previously did NOT move.
             * A revision from ₹26,000 to ₹21,000 a month left annual_salary at
             * ₹3,12,000, so Salary Setup and the structure showed the new
             * figures while the Employee Salary form still showed the old CTC,
             * and the form's own breakup-vs-CTC comparison then reported the
             * employee as ₹60,000 "under the salary".
             *
             * The two are meant to be equal — both this modal and the Employee
             * form treat "breakup total == annual salary" as the matching
             * state — so the accepted revision becomes the new agreed figure.
             * This runs only AFTER the match check above has passed, so the
             * breakup and the CTC are already equal to within the rounding
             * slack — an increment is now made by raising the Annual CTC on this
             * form (#101), and the two still cannot drift apart.
             *
             * WHICH of the two equal-to-within-slack figures gets stored used to
             * be the breakup — and that is the ₹4 bug. (CBC #19)
             *
             * The form seeds the split from CTC / 12 rounded to the rupee, so
             * ₹4,00,000 becomes ₹33,333/mo and annualises back to ₹3,99,996.
             * Storing the derived figure meant HR typed 4,00,000, saved, and the
             * record came back 4 rupees lighter — every save shaving the rounding
             * remainder off again.
             *
             * So when this revision carries an explicit annual_ctc, THAT is the
             * agreed salary and it is what gets stored. It has already passed the
             * match check above, so it cannot differ from the components by more
             * than SALARY_ROUNDING_SLACK — this only decides which side of that
             * few-rupee gap is the number of record, and the number HR typed is
             * the one they will be held to.
             *
             * Without a submitted CTC (an older client, or a re-split that does
             * not restate the salary) the breakup remains the source, as before.
             * The components are still what payroll pays either way. */
            $employeeChanges = [
                'pf_eligible'    => (bool) $created->pf_applicable,
                'esi_applicable' => $created->esi_applicable ? 'Yes' : 'No',
                'annual_salary'  => $submittedCtc ?? round($monthlyGross * 12, 2),
            ];

            /* PF Type rides along with pf_eligible — same column the Employee
             * form and the onboarding wizard write, and the only one
             * PayrollService::computeForEmployee() reads when picking the PF
             * base. Written ONLY when the caller actually sent the field, so an
             * older client that posts without it leaves the stored type alone
             * rather than silently resetting everyone to Statutory. Cleared
             * when PF is switched off, matching the Employee form. (#127) */
            if (array_key_exists('pf_type', $data)) {
                $employeeChanges['pf_type'] = $created->pf_applicable
                    ? ($data['pf_type'] ?: 'statutory')
                    : null;
            }

            $employee->update($employeeChanges);

            return $created;
        });

        // Propagate the new salary to any non-locked payroll already generated
        // for this employee, so the payroll table reflects it everywhere
        // without a manual re-run (approved/paid runs stay frozen).
        $recomputed = app(\App\Services\PayrollService::class)->recomputeEmployeePayslips($employee->id);

        /* Say so when a payslip could NOT follow the revision.
         *
         * recomputeEmployeePayslips() only touches draft/generated runs —
         * approved and paid runs are frozen by Rule 14/15, and a locked period
         * is skipped too. That is correct, but it used to be silent: enabling PF
         * (or any change) reported "Salary structure saved" while the payslip
         * the reviewer was looking at kept the old figures, which reads as the
         * revision simply not working. Naming the frozen run turns it into a
         * known state with an obvious next step — run a fresh cycle. (QA #97) */
        $frozen = \App\Models\Payslip::where('employee_id', $employee->id)
            ->whereHas('run', fn ($q) => $q->whereNotIn('status', ['draft', 'generated']))
            ->with('run.period')
            ->get()
            ->map(fn ($s) => $s->run?->period?->label)
            ->filter()
            ->unique()
            ->values();

        return response()->json([
            'message' => 'Salary structure saved (version ' . $structure->version . ').'
                . ($recomputed > 0 ? " {$recomputed} draft payslip(s) updated." : '')
                . ($frozen->isNotEmpty()
                    ? ' Already-approved payroll (' . $frozen->implode(', ') . ') keeps its original figures'
                        . ' — the revision applies from the next run.'
                    : ''),
            'data'    => $this->serialize($structure),
        ], 201);
    }

    public function destroy(Request $request, int $id)
    {
        if (!$this->canAct($request, 'can_delete')) return $this->denyResponse('delete');
        $s = $this->findScoped($request, $id);
        abort_unless($s, 404, 'Salary structure not found.');
        if ($s->status === 'active') {
            return response()->json(['message' => 'Cannot delete the active structure — revise it instead.'], 422);
        }
        $s->delete();
        return response()->json(['message' => 'Salary structure removed.']);
    }

    /**
     * Who may READ or WRITE salary structures.
     *
     * This controller had NO permission gate at all — every other payroll
     * controller carries one, and the routes only ever applied `auth:sanctum`.
     * Any authenticated user in the tenant could therefore:
     *
     *   · GET /salary-structures            — read every colleague's full
     *     salary breakup for the whole client;
     *   · GET /salary-structures/employees  — pull the entire salary roster;
     *   · POST /salary-structures           — write a structure for ANY
     *     employee, including themselves. store() also writes back to the
     *     employee record (annual_salary, pf_eligible, esi_applicable) and
     *     immediately recomputes every non-locked payslip, so the change landed
     *     in payroll without anyone approving it. The breakup-vs-annual-salary
     *     check bounds the TOTAL, but not the split, and not the PF/ESI/PT
     *     applicability flags — switching those off is a self-service cut to
     *     one's own statutory deductions. An employee with no configured
     *     annual_salary is not bounded at all, because that check only runs
     *     when one is on file.
     *
     * WHO PASSES (changed — see hasPayrollGrant()):
     *
     *   · super_admin / client_admin / branch_user — by tier, as before.
     *   · ANY other tier, the `employee` tier included, that holds an HRMS →
     *     Time & Pay → Payroll (`hr.payroll`) grant with can_edit or
     *     can_approve.
     *
     * The blanket "the employee tier never manages salary" refusal that used to
     * sit here was wrong in practice: HR executives are routinely provisioned
     * as employee-tier logins in this HRMS, so granting them hr.payroll did
     * nothing — Salary Setup answered 403 and named no reason. Permission, not
     * tier, is the intended gate; the tier list above is a shortcut for the
     * roles that implicitly hold it.
     *
     * Mirrors PayrollAdjustmentController::canManage() in shape, but no longer
     * in outcome — that one still refuses the employee tier outright and still
     * carries the dead lookup described below.
     */
    /* Is this submission materially identical to the version already in force?
     *
     * "Materially" = everything that changes what payroll pays or what the
     * history panel displays. Amounts are compared at 2 decimal places as
     * STRINGS, which sidesteps float equality entirely: 25436.04 submitted as a
     * JSON number and 25436.0400 read back out of the JSON column both render
     * "25436.04". Components are keyed by code and sorted, so reordering the
     * rows in the form is not mistaken for a revision. */
    private function sameTerms(SalaryStructure $current, array $data, Employee $employee, float $monthlyGross): bool
    {
        if ($this->componentFingerprint($data['earnings'] ?? [])
            !== $this->componentFingerprint($current->earnings ?? [])) {
            return false;
        }
        if ($this->componentFingerprint($data['deductions'] ?? [])
            !== $this->componentFingerprint($current->deductions ?? [])) {
            return false;
        }

        /* The same defaults store() itself applies, so an omitted flag compares
         * against the value that WOULD be written, not against null. */
        $pf  = (bool) ($data['pf_applicable']  ?? (bool) $employee->pf_eligible);
        $esi = (bool) ($data['esi_applicable'] ?? ($monthlyGross <= 21000));
        $pt  = (bool) ($data['pt_applicable']  ?? true);

        if ($pf  !== (bool) $current->pf_applicable)  return false;
        if ($esi !== (bool) $current->esi_applicable) return false;
        if ($pt  !== (bool) $current->pt_applicable)  return false;

        /* PF Type lives on the EMPLOYEE, not the structure — it is the column
         * PayrollService reads when picking the PF base, so flipping Statutory
         * to Standard genuinely changes the pay and must count as a revision
         * even when every amount on the form is untouched. Only checked when
         * the caller actually sent the field, matching the write-back's own
         * array_key_exists() rule. */
        if ($pf && array_key_exists('pf_type', $data)) {
            /* Both sides normalised, because NULL and 'statutory' are the same
             * PF base — the write-back itself stores `$data['pf_type'] ?: 'statutory'`
             * and PayrollService falls back to statutory on an empty column.
             *
             * Comparing them raw rejected an unchanged save for 20 of the 38
             * employees on this database: PF on, employee.pf_type never
             * populated, and the form's dropdown defaulting to Statutory. Every
             * one of them would have collected a fresh version on every save
             * while nothing about their pay changed.
             *
             * Only checked while PF is ON. With PF off the column is dead
             * weight — payroll never reads it — so the write-back clearing a
             * stale 'statutory' is housekeeping, not a revision. That was the
             * other 4 failures, in the opposite direction. */
            $normalise = fn ($v) => strtolower(trim((string) $v)) ?: 'statutory';
            if ($normalise($data['pf_type']) !== $normalise($employee->pf_type)) return false;
        }
        /* The agreed Annual CTC, which this form writes to employee.annual_salary.
         *
         * It is NOT implied by the components. The breakup only has to total the
         * CTC to within SALARY_ROUNDING_SLACK (a rupee a month), so HR can edit
         * the CTC by a few rupees, leave every component untouched, and pass
         * validation — a real change to the figure of record that identical
         * earnings would have hidden. Skipped when the caller sends no CTC at
         * all, matching the write-back's own rule. */
        if (array_key_exists('annual_ctc', $data) && $data['annual_ctc'] !== null) {
            if (round((float) $data['annual_ctc'], 2) !== round((float) ($employee->annual_salary ?? 0), 2)) {
                return false;
            }
        }

        // Same terms starting on a different day IS a revision — the window moves.
        $a = $data['effective_from'] ? Carbon::parse($data['effective_from'])->toDateString() : null;
        $b = $current->effective_from ? Carbon::parse($current->effective_from)->toDateString() : null;

        return $a === $b;
    }

    /** A sorted, order-independent "code|label|0.00" list for one side of a breakup. */
    private function componentFingerprint($lines): array
    {
        $out = [];
        foreach ((array) $lines as $l) {
            $l     = (array) $l;
            $code  = trim((string) ($l['code'] ?? ''));
            $label = trim((string) ($l['label'] ?? $l['name'] ?? ''));
            if ($code === '' && $label === '') continue;
            /* Drop the 'pf' row from BOTH sides.
             *
             * The form injects a Provident Fund line client-side (12% of basic,
             * read-only) purely so HR can see it, then strips it before posting —
             * payroll recomputes PF from pf_applicable + the employee's PF Type
             * and never reads this row. Older saves did store it, so a structure
             * written before that strip carries a 'pf' line the form can no
             * longer send. Comparing it would make those employees fail the
             * no-change check forever and collect a new version on every save,
             * which is the very bug this guard exists to stop. PF itself is
             * still compared — as the flag and the type, which is where it
             * actually lives. */
            if (strcasecmp($code, 'pf') === 0) continue;            $out[] = mb_strtolower($code !== '' ? $code : $label)
                . '|' . mb_strtolower($label)
                . '|' . number_format((float) ($l['amount'] ?? 0), 2, '.', '');
        }
        sort($out);
        return $out;
    }
    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;
        return $this->hasPayrollGrant($user);
    }

    /**
     * Does this user hold a writeable `hr.payroll` grant?
     *
     * Resolved the way every other module gate in this codebase resolves one
     * (EmployeeController::authorize): look the module up by slug, then ask the
     * `permissions` table.
     *
     * This replaces `$user->permissions['hr.payroll'] ?? null`, which could
     * never match. `User::permissions()` is a HasMany returning a Collection of
     * Permission ROWS — indexing it by a module slug finds nothing, `?? null`
     * swallowed it silently, and `is_array(null)` is false. The whole branch
     * was dead code, so in practice only the three tiers above could manage
     * salary and no hr.payroll grant ever counted. The slug-keyed array that
     * lookup assumed exists only in AuthController's /me response payload, not
     * on the model.
     *
     * Memoised: canManage() is called more than once per request on the read
     * paths. A missing module row means the module was never seeded, so nobody
     * can hold the grant — deny rather than fall open.
     */
    private function hasPayrollGrant($user): bool
    {
        if ($this->payrollGrant !== null) return $this->payrollGrant;

        $moduleId = Module::where('slug', 'hr.payroll')->value('id');
        if (!$moduleId) return $this->payrollGrant = false;

        return $this->payrollGrant = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where(fn ($q) => $q->where('can_edit', true)->orWhere('can_approve', true))
            ->exists();
    }

    /**
     * Does this caller hold one specific write flag on `hr.payroll`? (QA #153)
     *
     * canManage() below is the READ gate and deliberately lets any
     * `branch_user` through, because a branch admin has to be able to open
     * Salary Setup for their own branch. That blanket tier pass was also the
     * only gate on the WRITE paths, which is the bug: a branch admin granted
     * Payroll with View only could still press Revise, change the CTC and
     * save, because the permission row was never consulted for their tier.
     *
     * Writes therefore resolve per flag instead:
     *   - super_admin / client_admin pass (tenant owners, as in
     *     PayrollController::canManage)
     *   - the `employee` tier never writes salary
     *   - everyone else, branch_user included, must actually hold the flag
     *
     * $flag is a column on `permissions`: can_add for a first structure,
     * can_edit for a revision, can_delete for a removal.
     */
    private function canAct(Request $request, string $flag): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
        if ($user->user_type === 'employee') return false;

        $moduleId = Module::where('slug', 'hr.payroll')->value('id');
        if (!$moduleId) return false;   // never seeded → nobody holds the grant

        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($flag, true)
            ->exists();
    }

    /**
     * Does this user hold any of $flags on the module $slug?
     *
     * Same shape as canAct(), but for a module other than hr.payroll — used to
     * let an employee-setup caller lay down a first salary structure.
     */
    private function hasGrant($user, string $slug, array $flags): bool
    {
        if (!$user) return false;

        $moduleId = Module::where('slug', $slug)->value('id');
        if (!$moduleId) return false;

        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where(function ($q) use ($flags) {
                foreach ($flags as $f) $q->orWhere($f, true);
            })
            ->exists();
    }

    /** The 403 body used by the write gates. */
    private function denyResponse(string $verb)
    {
        return response()->json(
            ['message' => "You are not allowed to {$verb} salary structures."],
            403,
        );
    }

    /** 403 response when the caller may not manage salary, else null. */
    private function denyUnlessManager(Request $request, string $verb)
    {
        return $this->canManage($request)
            ? null
            : response()->json(['message' => "You are not allowed to {$verb} salary structures."], 403);
    }

    private function findScoped(Request $request, int $id): ?SalaryStructure
    {
        $user = $request->user();
        $s = SalaryStructure::find($id);
        if (!$s) return null;
        /* Strict tenant match. A structure with a NULL client_id must not pass
         * for a scoped caller — the same null-bypass that was closed in
         * PayrollController::ownsRow and findRun. */
        if ($user && $user->client_id && (int) $s->client_id !== (int) $user->client_id) {
            return null;
        }
        return $s;
    }

    private function serialize(SalaryStructure $s): array
    {
        return [
            'id'              => $s->id,
            'employee_id'     => $s->employee_id,
            'version'         => $s->version,
            'effective_from'  => optional($s->effective_from)->toDateString(),
            'status'          => $s->status,
            'earnings'        => $s->earnings ?: [],
            'deductions'      => $s->deductions ?: [],
            'monthly_gross'   => (float) $s->monthly_gross,
            'monthly_ctc'     => (float) $s->monthly_ctc,
            'pf_applicable'   => (bool) $s->pf_applicable,
            'esi_applicable'  => (bool) $s->esi_applicable,
            'pt_applicable'   => (bool) $s->pt_applicable,
            'revision_note'   => $s->revision_note,
            'created_at'      => optional($s->created_at)->toIso8601String(),
        ];
    }
}
