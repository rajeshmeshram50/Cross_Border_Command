<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
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
        if ($deny = $this->denyUnlessManager($request, 'change')) return $deny;
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

        $structure = DB::transaction(function () use ($data, $employee, $user, $monthlyGross, $monthlyDeductions) {
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
             * The breakup remains what is written, not the typed CTC: the two
             * agree to within SALARY_ROUNDING_SLACK by the time we get here, and
             * the components are the figures payroll will actually pay. */
            $employee->update([
                'pf_eligible'    => (bool) $created->pf_applicable,
                'esi_applicable' => $created->esi_applicable ? 'Yes' : 'No',
                'annual_salary'  => round($monthlyGross * 12, 2),
            ]);

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
        if ($deny = $this->denyUnlessManager($request, 'delete')) return $deny;
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
     * Mirrors PayrollAdjustmentController::canManage() so the two payroll
     * write surfaces answer the question the same way.
     */
    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;
        // The employee tier never manages salary, whatever else is granted.
        if ($user->user_type === 'employee') return false;
        $perm = $user->permissions['hr.payroll'] ?? null;
        return is_array($perm) && (($perm['can_edit'] ?? false) || ($perm['can_approve'] ?? false));
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
