<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AttendancePunch;
use App\Models\AttendanceRegularization;
use App\Models\Employee;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

class AttendanceRegularizationController extends Controller
{
    private const DISPLAY_TZ = 'Asia/Kolkata';

    private const ADMIN_TYPES = ['super_admin', 'client_admin', 'branch_user'];

    private const DEFAULT_SHIFT = ['09:30', '18:30'];

    private ?string $payslipRefreshNotice = null;

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $employeeId = $request->integer('employee_id') ?: null;
        if (!$employeeId) {
            $own = Employee::find($user->employee_id);
            if (!$own) return response()->json(['data' => []]);
            $employeeId = $own->id;
        }

        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $targetClientId = Employee::where('id', $employeeId)->value('client_id');
            if ((int) $targetClientId !== (int) $user->client_id) {
                abort(404);
            }
        }

        if (
            in_array($user->user_type, ['branch_user', 'employee'], true)
            && $user->branch_id
        ) {
            $targetBranchId = Employee::withTrashed()->where('id', $employeeId)->value('branch_id');
            if ((int) $targetBranchId !== (int) $user->branch_id) {
                $myEmployeeId = $user->employee_id;
                $isOwn = $myEmployeeId && (int) $employeeId === (int) $myEmployeeId;
                $reportsToMe = Employee::where('id', $employeeId)
                    ->where(function ($w) use ($user, $myEmployeeId) {
                        $w->where('reporting_manager_user_id', $user->id);
                        if ($myEmployeeId) $w->orWhere('reporting_manager_id', $myEmployeeId);
                    })
                    ->exists();
                if (!$isOwn && !$reportsToMe) {
                    abort(404);
                }
            }
        }

        $q = AttendanceRegularization::query()
            ->where('employee_id', $employeeId)
            ->with(['approver:id,name'])
            ->orderByDesc('regularization_date')
            ->orderByDesc('id');
        if ($status = $request->input('status')) {
            $q->where('status', $status);
        }

        return response()->json(['data' => $q->get()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'employee_id'        => ['nullable', 'integer', 'exists:employees,id'],
            'regularization_date' => ['required', 'date'],
            'mode'               => ['required', Rule::in(['adjust', 'exempt'])],
            'type'               => ['nullable', 'string', 'max:100'],
            'work_locations'     => ['nullable', 'array'],
            'work_locations.*'   => ['string', 'max:120'],
            'punches'            => ['nullable', 'array'],
            'punches.*.in'       => ['nullable', 'string', 'max:8'],
            'punches.*.out'      => ['nullable', 'string', 'max:8'],
            'reason'             => ['required', 'string', 'max:2000'],
        ]);

        $employee = null;
        if (!empty($data['employee_id'])) {
            $employee = Employee::withTrashed()->find($data['employee_id']);
            if (!$employee) {
                abort(422, 'That employee no longer exists — the regularization was not filed.');
            }
        } else {
            $employee = Employee::find($user->employee_id);
            if (!$employee) {
                abort(422, 'Could not resolve target employee for this regularization request.');
            }
        }

        if (
            $user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $employee->client_id !== (int) $user->client_id
        ) {
            abort(403, 'You cannot file a regularization for an employee outside your tenant.');
        }

        $isSelf   = (int) ($employee->user_id ?? 0) === (int) $user->id;
        $onBehalf = !$isSelf && $this->hasAttendanceGrant($user);
        if (!$isSelf && !$onBehalf) {
            abort(403, 'You can only raise a regularization request for yourself — filing on behalf of another employee needs the Attendance permission.');
        }

        $todayStr = now(self::DISPLAY_TZ)->toDateString();
        $dateStr  = Carbon::parse($data['regularization_date'])->toDateString();
        if ($dateStr > $todayStr) {
            abort(422, 'You cannot regularize a future date. Pick today or a past day.');
        }

        if ($closed = $this->employmentClosedReason($employee, $dateStr)) {
            abort(422, $closed);
        }

        if ($this->payrollLocked($employee, $dateStr)) {
            abort(422, 'Payroll for ' . Carbon::parse($dateStr)->format('F Y')
                . ' is already processed and locked — attendance for this month can no longer be regularized.'
                . ' Ask HR to post an adjustment in the next payroll cycle.');
        }

        $punches = [];
        foreach (($data['punches'] ?? []) as $p) {
            $in  = trim((string) ($p['in'] ?? ''));
            $out = trim((string) ($p['out'] ?? ''));
            if ($in === '' && $out === '') continue;
            $punches[] = ['in' => $in ?: null, 'out' => $out ?: null];
        }
        if ($data['mode'] === 'adjust' && empty($punches)) {
            abort(422, 'Add at least one punch entry (an in or out time) to adjust the attendance log.');
        }

        $seenIn = [];
        foreach ($punches as $p) {
            $in = trim((string) ($p['in'] ?? ''));
            if ($in === '') continue;
            if (isset($seenIn[$in])) {
                abort(422, "Two punch rows both start at {$in}. Each entry has to be a"
                    . " separate stretch of the day — remove the duplicate or change its start time.");
            }
            $seenIn[$in] = true;
        }

        $shiftNotice = null;
        if ($data['mode'] === 'adjust') {
            $bounded = $this->boundPunchesToShift($punches, $employee);
            if (empty($bounded['punches'])) {
                abort(422, 'Those times fall entirely outside the assigned shift ('
                    . $bounded['window'] . '). Regularization can only correct hours within the shift —'
                    . ' overtime has to come from an actual punch at the device.');
            }
            if ($bounded['trimmed']) {
                $shiftNotice = 'Times outside the assigned shift (' . $bounded['window']
                    . ') were trimmed — regularization cannot be used to claim overtime.';
            }
            $punches = $bounded['punches'];
        }

        $claimed = [];
        $others = AttendanceRegularization::where('employee_id', $employee->id)
            ->where('regularization_date', $dateStr)
            ->where('status', 'Pending')
            ->where('mode', 'adjust')
            ->get(['id', 'punches', 'base_punches']);
        foreach ($others as $other) {
            $otherBase = collect(is_array($other->base_punches) ? $other->base_punches : [])
                ->pluck('in')->map(fn ($t) => trim((string) $t))->all();
            foreach ((is_array($other->punches) ? $other->punches : []) as $p) {
                if (in_array(trim((string) ($p['in'] ?? '')), $otherBase, true)) continue;
                $claimed[] = $p;
            }
        }

        if ($data['mode'] === 'adjust') {
            [$sMin, $eMin] = $this->shiftBoundsFor($employee);
            $toSegment = function (array $p, string $source) use ($sMin, $eMin): ?array {
                $inT  = trim((string) ($p['in'] ?? ''));
                $outT = trim((string) ($p['out'] ?? ''));
                $inM  = $this->toMinutes($inT);
                if ($inM === null) return null;
                $inM  = $this->nearestToWindow($inM, $sMin, $eMin) ?? $inM;
                $outM = $this->toMinutes($outT);
                $outM = $outM === null ? null : ($this->nearestToWindow($outM, $sMin, $eMin) ?? $outM);
                return ['in' => $inT, 'out' => $outT, 'from' => $inM, 'to' => $outM ?? $inM, 'src' => $source];
            };

            $segments = [];
            foreach ($punches as $p) {
                if ($s = $toSegment($p, 'mine'))    $segments[] = $s;
            }
            foreach ($claimed as $p) {
                if ($s = $toSegment($p, 'pending')) $segments[] = $s;
            }
            usort($segments, fn ($a, $b) => $a['from'] <=> $b['from']);

            $label = fn (array $s) => $s['out'] !== '' ? "{$s['in']}–{$s['out']}" : $s['in'];
            for ($i = 1; $i < count($segments); $i++) {
                $prev = $segments[$i - 1];
                $cur  = $segments[$i];
                if ($cur['from'] >= $prev['to']) continue;
                if ($prev['src'] === 'pending' && $cur['src'] === 'pending') continue;

                $other = $prev['src'] === 'pending' ? $prev : ($cur['src'] === 'pending' ? $cur : null);
                abort(422, $other
                    ? 'A request already pending approval covers ' . $label($other)
                        . ' on this day. Wait for it to be decided, or pick hours it does not cover —'
                        . ' the same time cannot be regularized twice.'
                    : 'Two entries cover the same time (' . $label($prev) . ' and ' . $label($cur)
                        . '). Each entry has to be a separate stretch of the day —'
                        . ' the same hours cannot be regularized twice.');
            }
        }

        $basePunches = $data['mode'] === 'adjust'
            ? $this->existingPunchPairs($employee, $dateStr)
            : null;

        if ($data['mode'] === 'adjust') {
            $existing = $basePunches ?? [];
            $norm = fn (array $ps) => json_encode(array_map(
                fn ($p) => [trim((string) ($p['in'] ?? '')), trim((string) ($p['out'] ?? ''))],
                $ps,
            ));
            if (!empty($existing) && $norm($existing) === $norm($punches)) {
                abort(422, 'These are the same punch times already recorded for '
                    . Carbon::parse($dateStr)->format('d M Y')
                    . ' — there is nothing to correct. Change a time, or close the form.');
            }
        }

        $attendanceId = Attendance::where('employee_id', $employee->id)
            ->whereDate('attendance_date', $dateStr)
            ->value('id');

        $chain = $this->snapshotApprovalChain($employee);
        $startLevel = $this->firstActionableLevel($chain, 1);
        $autoApproved = count($chain) > 0 && $startLevel > count($chain);

        $row = AttendanceRegularization::create([
            'client_id'              => $employee->client_id,
            'branch_id'              => $employee->branch_id,
            'employee_id'            => $employee->id,
            'attendance_id'          => $attendanceId,
            'regularization_date'    => $dateStr,
            'mode'                   => $data['mode'],
            'type'                   => $data['type'] ?? ($data['mode'] === 'exempt' ? 'On Duty (OD)' : 'Forgot to Punch'),
            'work_locations'         => array_values($data['work_locations'] ?? []),
            'punches'                => $punches,
            'base_punches'           => $basePunches,
            'reason'                 => $data['reason'],
            'status'                 => $autoApproved ? 'Approved' : 'Pending',
            'approval_chain'         => $chain,
            'current_approval_level' => $startLevel,
            'approved_at'            => $autoApproved ? now() : null,
            'approver_comment'       => $autoApproved ? 'Auto-approved — no reporting manager assigned to act' : null,
            'created_by'             => $user->id,
        ]);

        if ($autoApproved) {
            $this->applyApprovedAdjustment($row);
        }

        $pendingApprover = null;
        if (!$autoApproved) {
            $lvl = $chain[$startLevel - 1] ?? null;
            if ($lvl) {
                $name = null;
                if (!empty($lvl['approver_employee_id'])) {
                    $ap = Employee::find($lvl['approver_employee_id']);
                    $name = $ap?->display_name ?: trim(($ap?->first_name ?? '') . ' ' . ($ap?->last_name ?? '')) ?: null;
                } elseif (!empty($lvl['approver_user_id'])) {
                    $name = \App\Models\User::find($lvl['approver_user_id'])?->name;
                }
                $pendingApprover = ['name' => $name, 'role' => $lvl['approver_role'] ?? 'Reporting Manager'];
            }
        }

        $payload = $row->load('approver:id,name')->toArray();
        $payload['auto_approved']         = $autoApproved;
        $payload['pending_approver_label'] = $pendingApprover;
        $payload['shift_notice']          = $shiftNotice;

        return response()->json(['data' => $payload], 201);
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $this->findScopedOrFail($id, $user);
        $row = AttendanceRegularization::with([
            'employee:id,emp_code,first_name,last_name,display_name,department_id,designation_id,reporting_manager_id,email',
            'employee.department:id,name',
            'employee.designation:id,name',
            'employee.reportingManager:id,first_name,last_name,display_name,email',
            'approver:id,name',
            'creator:id,name',
        ])->findOrFail($id);

        return response()->json(['data' => $row]);
    }

    public function approvals(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $status = $request->input('status', 'Pending');
        $q = AttendanceRegularization::query()
            ->with([
                'employee:id,emp_code,first_name,last_name,display_name,department_id,reporting_manager_id,reporting_manager_user_id,branch_id,client_id',
                'employee.department:id,name',
                'employee.reportingManager:id,first_name,middle_name,last_name,display_name',
                'employee.reportingManagerUser:id,name',
                'approver:id,name',
            ])
            ->orderByDesc('created_at');

        $isAdminScope = $this->hasAttendanceGrant($user, 'can_view');
        $myEmployeeId = null;
        if (!$isAdminScope) {
            $myEmployeeId = $user->employee_id;

            if (
                !$myEmployeeId
                && !Employee::where('reporting_manager_user_id', $user->id)->exists()
            ) {
                return response()->json(
                    ['data' => []]
                    + ($request->integer('per_page') > 0 ? ['total' => 0] : [])
                    + ($request->boolean('with_counts')
                        ? ['counts' => ['All' => 0, 'Pending' => 0, 'Approved' => 0, 'Rejected' => 0, 'Cancelled' => 0]]
                        : [])
                );
            }

            $q->where(function ($w) use ($myEmployeeId, $user) {
                if ($myEmployeeId) {
                    $w->where('employee_id', $myEmployeeId)
                        ->orWhereIn('employee_id', function ($sub) use ($myEmployeeId) {
                            $sub->select('id')->from('employees')->where('reporting_manager_id', $myEmployeeId);
                        });
                }
                $w->orWhereIn('employee_id', function ($sub) use ($user) {
                    $sub->select('id')->from('employees')->where('reporting_manager_user_id', $user->id);
                });
            });
            if ($user->client_id) $q->where('client_id', $user->client_id);
        } elseif ($user->user_type !== 'super_admin' && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        $isBranchLocked = in_array($user->user_type, ['branch_user', 'employee'], true);
        if ($isAdminScope && $isBranchLocked && $user->branch_id) {
            $q->whereIn('employee_id', function ($sub) use ($user) {
                $sub->select('id')->from('employees')
                    ->where('client_id', $user->client_id)
                    ->where('branch_id', $user->branch_id);
            });
        } elseif ($branchId = $request->integer('branch_id')) {
            $q->where(function ($w) use ($branchId) {
                $w->where('branch_id', $branchId)->orWhereNull('branch_id');
            });
        }
        if ($search = trim((string) $request->input('search', ''))) {
            $like  = '%' . $search . '%';
            $lower = mb_strtolower($search);
            $q->where(function ($w) use ($like, $lower) {
                $w->whereIn('employee_id', function ($sub) use ($like) {
                    $sub->select('employees.id')->from('employees')
                        ->leftJoin('master_departments', 'master_departments.id', '=', 'employees.department_id')
                        ->where(function ($e) use ($like) {
                            $e->where('employees.first_name', 'ilike', $like)
                                ->orWhere('employees.last_name', 'ilike', $like)
                                ->orWhere('employees.display_name', 'ilike', $like)
                                ->orWhere('employees.emp_code', 'ilike', $like)
                                ->orWhere('master_departments.name', 'ilike', $like);
                        });
                })
                    ->orWhere('type', 'ilike', $like)
                    ->orWhere('reason', 'ilike', $like)
                    ->orWhere('status', 'ilike', $like)
                    ->orWhereRaw("to_char(regularization_date, 'FMDD FMMonth YYYY') ILIKE ?", [$like])
                    ->orWhereRaw("to_char(regularization_date, 'FMDD FMMon YYYY') ILIKE ?", [$like])
                    ->orWhereRaw('regularization_date::text ILIKE ?', [$like]);

                if (str_contains($lower, 'adjust')) $w->orWhere('mode', 'adjust');
                if (str_contains($lower, 'exempt')) $w->orWhere('mode', 'exempt');
            });
        }

        $counts = null;
        if ($request->boolean('with_counts')) {
            $byStatus = (clone $q)->reorder()
                ->select('status', DB::raw('count(*) as n'))
                ->groupBy('status')
                ->pluck('n', 'status');
            $counts = [
                'All'      => (int) $byStatus->sum(),
                'Pending'  => (int) ($byStatus['Pending']  ?? 0),
                'Approved' => (int) ($byStatus['Approved'] ?? 0),
                'Rejected' => (int) ($byStatus['Rejected'] ?? 0),
                'Cancelled'=> (int) ($byStatus['Cancelled'] ?? 0),
            ];
        }

        if ($status && $status !== 'All') {
            $q->where('status', $status);
        }

        $perPage = (int) $request->integer('per_page');
        $total   = null;
        if ($perPage > 0) {
            $perPage = min($perPage, 100);
            $page    = max(1, (int) $request->integer('page'));
            $total   = (clone $q)->reorder()->count();
            $rows    = $q->forPage($page, $perPage)->get();
        } else {
            $rows = $q->get();
        }

        $canActScope = $this->hasAttendanceGrant($user, 'can_edit');
        $rows->each(function (AttendanceRegularization $row) use ($user, $canActScope) {
            $row->can_act_now = $row->status === 'Pending'
                && ($canActScope || $this->isReportingManager($user, $row));
        });

        $this->attachOriginalPunches($rows);

        $rows->each(function (AttendanceRegularization $row) {
            foreach ([$row->employee, $row->employee?->reportingManager] as $e) {
                $e?->makeHidden([
                    'photo_url', 'face_registered', 'profile_completion',
                    'other_assets_resolved', 'ancillary_roles_resolved', 'encrypted_id',
                ]);
            }
        });

        return response()->json(
            ['data' => $rows]
            + ($total  !== null ? ['total'  => $total]  : [])
            + ($counts !== null ? ['counts' => $counts] : [])
        );
    }

    private function existingPunchPairs(Employee $employee, string $dateStr): array
    {
        $rows = AttendancePunch::query()
            ->join('attendances', 'attendances.id', '=', 'attendance_punches.attendance_id')
            ->where('attendances.employee_id', $employee->id)
            ->whereDate('attendances.attendance_date', $dateStr)
            ->whereNull('attendance_punches.deleted_at')
            ->orderBy('attendance_punches.punched_at')
            ->get(['attendance_punches.punched_at', 'attendance_punches.direction']);

        $pairs = [];
        $open  = null;
        foreach ($rows as $r) {
            $t = Carbon::parse($r->punched_at, 'UTC')->setTimezone(self::DISPLAY_TZ)->format('H:i');
            if ($r->direction === 'in') {
                if ($open !== null) $pairs[] = ['in' => $open, 'out' => null];
                $open = $t;
            } else {
                $pairs[] = ['in' => $open, 'out' => $t];
                $open = null;
            }
        }
        if ($open !== null) $pairs[] = ['in' => $open, 'out' => null];

        return $pairs;
    }

    private function mergeRequestedChange(array $base, array $intended, array $current, Employee $employee): array
    {
        $inOf  = fn ($p) => trim((string) ($p['in'] ?? ''));
        $outOf = fn ($p) => trim((string) ($p['out'] ?? ''));
        $pair  = fn (string $in, string $out) => ['in' => $in, 'out' => $out === '' ? null : $out];

        $baseBy = [];
        foreach ($base as $p) {
            if ($inOf($p) !== '') $baseBy[$inOf($p)] = $p;
        }
        $intendedKeys = [];
        foreach ($intended as $p) {
            if ($inOf($p) !== '') $intendedKeys[$inOf($p)] = true;
        }

        $merged = [];
        foreach ($current as $p) {
            $k = $inOf($p);
            if ($k === '') continue;
            if (isset($baseBy[$k]) && !isset($intendedKeys[$k])) continue;
            $merged[$k] = $pair($k, $outOf($p));
        }

        foreach ($intended as $p) {
            $k = $inOf($p);
            if ($k === '') continue;
            $b = $baseBy[$k] ?? null;
            if ($b !== null && $outOf($b) === $outOf($p)) continue;
            $merged[$k] = $pair($k, $outOf($p));
        }

        [$sMin, $eMin] = $this->shiftBoundsFor($employee);
        $at = function (string $t) use ($sMin, $eMin): int {
            $m = $this->toMinutes($t);
            return $m === null ? 0 : ($this->nearestToWindow($m, $sMin, $eMin) ?? $m);
        };

        $merged = array_values($merged);
        usort($merged, fn ($a, $b) => $at($a['in']) <=> $at($b['in']));

        for ($i = 1; $i < count($merged); $i++) {
            $prevEnd = $at($merged[$i - 1]['out'] ?? $merged[$i - 1]['in']);
            if ($at($merged[$i]['in']) < $prevEnd) {
                Log::warning('[regularization] merged day has overlapping stretches — a punch may be dropped', [
                    'employee_id' => $employee->id,
                    'merged'      => $merged,
                ]);
                break;
            }
        }

        return $merged;
    }

    private function attachOriginalPunches($rows): void
    {
        $pending = $rows->filter(fn($r) => empty($r->original_punches));
        if ($pending->isEmpty()) {
            $rows->each(fn($r) => $r->original_display = $r->original_summary);
            return;
        }

        $empIds = $pending->pluck('employee_id')->unique()->values()->all();
        $dates  = $pending->map(fn($r) => Carbon::parse((string) $r->regularization_date)->toDateString())
            ->unique()->values()->all();

        $punchesByKey = [];
        AttendancePunch::query()
            ->join('attendances', 'attendances.id', '=', 'attendance_punches.attendance_id')
            ->whereIn('attendances.employee_id', $empIds ?: [0])
            ->whereIn('attendances.attendance_date', $dates ?: ['1970-01-01'])
            ->whereNull('attendance_punches.deleted_at')
            ->orderBy('attendance_punches.punched_at')
            ->get([
                'attendances.employee_id',
                'attendances.attendance_date',
                'attendance_punches.punched_at',
                'attendance_punches.direction',
                'attendance_punches.label',
                'attendance_punches.method',
            ])
            ->each(function ($p) use (&$punchesByKey) {
                $key = $p->employee_id . '|' . Carbon::parse($p->attendance_date)->toDateString();
                $punchesByKey[$key][] = [
                    'time'      => Carbon::parse($p->punched_at, 'UTC')
                        ->setTimezone(self::DISPLAY_TZ)->format('H:i'),
                    'direction' => $p->direction,
                    'label'     => $p->label,
                    'method'    => $p->method,
                ];
            });

        $rows->each(function (AttendanceRegularization $row) use ($punchesByKey) {
            if (!empty($row->original_punches)) {
                $row->original_display = $row->original_summary;
                return;
            }
            $key  = $row->employee_id . '|' . Carbon::parse((string) $row->regularization_date)->toDateString();
            $live = $punchesByKey[$key] ?? [];
            $row->original_punches_live = $live;

            $firstIn = collect($live)->firstWhere('direction', 'in')['time'] ?? null;
            $lastOut = collect($live)->where('direction', 'out')->last()['time'] ?? null;
            $row->original_display = $live
                ? (($firstIn ?? '—') . ' – ' . ($lastOut ?? '—'))
                : 'No punches (absent)';
        });
    }

    public function approve(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Rejected');
    }

    public function cancel(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);

        $isOwner = Employee::where('id', $row->employee_id)->where('user_id', $user->id)->exists();
        if (!$isOwner && !$this->hasAttendanceGrant($user, 'can_edit')) {
            abort(403, 'You can only cancel your own regularization requests.');
        }
        if ($row->status !== 'Pending') {
            abort(422, 'Only Pending requests can be cancelled.');
        }
        $row->status = 'Cancelled';
        $row->save();

        return response()->json(['data' => $row]);
    }

    private function setStatus(Request $request, int $id, string $next)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);
        if ($row->status !== 'Pending') {
            abort(422, "Regularization request is already {$row->status}.");
        }
        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);

        $isAdminScope = $this->hasAttendanceGrant($user, 'can_edit');
        if (!$isAdminScope && !$this->isReportingManager($user, $row)) {
            abort(403, 'You cannot act on this regularization request — only the reporting manager or HR can.');
        }

        if (!$isAdminScope && $next === 'Approved') {
            $ownEmployeeId = (int) ($user->employee_id ?? 0);
            if ($ownEmployeeId && (int) $row->employee_id === $ownEmployeeId) {
                abort(403, 'You cannot approve your own regularization request.');
            }
            if ($row->created_by && (int) $row->created_by === (int) $user->id) {
                abort(403, 'You raised this request, so someone else has to approve it.');
            }
        }

        if ($next === 'Approved') {
            $emp = Employee::withTrashed()->find($row->employee_id);
            $dStr = $row->regularization_date instanceof \Carbon\CarbonInterface
                ? $row->regularization_date->toDateString()
                : Carbon::parse((string) $row->regularization_date)->toDateString();
            if ($emp && ($closed = $this->employmentClosedReason($emp, $dStr))) {
                abort(422, $closed . ' Reject this request to clear it from the queue.');
            }
            if ($emp && $this->payrollLocked($emp, $dStr)) {
                abort(422, 'Payroll for ' . Carbon::parse($dStr)->format('F Y')
                    . ' has been processed and locked since this request was raised — it can no longer be approved.'
                    . ' Reject it and post an adjustment in the next payroll cycle.');
            }
        }

        $chain = $row->approval_chain ?? [];
        $level = max(1, (int) ($row->current_approval_level ?? 1));
        if (isset($chain[$level - 1])) {
            $chain[$level - 1]['status']   = $next;
            $chain[$level - 1]['acted_by'] = $user->id;
            $chain[$level - 1]['acted_at'] = now()->toISOString();
            $chain[$level - 1]['comment']  = $data['comment'] ?? null;
        }

        if ($next === 'Rejected') {
            for ($i = $level; $i < count($chain); $i++) {
                $st = $chain[$i]['status'] ?? 'Pending';
                if (!in_array($st, ['Approved', 'Rejected'], true)) {
                    $chain[$i]['status'] = 'Skipped';
                }
            }
            $row->approval_chain   = $chain;
            $row->status           = 'Rejected';
            $row->approved_by      = $user->id;
            $row->approved_at      = now();
            $row->approver_comment = $data['comment'] ?? null;
        } else {
            $row->approval_chain = $chain;
            $nextLevel = $this->firstActionableLevel($chain, $level + 1);
            if ($nextLevel > count($chain)) {
                $row->status           = 'Approved';
                $row->approved_by      = $user->id;
                $row->approved_at      = now();
                $row->approver_comment = $data['comment'] ?? null;
            } else {
                $row->current_approval_level = $nextLevel;
            }
        }
        $row->save();

        if ($row->status === 'Approved') {
            $this->applyApprovedAdjustment($row);
        }

        return response()->json(array_filter([
            'data'    => $row->fresh('approver:id,name'),
            'message' => $this->payslipRefreshNotice,
        ], fn ($v) => $v !== null));
    }

    private function employmentClosedReason(Employee $employee, string $dateStr): ?string
    {
        $exit = \App\Models\EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->whereNotNull('last_working_day')
            ->orderByDesc('last_working_day')
            ->first();

        if ($exit) {
            $lwd      = Carbon::parse($exit->last_working_day);
            $isClosed = (string) ($exit->exit_case_status ?? 'Open') === 'Closed';

            if ($isClosed) {
                return 'This employee left on ' . $lwd->format('j M Y')
                    . ' — attendance for an exited employee can no longer be regularized,'
                    . ' their Full & Final is priced off the record as it stands.';
            }

            if ($dateStr > $lwd->toDateString()) {
                return 'This employee\'s last working day is ' . $lwd->format('j M Y')
                    . ' — attendance after that date cannot be regularized.'
                    . ' Days up to and including their last working day can still be corrected'
                    . ' while the exit is in progress.';
            }

            return null;
        }

        if ($employee->deleted_at) {
            return 'This employee was removed from Employee Management on '
                . $employee->deleted_at->format('j M Y')
                . ' — their attendance record is closed and can no longer be regularized.';
        }

        return null;
    }

    private function payrollLocked(Employee $employee, string $dateStr): bool
    {
        $when = Carbon::parse($dateStr);
        $bId  = $employee->branch_id;

        return \App\Models\PayrollPeriod::query()
            ->where('client_id', $employee->client_id)
            ->where(fn($w) => $bId
                ? $w->where('branch_id', $bId)->orWhereNull('branch_id')
                : $w->whereNull('branch_id'))
            ->where('month', (int) $when->month)
            ->where('year', (int) $when->year)
            ->where('status', 'locked')
            ->exists();
    }

    private function applyApprovedExemption(AttendanceRegularization $row, Employee $employee, string $dateStr): void
    {
        $type   = strtolower(trim((string) ($row->type ?? '')));
        $status = (str_contains($type, 'work from home') || str_contains($type, 'wfh'))
            ? 'Work From Home'
            : 'On Duty';

        $restKind = app(\App\Services\PayrollService::class)
            ->restDayKind($employee, Carbon::parse($dateStr));
        if ($restKind !== null) {
            $status = $restKind;
        }

        $attendance = Attendance::where('employee_id', $employee->id)
            ->whereDate('attendance_date', $dateStr)
            ->lockForUpdate()
            ->first();

        if (!$attendance) {
            [$stampStart, $stampEnd] = $employee->resolveShiftWindow();
            $attendance = Attendance::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'user_id'         => $employee->user_id,
                'employee_id'     => $employee->id,
                'attendance_date' => $dateStr,
                'status'          => $status,
                'shift_name'      => trim((string) ($employee->shift ?? '')) ?: null,
                'shift_start'     => $stampStart,
                'shift_end'       => $stampEnd,
            ]);
        } else {
            if (empty($row->original_summary)) {
                $row->forceFill(['original_summary' => 'Status was: ' . ($attendance->status ?: '—')])->save();
            }
            $attendance->update(['status' => $status]);
        }

        if ((int) $row->attendance_id !== (int) $attendance->id) {
            $row->forceFill(['attendance_id' => $attendance->id])->save();
        }
    }

    private function applyApprovedAdjustment(AttendanceRegularization $row): void
    {
        $isExempt = $row->mode === 'exempt';
        $punches  = is_array($row->punches) ? $row->punches : [];
        if (!$isExempt && ($row->mode !== 'adjust' || empty($punches))) return;

        $employee = Employee::find($row->employee_id);
        if (!$employee) return;

        $dateStr = $row->regularization_date instanceof \Carbon\CarbonInterface
            ? $row->regularization_date->toDateString()
            : Carbon::parse((string) $row->regularization_date)->toDateString();

        if ($this->payrollLocked($employee, $dateStr)) {
            Log::warning('[regularization] apply skipped — payroll locked for the period', [
                'request_id' => $row->id,
                'employee_id' => $employee->id,
                'date' => $dateStr,
            ]);
            return;
        }

        if (!$isExempt) {
            $bounded = $this->boundPunchesToShift($punches, $employee);
            if (empty($bounded['punches'])) {
                Log::warning('[regularization] apply skipped — punches fall entirely outside the shift', [
                    'request_id' => $row->id,
                    'employee_id' => $employee->id,
                    'window' => $bounded['window'],
                ]);
                return;
            }
            if ($bounded['trimmed']) {
                Log::info('[regularization] punches trimmed to shift window on apply', [
                    'request_id' => $row->id,
                    'window' => $bounded['window'],
                ]);
            }
            $punches = $bounded['punches'];
        }

        if ($isExempt) {
            try {
                DB::transaction(fn() => $this->applyApprovedExemption($row, $employee, $dateStr));
            } catch (\Throwable $e) {
                Log::warning('[regularization] apply-exemption failed', [
                    'request_id' => $row->id,
                    'error'      => $e->getMessage(),
                ]);
                return;
            }
            $this->refreshPayslipsAfterApply($row, (int) $employee->id);
            return;
        }

        try {
            DB::transaction(function () use ($row, $employee, $dateStr, $punches) {
                $attendance = Attendance::where('employee_id', $employee->id)
                    ->whereDate('attendance_date', $dateStr)
                    ->lockForUpdate()
                    ->first();
                $restKind  = app(\App\Services\PayrollService::class)
                    ->restDayKind($employee, Carbon::parse($dateStr));
                $dayStatus = $restKind ?? 'Present';

                if (!$attendance) {
                    [$stampStart, $stampEnd] = $employee->resolveShiftWindow();
                    $attendance = Attendance::create([
                        'client_id'       => $employee->client_id,
                        'branch_id'       => $employee->branch_id,
                        'user_id'         => $employee->user_id,
                        'employee_id'     => $employee->id,
                        'attendance_date' => $dateStr,
                        'status'          => $dayStatus,
                        'shift_name'      => trim((string) ($employee->shift ?? '')) ?: null,
                        'shift_start'     => $stampStart,
                        'shift_end'       => $stampEnd,
                    ]);
                }

                if (empty($row->original_punches)) {
                    $existing = AttendancePunch::where('attendance_id', $attendance->id)
                        ->orderBy('punched_at')->get();
                    $snapshot = $existing->map(fn($p) => [
                        'time'      => Carbon::parse($p->punched_at, 'UTC')
                            ->setTimezone(self::DISPLAY_TZ)->format('H:i'),
                        'direction' => $p->direction,
                        'label'     => $p->label,
                        'method'    => $p->method,
                    ])->values()->all();

                    $firstInT = collect($snapshot)->firstWhere('direction', 'in')['time'] ?? null;
                    $lastOutT = collect($snapshot)->where('direction', 'out')->last()['time'] ?? null;

                    $row->forceFill([
                        'original_punches' => $snapshot,
                        'original_summary' => $snapshot
                            ? trim(($firstInT ?? '—') . ' – ' . ($lastOutT ?? '—'))
                            : 'No punches (absent)',
                    ])->save();
                }

                $punches = is_array($row->base_punches)
                    ? $this->mergeRequestedChange(
                        $row->base_punches,
                        $punches,
                        $this->existingPunchPairs($employee, $dateStr),
                        $employee,
                    )
                    : $punches;

                AttendancePunch::where('attendance_id', $attendance->id)->delete();

                [$sMin, $eMin] = $this->shiftBoundsFor($employee);
                $overnight     = $eMin > 1440;

                $events = [];
                foreach ($punches as $p) {
                    foreach (['in', 'out'] as $dir) {
                        $t = trim((string) ($p[$dir] ?? ''));
                        if ($t === '' || !preg_match('/^\d{1,2}:\d{2}$/', $t)) continue;
                        $at = Carbon::parse("$dateStr $t", self::DISPLAY_TZ);
                        if (
                            $overnight
                            && ($this->nearestToWindow($this->toMinutes($t), $sMin, $eMin) ?? 0) >= 1440
                        ) {
                            $at->addDay();
                        }
                        $events[] = [
                            'ts'  => $at->setTimezone('UTC'),
                            'dir' => $dir,
                        ];
                    }
                }
                usort($events, fn($a, $b) => $a['ts']->getTimestamp() <=> $b['ts']->getTimestamp());

                $lastOutIdx = -1;
                foreach ($events as $i => $e) {
                    if ($e['dir'] === 'out') $lastOutIdx = $i;
                }

                $seq = 0;
                $lastDir = null;
                foreach ($events as $i => $e) {
                    if ($lastDir !== null && $e['dir'] === $lastDir) continue;

                    $label = $e['dir'] === 'in'
                        ? ($seq === 0 ? 'Check In' : 'Step In')
                        : ($i === $lastOutIdx ? 'Check Out' : 'Step Out');

                    AttendancePunch::create([
                        'attendance_id' => $attendance->id,
                        'employee_id'   => $employee->id,
                        'punched_at'    => $e['ts'],
                        'direction'     => $e['dir'],
                        'label'         => $label,
                        'method'        => 'manual',
                        'notes'         => "Regularized (request #{$row->id})",
                    ]);
                    $lastDir = $e['dir'];
                    $seq++;
                }

                $firstIn = AttendancePunch::where('attendance_id', $attendance->id)
                    ->where('direction', 'in')->orderBy('punched_at')->first();
                $lastOut = AttendancePunch::where('attendance_id', $attendance->id)
                    ->where('direction', 'out')->orderByDesc('punched_at')->first();
                $attendance->update([
                    'check_in_at'      => $firstIn?->punched_at,
                    'check_in_method'  => $firstIn?->method,
                    'check_out_at'     => $lastOut?->punched_at,
                    'check_out_method' => $lastOut?->method,
                    'status'           => $dayStatus,
                ]);

                if ((int) $row->attendance_id !== (int) $attendance->id) {
                    $row->forceFill(['attendance_id' => $attendance->id])->save();
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[regularization] apply-to-attendance failed', [
                'request_id' => $row->id,
                'error'      => $e->getMessage(),
            ]);
            return;
        }

        $this->refreshPayslipsAfterApply($row, (int) $employee->id);
    }

    private function refreshPayslipsAfterApply(AttendanceRegularization $row, int $employeeId): void
    {
        try {
            $recomputed = app(\App\Services\PayrollService::class)->recomputeEmployeePayslips($employeeId);

            $date = $row->regularization_date;
            $frozen = $date
                ? \App\Models\Payslip::where('employee_id', $employeeId)
                    ->whereHas('period', fn ($q) => $q
                        ->where('month', (int) $date->month)
                        ->where('year', (int) $date->year))
                    ->whereHas('run', fn ($q) => $q->whereNotIn('status', ['draft', 'generated']))
                    ->with('period')
                    ->get()
                    ->map(fn ($s) => $s->period?->label)
                    ->filter()->unique()->values()
                : collect();

            $this->payslipRefreshNotice = $frozen->isNotEmpty()
                ? 'Attendance updated, but payroll for ' . $frozen->implode(', ')
                    . ' is already approved and keeps its original figures — reopen that cycle'
                    . ' and re-run payroll for the correction to reach the salary.'
                : ($recomputed > 0 ? "{$recomputed} draft payslip(s) updated." : null);
        } catch (\Throwable $e) {
            Log::warning('[regularization] payslip recompute after apply failed', [
                'request_id' => $row->id,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    public function approvers(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findScopedOrFail($id, $user);
        $chain = $row->approval_chain ?? [];

        $employeeIds = collect($chain)->pluck('approver_employee_id')->filter()->unique()->all();
        $employees = Employee::with('user:id,name,email')
            ->whereIn('id', $employeeIds)
            ->get()->keyBy('id');
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
                'level'       => $entry['level'] ?? ($i + 1),
                'role'        => $entry['approver_role'] ?? 'Reporting Manager',
                'kind'        => $entry['approver_kind'] ?? 'reporting_manager',
                'employee_id' => $empId,
                'name'        => $name,
                'email'       => $emp?->email ?? $u?->email,
                'status'      => $entry['status'] ?? 'Pending',
                'acted_at'    => $entry['acted_at'] ?? null,
                'comment'     => $entry['comment'] ?? null,
                'is_current'  => ($i + 1) === (int) ($row->current_approval_level ?? 1)
                    && $row->status === 'Pending',
            ];
        }

        return response()->json(['data' => $out]);
    }

    private function shiftBoundsFor(Employee $employee): array
    {
        [$start, $end] = $employee->resolveShiftWindow();
        $start = $this->toMinutes((string) $start) !== null ? (string) $start : self::DEFAULT_SHIFT[0];
        $end   = $this->toMinutes((string) $end)   !== null ? (string) $end   : self::DEFAULT_SHIFT[1];

        $sMin = (int) $this->toMinutes($start);
        $eMin = (int) $this->toMinutes($end);
        if ($eMin <= $sMin) {
            $eMin += 1440;
        }

        return [$sMin, $eMin, $start, $end];
    }

    private function toMinutes(string $t): ?int
    {
        if (!preg_match('/^(\d{1,2}):(\d{2})$/', trim($t), $m)) {
            return null;
        }
        $h = (int) $m[1];
        $i = (int) $m[2];
        if ($h > 23 || $i > 59) {
            return null;
        }
        return $h * 60 + $i;
    }

    private function nearestToWindow(?int $min, int $sMin, int $eMin): ?int
    {
        if ($min === null) {
            return null;
        }
        $distance = fn(int $v) => $v < $sMin ? $sMin - $v : ($v > $eMin ? $v - $eMin : 0);

        return $distance($min + 1440) < $distance($min) ? $min + 1440 : $min;
    }

    private function toHhmm(int $min): string
    {
        $min = (($min % 1440) + 1440) % 1440;
        return sprintf('%02d:%02d', intdiv($min, 60), $min % 60);
    }

    private function boundPunchesToShift(array $punches, Employee $employee): array
    {
        [$sMin, $eMin, $sLabel, $eLabel] = $this->shiftBoundsFor($employee);

        $out     = [];
        $trimmed = false;
        $dropped = 0;

        foreach ($punches as $p) {
            $inMin  = $p['in']  !== null ? $this->toMinutes((string) $p['in'])  : null;
            $outMin = $p['out'] !== null ? $this->toMinutes((string) $p['out']) : null;

            if ($eMin > 1440) {
                $inMin  = $this->nearestToWindow($inMin,  $sMin, $eMin);
                $outMin = $this->nearestToWindow($outMin, $sMin, $eMin);
            }

            if ($inMin === null && $outMin === null) {
                $dropped++;
                $trimmed = true;
                continue;
            }

            if ($inMin !== null && $outMin !== null && ($outMin <= $sMin || $inMin >= $eMin)) {
                $dropped++;
                $trimmed = true;
                continue;
            }

            $clampedIn  = $inMin  !== null ? min(max($inMin,  $sMin), $eMin) : null;
            $clampedOut = $outMin !== null ? min(max($outMin, $sMin), $eMin) : null;

            if ($clampedIn !== $inMin || $clampedOut !== $outMin) {
                $trimmed = true;
            }

            if ($clampedIn !== null && $clampedOut !== null && $clampedOut <= $clampedIn) {
                $dropped++;
                $trimmed = true;
                continue;
            }

            $out[] = [
                'in'  => $clampedIn  !== null ? $this->toHhmm($clampedIn)  : null,
                'out' => $clampedOut !== null ? $this->toHhmm($clampedOut) : null,
            ];
        }

        return [
            'punches' => $out,
            'trimmed' => $trimmed,
            'dropped' => $dropped,
            'window'  => $sLabel . ' – ' . $eLabel,
        ];
    }

    private function snapshotApprovalChain(Employee $employee): array
    {
        $resolvedEmpId  = $employee->reporting_manager_id;
        $resolvedUserId = null;
        if (!$resolvedEmpId) {
            $resolvedUserId = $employee->reporting_manager_user_id;
        }

        $skip = false;
        $skipReason = null;
        if ($resolvedEmpId && (int) $resolvedEmpId === (int) $employee->id) {
            $skip = true;
            $skipReason = 'Auto-skipped — approver resolves to the requester (self-loop)';
        } elseif ($resolvedUserId && (int) $resolvedUserId === (int) ($employee->user_id ?? 0)) {
            $skip = true;
            $skipReason = 'Auto-skipped — approver resolves to the requester (self-loop)';
        } elseif (!$resolvedEmpId && !$resolvedUserId) {
            $skip = true;
            $skipReason = 'Auto-skipped — no reporting manager assigned';
        } elseif ($resolvedEmpId && !Employee::where('id', $resolvedEmpId)->exists()) {
            $skip = true;
            $skipReason = "Auto-skipped — approver employee #{$resolvedEmpId} no longer exists";
        }

        return [[
            'level'                => 1,
            'approver_kind'        => 'reporting_manager',
            'approver_role'        => 'Reporting Manager',
            'approver_user_id'     => $resolvedUserId,
            'approver_employee_id' => $resolvedEmpId,
            'approver_label'       => null,
            'status'               => $skip ? 'Skipped' : 'Pending',
            'acted_by'             => null,
            'acted_at'             => null,
            'comment'              => $skipReason,
        ]];
    }

    private function firstActionableLevel(array $chain, int $start): int
    {
        $i = max(1, $start);
        while ($i <= count($chain)) {
            if (($chain[$i - 1]['status'] ?? 'Pending') === 'Pending') return $i;
            $i++;
        }
        return count($chain) + 1;
    }

    private function hasAttendanceGrant($user, string $perm = 'can_add'): bool
    {
        if (!$user) return false;

        if ($user->user_type === 'super_admin') return true;

        $moduleId = \App\Models\Module::where('slug', 'hr.attendance')->value('id');
        if (!$moduleId) return false;

        $row = \App\Models\Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->first();

        if (!$row) {
            return in_array($user->user_type, self::ADMIN_TYPES, true);
        }

        return (bool) $row->{$perm};
    }

    private function isReportingManager($user, AttendanceRegularization $row): bool
    {
        $emp = Employee::find($row->employee_id);
        if (!$emp) return false;
        if ($emp->reporting_manager_user_id && (int) $emp->reporting_manager_user_id === (int) $user->id) {
            return true;
        }
        if ($emp->reporting_manager_id) {
            $myEmpId = $user->employee_id;
            if ($myEmpId && (int) $emp->reporting_manager_id === (int) $myEmpId) return true;
        }
        return false;
    }

    private function findScopedOrFail(int $id, $user): AttendanceRegularization
    {
        $row = AttendanceRegularization::findOrFail($id);
        if (
            $user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $row->client_id !== (int) $user->client_id
        ) {
            abort(404);
        }

        if (
            in_array($user->user_type, ['branch_user', 'employee'], true)
            && $user->branch_id
        ) {
            $empBranchId = Employee::withTrashed()
                ->where('id', $row->employee_id)
                ->value('branch_id');

            if ((int) $empBranchId !== (int) $user->branch_id) {
                $myEmployeeId = $user->employee_id;
                $isOwn = $myEmployeeId && (int) $row->employee_id === (int) $myEmployeeId;
                if (!$isOwn && !$this->isReportingManager($user, $row)) {
                    abort(404);
                }
            }
        }

        return $row;
    }
}
