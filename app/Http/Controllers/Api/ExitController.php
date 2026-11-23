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

class ExitController extends Controller
{
    private const DISPLAY_TZ = 'Asia/Kolkata';

    public function show(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee);
        $row = EmployeeExit::with(['manager:id,first_name,middle_name,last_name,display_name,emp_code'])
            ->where('employee_id', $employee->id)
            ->first();
        if ($row && $row->rehired_at) {
            $row = null;
        }
        return response()->json($this->format($row, $employee));
    }

    private const EXITED_STATUSES = ['Resigned', 'Terminated', 'Inactive'];

    private function employeeIdsExiting(?int $clientId): array
    {
        return \App\Support\ExitInProgress::employeeIds($clientId);
    }

    private function wouldCycle(int $reportId, int $managerId): bool
    {
        $seen    = [];
        $current = $managerId;
        for ($depth = 0; $depth < 64 && $current; $depth++) {
            if ($current === $reportId) return true;
            if (isset($seen[$current])) return true;
            $seen[$current] = true;
            $current = (int) Employee::whereKey($current)->value('reporting_manager_id');
        }
        return false;
    }

    private function activeDirectReports(Employee $employee)
    {
        return Employee::query()
            ->where('reporting_manager_id', $employee->id)
            ->whereNotIn('status', self::EXITED_STATUSES)
            ->whereDoesntHave('exit', fn($q) => $q
                ->whereNull('rehired_at')
                ->where(fn($w) => $w
                    ->where('exit_case_status', 'Closed')
                    ->orWhere('final_employee_status', 'Exited')))
            ->with(['department:id,name', 'designation:id,name'])
            ->orderBy('display_name')
            ->get();
    }

    private const CASE_COLUMNS = [
        'exit_type',
        'initiated_by',
        'reason_for_exit',
        'other_reason',
        'notice_date',
        'last_working_day',
        'reporting_manager_id',
        'comments',
        'business_impact',
        'replacement_required',
        'clearances',
        'asset_returns',
        'handover_notes',
        'validation',
        'final_employee_status',
        'profile_lock',
        'exit_case_status',
        'hr_sign_off',
        'stage_status',
        'current_stage',
        'completed_at',
        'notice_settlement_mode',
        'notice_payment_choice',
        'notice_days_required',
        'notice_days_served',
        'notice_days_unserved',
        'notice_settlement_basis',
        'notice_per_day_rate',
        'notice_settlement_amount',
        'notice_settlement_status',
        'notice_payment',
        'fnf',
        'blacklisted',
        'blacklist_reason',
        'documents_released',
        'documents_released_at',
        'documents_released_by',
        'rehired_at',
        'rehired_by',
        'rehire_restart_onboarding',
        'rehire_note',
    ];

    private function resetSpentCase(EmployeeExit $row): void
    {
        if (!$row->exists || !$row->rehired_at) {
            return;
        }
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
        $isNewCase = !EmployeeExit::where('employee_id', $employee->id)->exists();
        $this->guardSameTenant($request, $employee, $isNewCase ? 'can_add' : 'can_edit');
        $this->guardNotSelf($request, $employee);
        $data = $this->validatePayload($request);

        $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);

        $incomingNotice = $data['notice_date'] ?? null;
        $storedNotice   = $row->notice_date?->toDateString();
        $exitTypeNow    = $data['exit_type'] ?? $row->exit_type;
        if (
            $incomingNotice
            && \Carbon\Carbon::parse($incomingNotice)->toDateString() !== $storedNotice
            && !$this->servesNoNotice($exitTypeNow === null ? null : (string) $exitTypeNow)
            && \App\Support\ProbationGuard::noticePeriodApplies($employee, $incomingNotice)
            && \Carbon\Carbon::parse($incomingNotice)->startOfDay()->lte(\Carbon\Carbon::today())
        ) {
            abort(422, 'The notice start date must be tomorrow or later — notice cannot begin on a day that is already under way.');
        }

        if (!$row->exists && $employee->trashed()) {
            abort(422, 'This employee is disabled, so an exit cannot be started for them. Re-enable them from HR > Employees > Disabled Employees, then run the exit process.');
        }

        $this->resetSpentCase($row);

        $lockedType     = $this->lockedExitType($row);
        $wasReleased    = (bool) $row->documents_released;
        $storedLwd      = $row->last_working_day;
        $storedCase     = (string) ($row->exit_case_status ?? 'Open');
        $fnfIsPaid      = $row->exists && $this->isFnfPaid($row);
        $lockedFnf      = $fnfIsPaid ? $row->fnf : null;
        $lockedChoice   = $fnfIsPaid ? $row->notice_payment_choice : null;
        $row->fill($data);
        if ($fnfIsPaid) {
            $row->fnf                   = $lockedFnf;
            $row->notice_payment_choice = $lockedChoice;
        }

        if (!$fnfIsPaid && $this->isFnfPaid($row)) {
            $lwd = $row->last_working_day
                ? \Carbon\Carbon::parse($row->last_working_day)->toDateString()
                : null;
            if ($lwd && $lwd > \Carbon\Carbon::now(self::DISPLAY_TZ)->toDateString()) {
                abort(422, 'The Full & Final can only be settled from the last working day ('
                    . \Carbon\Carbon::parse($lwd)->format('d M Y')
                    . ') onwards — it prices the exit month up to that day.');
            }
        }

        $row->exit_case_status = $storedCase === 'Closed' ? 'Closed' : 'Open';
        $this->assertExitTypeUnchanged($lockedType, $row);
        $this->assertLastWorkingDayWithinNotice($row, $employee, $storedLwd);
        $this->stampDocumentRelease($row, $wasReleased, $request);
        $row->employee_id          = $employee->id;
        $row->client_id            = $employee->client_id;
        $row->branch_id            = $employee->branch_id;
        $row->reporting_manager_id = $employee->reporting_manager_id ?? $row->reporting_manager_id;
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

    public function complete(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');
        $this->guardNotSelf($request, $employee);
        $data = $this->validatePayload($request);

        $row = DB::transaction(function () use ($request, $data, $employee) {
            Employee::withTrashed()->whereKey($employee->id)->lockForUpdate()->firstOrFail();

            $saved = EmployeeExit::where('employee_id', $employee->id)->first();

            if ($saved && $saved->exit_case_status === 'Closed') {
                abort(409, 'This exit has already been completed.');
            }

            $mode   = $this->resolveSettlementMode(
                (string) ($data['exit_type'] ?? ''),
                $data['notice_payment_choice']
                    ?? $saved?->notice_payment_choice,
            );
            $amount = (float) ($data['notice_settlement_amount'] ?? 0);
            $status = (string) ($data['notice_settlement_status'] ?? 'NA');
            $noticeDate = $data['notice_date']
                ?? $saved?->notice_date;
            if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $noticeDate)) {
                $amount = 0.0;
            }
            if ($mode !== 'served' && $amount > 0 && $status !== 'Settled') {
                abort(422, $mode === 'recover'
                    ? 'The notice-period recovery from this employee is not settled yet — record the payment and approve it before completing the exit.'
                    : 'The notice-period payment to this employee is not settled yet — disburse the full amount before completing the exit.');
            }

            $gateLwd = !empty($data['last_working_day'])
                ? \Carbon\Carbon::parse($data['last_working_day'])->startOfDay()
                : (($stored = $saved?->last_working_day)
                    ? \Carbon\Carbon::parse($stored)->startOfDay()
                    : \Carbon\Carbon::now(self::DISPLAY_TZ)->startOfDay());
            $advCheck = $this->fnfAdvances($employee, $gateLwd);
            if (!($advCheck['all_complete'] ?? true)) {
                $refs = collect($advCheck['items'] ?? [])
                    ->filter(fn($i) => empty($i['complete']))
                    ->map(fn($i) => $i['reference'])
                    ->filter()->values()->all();
                abort(422, 'Company advance(s) not fully settled: ' . implode(', ', $refs)
                    . '. Settle, return the balance (with each payment approved), or raise the reimbursement before completing the exit.');
            }

            $orphans = $this->activeDirectReports($employee);
            if ($orphans->isNotEmpty()) {
                $names = $orphans->take(5)
                    ->map(fn($e) => $e->display_name ?: $e->emp_code)
                    ->filter()->implode(', ');
                $more = $orphans->count() > 5 ? ' and ' . ($orphans->count() - 5) . ' more' : '';
                abort(422, $orphans->count() . ' employee(s) still report to this person (' . $names . $more
                    . '). Assign them a new reporting manager before completing the termination.');
            }

            $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
            $this->resetSpentCase($row);
            $lockedType = $this->lockedExitType($row);
            $storedLwd  = $row->last_working_day;
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
            $row->reporting_manager_id = $employee->reporting_manager_id ?? $row->reporting_manager_id;
            $this->applyNoticeChoice($row);
            $row->notice_settlement_mode = $mode;
            $this->applyNoticeWaiver($row, $employee);
            $this->applyTerminationBlacklist($row);
            if (!$row->exists) $row->created_by = $request->user()?->id;

            $row->exit_case_status = 'Closed';
            $row->current_stage    = 4;
            $row->completed_at     = now();
            $row->save();

            $employee->status = $this->resolveFinalStatus((string) ($row->exit_type ?? ''));
            $employee->save();

            if ($employee->user) {
                $employee->user->update(['status' => 'inactive', 'email_active' => false]);
                $employee->user->tokens()->delete();
            }

            if (!$employee->trashed()) {
                $employee->delete();
            }

            return $row;
        });

        $this->sendFarewellEmail($employee, $row);

        $row->load(['manager:id,first_name,middle_name,last_name,display_name,emp_code']);
        return response()->json([
            'message' => 'Exit completed — employee marked as exited and login disabled.',
            'exit'    => $this->format($row, $employee->fresh()),
        ]);
    }

    public function directReports(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee);

        $reports = $this->activeDirectReports($employee);

        if ($request->boolean('count_only')) {
            return response()->json([
                'employee_id' => $employee->id,
                'reports'     => $reports->map(fn($e) => [
                    'id'       => $e->id,
                    'name'     => $e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')),
                    'emp_code' => $e->emp_code,
                ])->values(),
                'managers'    => [],
                'login_users' => [],
            ]);
        }

        $exiting = $this->employeeIdsExiting($employee->client_id);

        $pool = Employee::query()
            ->where('client_id', $employee->client_id)
            ->whereNotIn('status', self::EXITED_STATUSES)
            ->where('id', '!=', $employee->id)
            ->whereDoesntHave('exit', fn($q) => $q
                ->whereNull('rehired_at')
                ->where(fn($w) => $w
                    ->where('exit_case_status', 'Closed')
                    ->orWhere('final_employee_status', 'Exited')))
            ->whereNotNull('designation_id')
            ->with(['department:id,name', 'designation:id,name'])
            ->orderBy('display_name')
            ->get()
            ->map(fn($e) => [
                'id'          => $e->id,
                'name'        => $e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')),
                'emp_code'    => $e->emp_code,
                'department'  => $e->department?->name,
                'designation' => $e->designation?->name,
                'rank'        => \App\Support\PositionHierarchy::rankForDesignationName($e->designation?->name),
                'exiting'     => in_array((int) $e->id, $exiting, true),
                'incomplete_onboarding' => (int) ($e->onboarding_stage_completed ?? 0) < 6,
            ])
            ->values();

        $reportBranchIds = $reports->pluck('branch_id')->filter()->unique()->values()->all();
        if ($employee->branch_id) $reportBranchIds[] = (int) $employee->branch_id;
        $reportBranchIds = array_values(array_unique($reportBranchIds));

        $loginUsers = \App\Models\User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user'])
            ->where('status', 'active')
            ->when($employee->client_id, fn($q) => $q->where('client_id', $employee->client_id))
            ->when($reportBranchIds !== [], fn($q) => $q->where(
                fn($w) => $w->whereNull('branch_id')->orWhereIn('branch_id', $reportBranchIds)
            ))
            ->orderBy('name')
            ->get(['id', 'name', 'user_type', 'designation'])
            ->map(fn($u) => [
                'id'          => $u->id,
                'kind'        => 'user',
                'name'        => $u->name,
                'emp_code'    => null,
                'department'  => null,
                'designation' => $u->designation ?: ucfirst(str_replace('_', ' ', $u->user_type)),
                'rank'        => \App\Support\PositionHierarchy::TOP_RANK,
                'exiting'     => false,
                'incomplete_onboarding' => false,
            ])
            ->values();

        return response()->json([
            'employee_id' => $employee->id,
            'login_users' => $loginUsers,
            'reports'     => $reports->map(fn($e) => [
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

    public function reassignReports(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');

        $data = $request->validate([
            'assignments'                             => 'required|array|min:1',
            'assignments.*.employee_id'               => 'required|integer|exists:employees,id',
            'assignments.*.reporting_manager_id'      => 'nullable|integer|exists:employees,id',
            'assignments.*.reporting_manager_user_id' => 'nullable|integer|exists:users,id',
        ]);

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

                if ($managerUser > 0) {
                    $u = \App\Models\User::find($managerUser);
                    if (
                        !$u
                        || !in_array($u->user_type, ['client_admin', 'client_user', 'branch_user'], true)
                        || (string) $u->status !== 'active'
                        || ($employee->client_id && (int) $u->client_id !== (int) $employee->client_id)
                    ) {
                        abort(422, 'The selected login user is not an active manager for this client.');
                    }
                    $report = Employee::findOrFail($reportId);
                    if (
                        $u->branch_id !== null && $report->branch_id !== null
                        && (int) $u->branch_id !== (int) $report->branch_id
                    ) {
                        abort(422, "{$u->name} belongs to a different branch and cannot manage "
                            . ($report->display_name ?: $report->emp_code) . '.');
                    }
                    $report->reporting_manager_user_id = $managerUser;
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

                if ((int) $manager->client_id !== (int) $employee->client_id) {
                    abort(422, 'The selected reporting manager belongs to another client.');
                }
                if (in_array((string) $manager->status, self::EXITED_STATUSES, true) || $manager->trashed()) {
                    abort(422, 'The selected reporting manager is not an active employee.');
                }

                if ((int) ($manager->onboarding_stage_completed ?? 0) < 6) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} has not completed onboarding, so they cannot be made a reporting manager yet.");
                }

                if ($manager->designation_id === null) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} has no designation set, so their position in the hierarchy cannot be verified. Set their designation on the employee record first.");
                }

                $reportRank  = \App\Support\PositionHierarchy::rankForDesignationName($report->designation?->name);
                $managerRank = \App\Support\PositionHierarchy::rankForDesignationName($manager->designation?->name);
                if (!\App\Support\PositionHierarchy::eligible($reportRank, $managerRank)) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} cannot manage " . ($report->display_name ?: $report->emp_code)
                        . ' — a reporting manager must hold a higher position in the hierarchy.');
                }

                if (in_array($managerId, $this->employeeIdsExiting($employee->client_id), true)) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} has an exit in progress and cannot take on reporting responsibilities.");
                }

                if ($this->wouldCycle($reportId, $managerId)) {
                    $who = $manager->display_name ?: $manager->emp_code;
                    abort(422, "{$who} already reports to " . ($report->display_name ?: $report->emp_code)
                        . ' (directly or through their chain) — this would create a reporting loop.');
                }

                $report->reporting_manager_id = $managerId;
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

    private function sendFarewellEmail(Employee $employee, EmployeeExit $row): void
    {
        try {
            $personal = trim((string) ($employee->email ?? ''));
            if ($personal === '') return;

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

    public function uploadFnfAttachment(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');
        $this->guardNotSelf($request, $employee);

        $paidRow = EmployeeExit::where('employee_id', $employee->id)->first();
        if ($paidRow && $this->isFnfPaid($paidRow)) {
            return response()->json([
                'message' => 'This Full & Final has already been paid — its document can no longer be replaced.',
                'errors'  => ['attachment' => ['The settlement is already paid.']],
            ], 422);
        }

        $request->validate([
            'attachment' => ['required', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:5120'],
        ], [
            'attachment.required' => 'Select the Full & Final document to upload.',
            'attachment.mimes'    => 'Only PDF, JPG or PNG files are accepted for the Full & Final document.',
            'attachment.max'      => 'The Full & Final document must be 5 MB or smaller.',
        ]);

        $file = $request->file('attachment');
        $path = $file->store('exit-fnf/' . $employee->id, 'public');

        $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
        $this->resetSpentCase($row);
        $row->employee_id = $employee->id;
        $row->client_id   = $row->client_id ?: $employee->client_id;
        $row->branch_id   = $row->branch_id ?: $employee->branch_id;
        $fnf = is_array($row->fnf) ? $row->fnf : [];
        $fnf['attachment'] = [
            'path' => $path,
            'name' => $file->getClientOriginalName(),
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

    public function rehire(Request $request, $employee)
    {
        $employee = Employee::withTrashed()->findOrFail($employee);
        $this->guardSameTenant($request, $employee, 'can_edit');
        $this->guardNotSelf($request, $employee);

        $data = $request->validate([
            'restart_onboarding' => 'nullable|boolean',
            'note'               => 'nullable|string|max:500',
            'rejoining_date'     => [
                'nullable',
                'date',
                'after_or_equal:' . now()->toDateString(),
                'before_or_equal:' . now()->addYears(2)->toDateString(),
            ],
        ], [
            'rejoining_date.after_or_equal'  => 'The rejoining date cannot be in the past — it is the day this employee returns.',
            'rejoining_date.before_or_equal' => 'The rejoining date cannot be more than two years ahead.',
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
            if ($employee->trashed()) {
                $employee->restore();
            }
            $employee->status = 'Active';

            if (!empty($data['rejoining_date'])) {
                $employee->date_of_joining = $data['rejoining_date'];
                \App\Models\SalaryStructure::where('employee_id', $employee->id)
                    ->where('status', 'active')
                    ->update(['effective_from' => $data['rejoining_date']]);
            }

            if ($restart) {
                $employee->onboarding_stage_completed = 0;
            }
            $employee->save();

            if ($employee->user) {
                $u = $employee->user;
                $clash = \App\Models\User::where('id', '!=', $u->id)
                    ->whereNull('deleted_at')
                    ->where('email_active', true)
                    ->whereRaw('LOWER(email) = ?', [mb_strtolower((string) $u->email)])
                    ->where(fn($q) => $u->client_id === null
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
            'payroll'          => $this->fnfEarnedSalary($employee, $lwd, $exit?->notice_date),
            'advances'         => $this->fnfAdvances($employee, $lwd),
            'claims'           => $this->fnfClaims($employee),
        ]]);
    }

    private function fnfEarnedSalary(Employee $employee, \Carbon\Carbon $lwd, $resignationDate = null): array
    {
        return app(\App\Services\PayrollService::class)
            ->earnedSalaryForExitMonth($employee, $lwd, $resignationDate);
    }

    private function fnfAdvances(Employee $employee, \Carbon\Carbon $lwd): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('advance_requests')) {
            return ['total' => 0.0, 'items' => [], 'all_complete' => true, 'incomplete_count' => 0];
        }

        $rows = DB::table('advance_requests')
            ->where('employee_id', $employee->id)
            ->whereRaw('LOWER(hr_status) = ?', ['approved'])
            ->get([
                'id',
                'advance_no',
                'advance_type',
                'amount',
                'used_for',
                'recovery_start',
                'recovery_mode',
                'recovery_months',
                'monthly_emi',
                'recovery_direct_payments',
                'employee_settled_at',
                'settle_type',
                'settle_balance',
                'settle_approval_status',
                'settle_returned_at',
                'settle_return_scheduled_at',
                'settle_return_payments',
                'settle_reimbursement_claim_id'
            ]);

        $hasReturnLedger = \Illuminate\Support\Facades\Schema::hasTable('advance_recovery_ledger');
        $items = [];
        $total = 0.0;
        $incomplete = 0;

        foreach ($rows as $r) {
            $amount = (float) $r->amount;
            if ($amount <= 0) continue;
            $usedFor = strtolower((string) ($r->used_for ?? 'self'));

            if ($usedFor !== 'company') {
                $recovered = 0.0;
                $directPaid = round(array_sum(array_map(
                    fn($p) => (float) ($p['amount'] ?? 0),
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
                $recovered   = round(min($amount, $recovered + $directPaid), 2);
                $outstanding = round($amount - $recovered, 2);
                if ($outstanding <= 0.005) continue;
                $total += $outstanding;
                $items[] = [
                    'id' => $r->id,
                    'reference' => $r->advance_no,
                    'type' => $r->advance_type,
                    'used_for' => 'self',
                    'amount' => round($amount, 2),
                    'recovered' => round($recovered, 2),
                    'outstanding' => $outstanding,
                    'settle_state' => 'self_recover',
                    'complete' => true,
                    'note' => $directPaid > 0.005
                        ? 'Balance after direct pay-off recovered from the final settlement.'
                        : 'Recover the outstanding balance from the final settlement.',
                ];
                continue;
            }

            $settled = (bool) $r->employee_settled_at && ($r->settle_approval_status === 'approved');
            $balance = round((float) $r->settle_balance, 2);

            if (!$settled) {
                $incomplete++;
                $items[] = [
                    'id' => $r->id,
                    'reference' => $r->advance_no,
                    'type' => $r->advance_type,
                    'used_for' => 'company',
                    'amount' => round($amount, 2),
                    'recovered' => 0.0,
                    'outstanding' => 0.0,
                    'settle_state' => 'not_settled',
                    'complete' => false,
                    'note' => 'Company advance not settled/approved yet — settle it before closing the exit.',
                ];
                continue;
            }

            $type = (string) ($r->settle_type ?? 'equal');

            if ($type === 'return') {
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
                    'id' => $r->id,
                    'reference' => $r->advance_no,
                    'type' => $r->advance_type,
                    'used_for' => 'company',
                    'amount' => round($amount, 2),
                    'recovered' => $returned,
                    'outstanding' => $outstanding,
                    'settle_state' => $complete ? 'return_complete' : 'return_pending',
                    'complete' => $complete,
                    'note' => $complete
                        ? 'Unspent balance returned in full.'
                        : 'Employee still owes the unreturned balance — recover it in the F&F (or wait for approval of pending payments).',
                ];
                continue;
            }

            if ($type === 'reimburse') {
                $raised = (bool) $r->settle_reimbursement_claim_id;
                if (!$raised) $incomplete++;
                $items[] = [
                    'id' => $r->id,
                    'reference' => $r->advance_no,
                    'type' => $r->advance_type,
                    'used_for' => 'company',
                    'amount' => round($amount, 2),
                    'recovered' => round($amount, 2),
                    'outstanding' => 0.0,
                    'settle_state' => $raised ? 'reimburse_raised' : 'reimburse_pending',
                    'complete' => $raised,
                    'note' => $raised
                        ? 'Over-spend reimbursement raised — paid to the employee via the claims section.'
                        : 'Over-spend not yet raised as a reimbursement claim — raise it before closing the exit.',
                ];
                continue;
            }

            $items[] = [
                'id' => $r->id,
                'reference' => $r->advance_no,
                'type' => $r->advance_type,
                'used_for' => 'company',
                'amount' => round($amount, 2),
                'recovered' => round($amount, 2),
                'outstanding' => 0.0,
                'settle_state' => 'settled_equal',
                'complete' => true,
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

    private function fnfClaims(Employee $employee): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('expense_claims')) {
            return ['total' => 0.0, 'items' => []];
        }

        $rows = DB::table('expense_claims')
            ->where('employee_id', $employee->id)
            ->whereRaw('LOWER(hr_status) = ?', ['approved'])
            ->where(fn($q) => $q->whereNull('settlement_status')
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

    private function resolveFinalStatus(string $exitType): string
    {
        return match ($exitType) {
            'Termination', 'Absconding' => 'Terminated',
            default                     => 'Resigned',
        };
    }

    private function assertLastWorkingDayWithinNotice(EmployeeExit $row, Employee $employee, $storedLwd): void
    {
        $lwd = $row->last_working_day;
        if (!$lwd || !$row->notice_date) {
            return;
        }
        $normalize = fn($d) => $d ? \Carbon\Carbon::parse($d)->toDateString() : null;
        if ($normalize($lwd) === $normalize($storedLwd)) {
            return;
        }
        if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $row->notice_date)) {
            return;
        }
        $days = $this->noticePeriodDays($employee);
        if ($days <= 0) {
            return;
        }

        $end = \Carbon\Carbon::parse($row->notice_date)->startOfDay()->addDays($days - 1);
        if (\Carbon\Carbon::parse($lwd)->startOfDay()->gt($end)) {
            abort(422, 'Last working day cannot be after the notice period end date ('
                . $end->format('j M Y') . '). It may be the same day, or earlier.');
        }
    }

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

    private function noticePeriodDays(Employee $employee): int
    {
        $n = $employee->notice_period_days;
        if ($n !== null && $n !== '' && is_numeric($n)) {
            return (int) $n;
        }
        return preg_match('/(\d+)/', (string) $employee->notice_period, $m) ? (int) $m[1] : 0;
    }

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

    private function stampDocumentRelease(EmployeeExit $row, bool $wasReleased, Request $request): void
    {
        $isReleased = (bool) $row->documents_released;

        if (!$this->isFnfSettled($row)) {
            $row->documents_released    = false;
            $row->documents_released_at = null;
            $row->documents_released_by = null;
            abort_if(
                $isReleased,
                422,
                'Exit documents cannot be released until the Full & Final settlement has been paid.'
            );
            return;
        }

        if ($isReleased === $wasReleased) {
            return;
        }
        $row->documents_released_at = $isReleased ? now() : null;
        $row->documents_released_by = $isReleased ? $request->user()?->id : null;
    }

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

    private function isFnfEmpty(EmployeeExit $row): bool
    {
        $earn = data_get($row->fnf, 'earn');
        $ded  = data_get($row->fnf, 'ded');

        return is_numeric($earn) && is_numeric($ded)
            && (float) $earn === 0.0 && (float) $ded === 0.0;
    }

    private function isFnfSettled(EmployeeExit $row): bool
    {
        return $this->isFnfPaid($row) || $this->isFnfEmpty($row);
    }

    private function lockedExitType(EmployeeExit $row): ?string
    {
        $existing = trim((string) ($row->exists ? $row->exit_type : ''));
        return $existing !== '' ? $existing : null;
    }

    private function assertExitTypeUnchanged(?string $locked, EmployeeExit $row): void
    {
        if ($locked === null) {
            return;
        }
        $incoming = trim((string) ($row->exit_type ?? ''));
        if ($incoming === '' || $incoming === $locked) {
            $row->exit_type = $locked;
            return;
        }
        abort(422, "The exit type cannot be changed once the exit has started (this case is a \"{$locked}\"). Cancel this exit and start a new one if the type is wrong.");
    }

    private const NO_NOTICE_TYPES = ['Resignation without notice period', 'Absconding'];

    private function servesNoNotice(?string $exitType): bool
    {
        return $exitType !== null
            && in_array($exitType, self::NO_NOTICE_TYPES, true);
    }

    private function resolveSettlementMode(string $exitType, ?string $noticeChoice = null): string
    {
        if ($this->servesNoNotice($exitType)) {
            return 'recover';
        }
        if ($exitType === 'Termination') {
            return $noticeChoice === 'no_pay' ? 'served' : 'pay_in_lieu';
        }
        return 'served';
    }

    private function applyNoticeChoice(EmployeeExit $row): void
    {
        if (strcasecmp((string) ($row->exit_type ?? ''), 'Termination') !== 0) {
            $row->notice_payment_choice = null;
            return;
        }
        if ($row->notice_payment_choice === 'no_pay') {
            $priced = round((float) ($row->notice_settlement_amount ?? 0), 2);

            $row->notice_days_required     = 0;
            $row->notice_days_served       = 0;
            $row->notice_days_unserved     = 0;
            $row->notice_per_day_rate      = 0;
            $row->notice_settlement_amount = 0;
            $row->notice_settlement_status = 'NA';

            $fnf = $row->fnf;
            if ($priced > 0 && is_array($fnf)) {
                foreach (['earn', 'net'] as $key) {
                    if (isset($fnf[$key]) && is_numeric($fnf[$key])) {
                        $fnf[$key] = round(max(0, (float) $fnf[$key] - $priced), 2);
                    }
                }
                $row->fnf = $fnf;
            }
        }
    }

    private function validatePayload(Request $request): array
    {
        $data = $request->validate([
            'exit_type'             => 'nullable|in:Resignation,Resignation without notice period,Termination,Retirement,End of Contract,Absconding,Other',
            'initiated_by'          => 'nullable|in:Employee,HR,Manager',
            'reason_for_exit'       => 'nullable|string|max:60',
            'other_reason'          => 'nullable|string|max:255',
            'notice_date'           => 'nullable|date',
            'last_working_day'      => 'nullable|date|after_or_equal:notice_date',
            'reporting_manager_id'  => 'nullable|integer|exists:employees,id',
            'comments'              => 'nullable|string|max:2000',
            'business_impact'       => 'nullable|in:Low,Medium,High,Critical',
            'replacement_required'  => 'nullable|in:Yes — Immediate,Yes — Within 30 days,Yes — Within 90 days,No',

            'clearances'            => 'nullable|array',
            'asset_returns'         => 'nullable|array',
            'handover_notes'        => 'nullable|string|max:5000',

            'documents_released'    => 'nullable|boolean',

            'validation'            => 'nullable|array',
            'final_employee_status' => 'nullable|in:Active,Inactive,Exited',
            'profile_lock'          => 'nullable|in:Locked,Unlocked',
            'exit_case_status'      => 'nullable|in:Open,Closed',
            'hr_sign_off'           => 'nullable|in:Pending,Approved,Rejected',
            'blacklisted'           => 'nullable|in:Yes,No',
            'blacklist_reason'      => 'nullable|string|max:500',

            'notice_payment_choice'    => 'nullable|in:pay,no_pay',
            'notice_days_required'     => 'nullable|integer|min:0|max:365',
            'notice_days_served'       => 'nullable|integer|min:0|max:365',
            'notice_days_unserved'     => 'nullable|integer|min:0|max:365',
            'notice_settlement_basis'  => 'nullable|in:gross,basic',
            'notice_per_day_rate'      => 'nullable|numeric|min:0|max:99999999.99',
            'notice_settlement_amount' => 'nullable|numeric|min:0|max:99999999.99',
            'notice_settlement_status' => 'nullable|in:NA,Pending,Settled,Rejected',
            'notice_payment'           => 'nullable|array',

            'fnf'                   => 'nullable|array',
            'fnf.meta.payDate'      => 'nullable|date|before_or_equal:' . \Carbon\Carbon::now(self::DISPLAY_TZ)->toDateString(),

            'stage_status'          => 'nullable|array',
            'current_stage'         => 'nullable|integer|min:1|max:6',
        ], [
            'fnf.meta.payDate.before_or_equal' => 'Payment Date cannot be a future date. Please select today or a previous date.',
            'fnf.meta.payDate.date'            => 'Enter a valid payment date.',
        ]);

        if ($request->has('fnf')) {
            $fnf = $request->input('fnf');
            $data['fnf'] = is_array($fnf) ? $fnf : null;
        }

        return $data;
    }

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

    private function guardNotSelf(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);

        $selfByUserId = $employee->user_id !== null && (int) $employee->user_id === (int) $user->id;
        $selfByCode   = filled($user->employee_code) && filled($employee->emp_code)
            && strcasecmp(trim($user->employee_code), trim($employee->emp_code)) === 0;

        $isSelf = $selfByUserId || $selfByCode;

        abort_if(
            $isSelf,
            403,
            'You cannot run your own exit process. Ask another user with Exit Management access to process your exit.'
        );
    }

    private function authorizeExit($user, string $flag): void
    {
        if ($user->isSuperAdmin()) return;
        $moduleId = Module::where('slug', 'hr.exit')->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Exit Management module not enabled.');
        }
        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($flag, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$flag} on hr.exit");
    }

    private function liveNoticeDaysRequired(?EmployeeExit $row, Employee $employee): ?int
    {
        $stored = $row?->notice_days_required;
        if (!$row) return $stored;

        $status = (string) ($row->notice_settlement_status ?? 'NA');
        if (in_array($status, ['Settled', 'Rejected'], true)) {
            return $stored === null ? null : (int) $stored;
        }
        if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $row->notice_date)) {
            return 0;
        }
        return $this->noticePeriodDays($employee);
    }

    private function format(?EmployeeExit $row, Employee $employee): array
    {
        $isClosed  = (string) ($row?->exit_case_status ?? 'Open') === 'Closed';
        $managerId = $isClosed
            ? ($row?->reporting_manager_id ?? $employee->reporting_manager_id)
            : ($employee->reporting_manager_id ?? $row?->reporting_manager_id);

        $manager = ($row?->manager && (int) $row->manager->id === (int) $managerId)
            ? $row->manager
            : null;
        if (!$manager && $managerId) {
            $manager = Employee::withTrashed()
                ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code', 'status', 'deleted_at')
                ->find($managerId);
        }

        $managerPayload = null;
        if ($manager) {
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
                    'id'           => null,
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

            'notice_settlement_mode'   => $this->resolveSettlementMode(
                (string) ($row?->exit_type ?? ''),
                $row?->notice_payment_choice,
            ),
            'notice_payment_choice'    => $row?->notice_payment_choice,
            'notice_days_required'     => $this->liveNoticeDaysRequired($row, $employee),
            'notice_days_served'       => $row?->notice_days_served,
            'notice_days_unserved'     => $row?->notice_days_unserved,
            'notice_settlement_basis'  => $row?->notice_settlement_basis,
            'notice_per_day_rate'      => $row?->notice_per_day_rate,
            'notice_settlement_amount' => $row?->notice_settlement_amount,
            'notice_settlement_status' => $row?->notice_settlement_status ?? 'NA',
            'notice_payment'           => $row?->notice_payment ?? null,

            'fnf'                   => $row?->fnf ?? null,

            'clearances'            => $row?->clearances ?? [],
            'asset_returns'         => $row?->asset_returns ?? [],
            'handover_notes'        => $row?->handover_notes,
            'documents_released'    => (bool) ($row?->documents_released ?? false),
            'documents_released_at' => $row?->documents_released_at?->toIso8601String(),

            'validation'            => $row?->validation ?? [],
            'final_employee_status' => $row?->final_employee_status,
            'profile_lock'          => $row?->profile_lock,
            'exit_case_status'      => $row?->exit_case_status ?? 'Open',
            'hr_sign_off'           => $row?->hr_sign_off,
            'blacklisted'           => $row?->blacklisted,
            'blacklist_reason'      => $row?->blacklist_reason,

            'stage_status'          => $row?->stage_status ?? null,
            'current_stage'         => $row?->current_stage ?? 1,
            'completed_at'          => $row?->completed_at?->toIso8601String(),
            'employee_status'       => $employee->status,
            'updated_at'            => $row?->updated_at?->toIso8601String(),

            'monthly_basic'         => $this->resolveMonthlyBasic($employee),
            'monthly_gross'         => $this->resolveMonthlyGross($employee),
        ];
    }

    private function inForceStructure(Employee $employee): ?\App\Models\SalaryStructure
    {
        return app(\App\Services\PayrollService::class)
            ->activeStructure($employee, \Carbon\Carbon::now(self::DISPLAY_TZ));
    }

    private function resolveMonthlyBasic(Employee $employee): float
    {
        $structure = $this->inForceStructure($employee);
        if ($structure) {
            $basic = (float) $structure->basicAmount();
            if ($basic > 0) return round($basic, 2);
            $gross = (float) $structure->monthly_gross;
            if ($gross > 0) return round($gross * 0.5, 2);
        }

        $annual = (float) ($employee->annual_salary ?? 0);
        return $annual > 0 ? round(($annual / 12) * 0.5, 2) : 0.0;
    }

    private function resolveMonthlyGross(Employee $employee): float
    {
        $structure = $this->inForceStructure($employee);
        if ($structure) {
            $gross = (float) $structure->monthly_gross;
            if ($gross > 0) return round($gross, 2);
            $basic = (float) $structure->basicAmount();
            if ($basic > 0) return round($basic * 2, 2);
        }

        $annual = (float) ($employee->annual_salary ?? 0);
        return $annual > 0 ? round($annual / 12, 2) : 0.0;
    }
}
