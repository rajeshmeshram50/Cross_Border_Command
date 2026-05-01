<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Module;
use App\Models\Permission;
use App\Models\Recruitment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RecruitmentController extends Controller
{
    /**
     * Eager-loads used by every read endpoint so the SPA gets nested names
     * (department.name, designation.name, hiringManager.display_name, …)
     * without extra round-trips. Mirrors EmployeeController::WITH.
     */
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
        'creator:id,name,user_type',
        'department:id,name,code',
        'designation:id,name',
        'primaryRole:id,name',
        'hiringManager:id,emp_code,display_name,first_name,last_name',
        'assignedHr:id,emp_code,display_name,first_name,last_name',
    ];

    /** Module slug used for permission checks — matches ModuleSeeder. */
    private const MODULE_SLUG = 'hr.recruitment';

    /** Whitelisted enum values — keep in sync with the frontend dropdowns. */
    private const EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Contract', 'Internship'];
    private const WORK_MODES       = ['On-site', 'Remote', 'Hybrid', 'Flexible'];
    private const PRIORITIES       = ['Critical', 'High', 'Medium', 'Low'];
    private const STATUSES         = ['In Progress', 'Completed', 'Cancelled'];

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Recruitment::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

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

        return response()->json($q->orderByDesc('id')->get());
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($row);
    }

    /**
     * Returns the next REC-### code for the tenant the new row would be
     * stamped under. Sequence is isolated per (client_id, branch_id) just
     * like employees and the auto-coded master tables.
     */
    public function nextCode(Request $request)
    {
        $this->authorize($request, 'can_view');
        [$clientId, $branchId] = $this->resolveOwnership($request);

        $code = $this->peekNextCode($clientId, $branchId);
        return response()->json(['code' => $code, 'prefix' => 'REC-']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  STORE / UPDATE / DESTROY
     * ───────────────────────────────────────────────────────────────── */

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            [$clientId, $branchId] = $this->resolveOwnership($request);

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
        $row->update($data);

        $row->load(self::WITH);
        return response()->json($row);
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        $row->delete();
        return response()->json(['message' => 'Recruitment removed.']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS — mirror EmployeeController/MasterController patterns
     * ───────────────────────────────────────────────────────────────── */

    /** Cap the granular permission check to the 'hr.recruitment' module. */
    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            // First-run: module row not seeded yet. Fall back to plan-default
            // (allow client_admin / branch_user; deny others).
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Recruitment module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
    }

    /** Pick (client_id, branch_id) for a new row. */
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

    /** Tenant scoping — same rules used everywhere else. */
    private function applyScope($q, $user): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                return;
            }

            $mainBranchId = Branch::where('client_id', $clientId)->where('is_main', true)->value('id');
            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId) {
                      $ww->where('client_id', $clientId)->where(function ($wb) use ($branchId, $mainBranchId) {
                          $wb->whereNull('branch_id')->orWhere('branch_id', $branchId);
                          if ($mainBranchId) $wb->orWhere('branch_id', $mainBranchId);
                      });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    private function resolveRow(Request $request, int $id): Recruitment
    {
        $q = Recruitment::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
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

    /**
     * Validation rules. Required fields mirror the frontend's required-* labels:
     * job_title, department_id, designation_id, primary_role_id, employment_type,
     * openings, priority, hiring_manager_id, assigned_hr_id, start_date, deadline.
     * Everything else is optional.
     */
    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $req = fn (string $extra = '') => ($isUpdate ? 'sometimes|' : '') . 'required' . ($extra ? "|{$extra}" : '');

        return $request->validate([
            'job_title'         => ($isUpdate ? 'sometimes|' : '') . 'required|string|max:191',
            'department_id'     => ($isUpdate ? 'sometimes|' : '') . 'required|integer|exists:master_departments,id',
            'designation_id'    => ($isUpdate ? 'sometimes|' : '') . 'required|integer|exists:master_designations,id',
            'primary_role_id'   => 'nullable|integer|exists:master_roles,id',

            'employment_type'   => ['nullable', Rule::in(self::EMPLOYMENT_TYPES)],
            'openings'          => 'nullable|integer|min:1|max:9999',
            'experience'        => 'nullable|string|max:30',
            'work_mode'         => ['nullable', Rule::in(self::WORK_MODES)],
            'ctc_range'         => 'nullable|string|max:50',
            'priority'          => ['nullable', Rule::in(self::PRIORITIES)],

            'hiring_manager_id' => 'nullable|integer|exists:employees,id',
            'assigned_hr_id'    => 'nullable|integer|exists:employees,id',
            'start_date'        => 'nullable|date',
            'deadline'          => 'nullable|date|after_or_equal:start_date',

            'job_description'   => 'nullable|string',
            'requirements'      => 'nullable|string',

            'post_on_portal'        => 'nullable|boolean',
            'notify_team_leads'     => 'nullable|boolean',
            'enable_referral_bonus' => 'nullable|boolean',

            'status'        => ['nullable', Rule::in(self::STATUSES)],
            'cancel_reason' => 'nullable|string|max:100',
            'cancel_notes'  => 'nullable|string',
        ]);
    }

    /** Compute the next REC-### atomically inside the create transaction. */
    private function allocateCode($clientId, $branchId): string
    {
        $q = Recruitment::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        return $this->buildNext($q->pluck('code'));
    }

    /** Same logic as allocateCode but without the row lock, for read-only previews. */
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
