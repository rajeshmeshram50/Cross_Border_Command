<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\Recruitment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class RecruitmentController extends Controller
{
    private const DEFAULT_PER_PAGE = 25;
    private const MAX_PER_PAGE     = 200;

    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
        'department:id,name,code',
        'designation:id,name',
        'primaryRole:id,name',
        'hiringManager:id,emp_code,display_name,first_name,last_name,status,deleted_at',
        'assignedHr:id,emp_code,display_name,first_name,last_name,status,deleted_at',
    ];

    private const MODULE_SLUG = 'hr.recruitment';

    private const EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Contract', 'Internship'];
    private const WORK_MODES       = ['On-site', 'Remote', 'Hybrid', 'Flexible'];
    private const PRIORITIES       = ['Critical', 'High', 'Medium', 'Low'];
    private const STATUSES         = ['In Progress', 'Completed', 'Cancelled', 'Expired'];

    private const TITLE_REGEX = 'regex:/^[A-Za-z0-9 .,\/&()+\-\x27\x{2019}%:;\x{2013}\x{2014}]+$/u';
    private const HAS_LETTER  = 'regex:/[A-Za-z]/';

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $branchFilter = $request->integer('branch_id') ?: null;
        $this->expireOverdue($request->user(), $branchFilter);

        $q = Recruitment::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $branchFilter);

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('job_title', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%");
            });
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }
        if ($dept = $request->query('department_id')) {
            $q->where('department_id', $dept);
        }
        if ($priority = $request->query('priority')) {
            $q->where('priority', $priority);
        }
        if ($empType = $request->query('employment_type')) {
            $q->where('employment_type', $empType);
        }

        $q->orderByDesc('id');

        if ($request->has('per_page') || $request->has('page')) {
            $requested = $request->query('per_page');
            $perPage = is_numeric($requested) && (int) $requested > 0
                ? min(self::MAX_PER_PAGE, (int) $requested)
                : self::DEFAULT_PER_PAGE;

            return response()->json($q->paginate($perPage));
        }

        return response()->json($q->get());
    }

    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $branchFilter = $request->integer('branch_id') ?: null;
        $this->expireOverdue($request->user(), $branchFilter);

        $q = Recruitment::query();
        $this->applyScope($q, $request->user(), $branchFilter);

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('job_title', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%");
            });
        }

        $row = $q->selectRaw("
            COUNT(*)                                                          AS total,
            SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END)           AS in_progress,
            SUM(CASE WHEN status = 'Completed'   THEN 1 ELSE 0 END)           AS completed,
            SUM(CASE WHEN status = 'Cancelled'   THEN 1 ELSE 0 END)           AS cancelled,
            SUM(CASE WHEN status = 'Expired'     THEN 1 ELSE 0 END)           AS expired,
            COUNT(DISTINCT hiring_request_id)                                 AS converted
        ")->first();

        return response()->json([
            'total'      => (int) ($row->total ?? 0),
            'inProgress' => (int) ($row->in_progress ?? 0),
            'completed'  => (int) ($row->completed ?? 0),
            'cancelled'  => (int) ($row->cancelled ?? 0),
            'expired'    => (int) ($row->expired ?? 0),
            'converted'  => (int) ($row->converted ?? 0),
        ]);
    }

    public function linkedHiringRequests(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Recruitment::query()->whereNotNull('hiring_request_id');
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        return response()->json(
            $q->distinct()
                ->pluck('hiring_request_id')
                ->map(fn ($v) => (int) $v)
                ->values(),
        );
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($row);
    }

    public function nextCode(Request $request)
    {
        $this->authorize($request, 'can_view');
        [$clientId, $branchId] = $this->resolveOwnership($request);

        $code = $this->peekNextCode($clientId, $branchId);
        return response()->json(['code' => $code, 'prefix' => 'REC-']);
    }

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            [$clientId, $branchId] = $this->resolveOwnership($request);

            $this->guardDuplicate($data, $clientId, $branchId, null);

            $payload = array_merge($data, [
                'client_id'  => $clientId,
                'branch_id'  => $branchId,
                'created_by' => $auth?->id,
                'code'       => $this->allocateCode($clientId, $branchId),
                'status'     => $data['status'] ?? 'In Progress',
            ]);
            $row = Recruitment::create($payload);
            $row->load(self::WITH);

            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);
        $this->guardDuplicate($data, $row->client_id, $row->branch_id, $row->id, $row);
        $this->guardStatusTransition($row, $data);
        $this->reconcileExpiryStatus($data, $row);

        $row->update($data);

        $row->load(self::WITH);
        return response()->json($row);
    }

    private function guardStatusTransition(Recruitment $row, array $data): void
    {
        $newStatus = $data['status'] ?? null;
        if ($newStatus === null || $newStatus === $row->status) return;

        if ($newStatus === 'Completed') {
            $selected = \App\Models\Candidate::query()
                ->where('recruitment_id', $row->id)
                ->where('status', 'Selected')
                ->count();
            $required = (int) $row->openings;
            if ($selected < $required) {
                throw ValidationException::withMessages([
                    'status' => [sprintf(
                        'Cannot mark as Completed — only %d of %d opening(s) filled. Select %d more candidate(s) first.',
                        $selected,
                        $required,
                        max(0, $required - $selected),
                    )],
                ]);
            }
        }
    }

    private function guardDuplicate(array $data, $clientId, $branchId, ?int $excludeId, ?Recruitment $existing = null): void
    {
        $val = function (string $key) use ($data, $existing) {
            if (array_key_exists($key, $data)) return $data[$key];
            return $existing?->{$key};
        };

        $title  = trim((string) ($val('job_title') ?? ''));
        $deptId = $val('department_id');
        if ($title === '' || $deptId === null) return;

        $norm = fn ($v) => mb_strtolower(trim((string) ($v ?? '')));
        $numNorm = fn ($v) => ($v === null || $v === '') ? 0 : (int) $v;

        $q = Recruitment::query()
            ->whereRaw('LOWER(job_title) = ?', [mb_strtolower($title)])
            ->where('department_id', $deptId)
            ->whereRaw('COALESCE(designation_id, 0) = ?',  [$numNorm($val('designation_id'))])
            ->whereRaw('COALESCE(primary_role_id, 0) = ?', [$numNorm($val('primary_role_id'))])
            ->whereRaw('COALESCE(openings, 0) = ?',        [$numNorm($val('openings'))])
            ->whereRaw('COALESCE(hiring_manager_id, 0) = ?', [$numNorm($val('hiring_manager_id'))])
            ->whereRaw('COALESCE(assigned_hr_id, 0) = ?',  [$numNorm($val('assigned_hr_id'))])
            ->whereRaw("LOWER(COALESCE(employment_type, '')) = ?", [$norm($val('employment_type'))])
            ->whereRaw("LOWER(COALESCE(experience, '')) = ?",      [$norm($val('experience'))])
            ->whereRaw("LOWER(COALESCE(qualification, '')) = ?",   [$norm($val('qualification'))])
            ->whereRaw("LOWER(COALESCE(work_mode, '')) = ?",       [$norm($val('work_mode'))])
            ->whereRaw("LOWER(COALESCE(ctc_range, '')) = ?",       [$norm($val('ctc_range'))])
            ->whereRaw("LOWER(COALESCE(priority, '')) = ?",        [$norm($val('priority'))])
            ->whereRaw("LOWER(COALESCE(job_description, '')) = ?", [$norm($val('job_description'))])
            ->whereRaw("LOWER(COALESCE(requirements, '')) = ?",    [$norm($val('requirements'))]);

        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        if ($excludeId !== null) $q->where('id', '!=', $excludeId);

        $dupe = $q->first(['id', 'code']);
        if ($dupe) {
            throw ValidationException::withMessages([
                'job_title' => [sprintf(
                    'This recruitment already exists (%s) — every detail matches an existing entry. Change a date (start date / deadline) or any other field to post a separate opening.',
                    $dupe->code ?: ('#' . $dupe->id),
                )],
            ]);
        }
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        $row->delete();
        return response()->json(['message' => 'Recruitment removed.']);
    }

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin())     return;
        if ($user->isClientAdmin())    return;

        $isReportingManager = \App\Models\Employee::query()
            ->where(function ($q) use ($user) {
                $q->where('reporting_manager_user_id', $user->id)
                  ->orWhereIn('reporting_manager_id', function ($sub) use ($user) {
                      $sub->select('id')
                          ->from('employees')
                          ->where('user_id', $user->id);
                  });
            })
            ->exists();
        if ($isReportingManager) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Recruitment module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
    }

    private function resolveOwnership(Request $request): array
    {
        $user = $request->user();
        if ($user && $user->user_type === 'super_admin') {
            return [$request->input('client_id'), $request->input('branch_id')];
        }
        if ($user && in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return [$user->client_id, null];
        }
        if ($user && in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return [$user->client_id, $user->branch_id];
        }
        return [null, null];
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
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

            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId) {
                      $ww->where('client_id', $clientId)->where(function ($wb) use ($branchId) {
                          $wb->whereNull('branch_id')->orWhere('branch_id', $branchId);
                      });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function resolveRow(Request $request, int $id): Recruitment
    {
        $q = Recruitment::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);
        return $this->maybeExpire($row);
    }

    private function expireOverdue($user, ?int $branchFilter = null): void
    {
        $q = Recruitment::query();
        $this->applyScope($q, $user, $branchFilter);
        $q->where('status', 'In Progress')
          ->whereNotNull('deadline')
          ->whereDate('deadline', '<', today())
          ->update(['status' => 'Expired']);
    }

    private function maybeExpire(Recruitment $row): Recruitment
    {
        if ($row->status === 'In Progress' && $row->deadline && $row->deadline->lt(today())) {
            $row->status = 'Expired';
            $row->save();
        }
        return $row;
    }

    private function reconcileExpiryStatus(array &$data, Recruitment $row): void
    {
        $effectiveStatus = $data['status'] ?? $row->status;
        if (!in_array($effectiveStatus, ['In Progress', 'Expired'], true)) return;

        $deadline = array_key_exists('deadline', $data) ? $data['deadline'] : $row->deadline;
        $overdue  = $deadline !== null
            && \Illuminate\Support\Carbon::parse($deadline)->lt(today());

        $data['status'] = $overdue ? 'Expired' : 'In Progress';
    }

    private function guardHierarchicalAction($user, Recruitment $row, string $verb): void
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
            abort(403, "You cannot {$verb} this recruitment — created by a higher-privileged user.");
        }
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $req = fn (string $extra = '') => ($isUpdate ? 'sometimes|' : '') . 'required' . ($extra ? "|{$extra}" : '');

        return $request->validate([
            'job_title'         => array_values(array_filter([
                $isUpdate ? 'sometimes' : null, 'required', 'string', 'max:191',
                self::TITLE_REGEX, self::HAS_LETTER,
            ])),
            'department_id'     => ($isUpdate ? 'sometimes|' : '') . 'required|integer|exists:master_departments,id',
            'designation_id'    => ($isUpdate ? 'sometimes|' : '') . 'required|integer|exists:master_designations,id',
            'primary_role_id'   => 'nullable|integer|exists:master_roles,id',
            'hiring_request_id' => 'nullable|integer|exists:hiring_requests,id',

            'employment_type'   => ['nullable', Rule::in(self::EMPLOYMENT_TYPES)],
            'openings'          => 'nullable|integer|min:1|max:9999',
            'experience'        => 'nullable|string|max:30',
            'qualification'     => 'nullable|string|max:255',
            'work_mode'         => ['nullable', Rule::in(self::WORK_MODES)],
            'ctc_range'         => ['nullable', 'string', 'max:50', 'regex:/^\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?$/'],
            'priority'          => ['nullable', Rule::in(self::PRIORITIES)],

            'hiring_manager_id' => ['nullable', 'integer', 'exists:employees,id', function ($attr, $value, $fail) {
                $emp = Employee::with('designation:id,level')->find($value);
                if (EmployeeController::isTrainee($emp)) {
                    $fail('An intern or trainee cannot be set as the Hiring Manager.');
                }
            }],
            'assigned_hr_id'    => 'nullable|integer|exists:employees,id',
            'start_date'        => 'nullable|date',
            'deadline'          => 'nullable|date|after:start_date',

            'job_description'   => 'nullable|string',
            'requirements'      => 'nullable|string',

            'post_on_portal'        => 'nullable|boolean',
            'notify_team_leads'     => 'nullable|boolean',
            'enable_referral_bonus' => 'nullable|boolean',

            'status'        => ['nullable', Rule::in(self::STATUSES)],
            'cancel_reason' => 'nullable|string|max:100',
            'cancel_notes'  => 'nullable|string',
        ], [
            'job_title.regex' => 'Job title cannot contain special characters — use only letters, numbers, spaces and - . , /',
            'ctc_range.regex' => 'Enter a valid CTC range — a number or min-max, e.g. 8 or 8-12 (no multiple hyphens).',
        ]);
    }

    private function allocateCode($clientId, $branchId): string
    {
        $q = Recruitment::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        return $this->buildNext($q->pluck('code'));
    }

    private function peekNextCode($clientId, $branchId): string
    {
        $q = Recruitment::query()->withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        return $this->buildNext($q->pluck('code'));
    }

    private function buildNext($codes): string
    {
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^REC-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'REC-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }
}
