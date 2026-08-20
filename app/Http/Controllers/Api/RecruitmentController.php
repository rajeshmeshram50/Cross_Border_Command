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
use Illuminate\Validation\ValidationException;

class RecruitmentController extends Controller
{
    
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

    /** Module slug used for permission checks — matches ModuleSeeder. */
    private const MODULE_SLUG = 'hr.recruitment';

    /** Whitelisted enum values — keep in sync with the frontend dropdowns. */
    private const EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Contract', 'Internship'];
    private const WORK_MODES       = ['On-site', 'Remote', 'Hybrid', 'Flexible'];
    private const PRIORITIES       = ['Critical', 'High', 'Medium', 'Low'];
    private const STATUSES         = ['In Progress', 'Completed', 'Cancelled', 'Expired'];

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        // No scheduler runs in this app, so expiry is applied lazily on read:
        // any overdue 'In Progress' recruitment is flipped to 'Expired' before
        // the list is built, so it stops counting/behaving as an active opening.
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

            // Reject duplicates BEFORE allocating the next REC code so we
            // don't burn a sequence number on a request that's about to be
            // rejected. Surfaces inline on the `job_title` field.
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
        // Block edits that would collide with another row's full criteria
        // signature within the same tenant — ignore the row being updated
        // itself so re-saves don't trip the guard. Pass $row so omitted
        // fields fall back to its current values.
        $this->guardDuplicate($data, $row->client_id, $row->branch_id, $row->id, $row);
        // Block "Mark as Completed" until every opening has a selected
        // candidate — otherwise the recruitment's promise to fill N seats
        // is silently broken.
        $this->guardStatusTransition($row, $data);
        // Keep In Progress <-> Expired aligned with the (possibly edited)
        // deadline so extending it reopens an expired recruitment and a past
        // deadline expires it. Leaves explicit Completed/Cancelled untouched.
        $this->reconcileExpiryStatus($data, $row);

        $row->update($data);

        $row->load(self::WITH);
        return response()->json($row);
    }

    /**
     * Reject impossible status transitions before the row is saved.
     *
     * The only state we currently gate is `Completed` — the recruitment
     * must have at least as many `Selected` candidates as openings before
     * it can be closed out as filled. `Cancelled` is always allowed (the
     * cancel modal captures a reason for audit), and any other transition
     * (back to `In Progress`, etc.) is unrestricted.
     */
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

    /**
     * Reject duplicates within the same tenant. A recruitment counts as a
     * duplicate when EVERY substantive field matches an existing row — job
     * title, department, designation, role, employment type, openings,
     * experience, work mode, CTC range, priority, hiring manager, assigned
     * HR, job description and requirements. The only fields deliberately
     * left OUT of the signature are the dates (start_date / deadline): a
     * re-post of the same opening with new dates is a legitimately distinct
     * record, so changing a date is the supported way to post it again.
     * Differing any non-date field makes it a distinct opening; matching all
     * of them means it's an accidental double-submit and is blocked.
     *
     * Skips when job title or department is missing so partial PATCH updates
     * that don't touch those columns aren't blocked. For updates, any field
     * the PATCH omitted falls back to the existing row's value so the
     * signature reflects the row's FINAL state, not just the changed columns.
     */
    private function guardDuplicate(array $data, $clientId, $branchId, ?int $excludeId, ?Recruitment $existing = null): void
    {
        // Resolve each comparison field from the incoming data, falling back
        // to the existing row (update case) when the PATCH omitted it.
        $val = function (string $key) use ($data, $existing) {
            if (array_key_exists($key, $data)) return $data[$key];
            return $existing?->{$key};
        };

        $title  = trim((string) ($val('job_title') ?? ''));
        $deptId = $val('department_id');
        if ($title === '' || $deptId === null) return;

        // Normalise free-text criteria for a forgiving, case-/whitespace-
        // insensitive compare. NULL and '' are treated the same via COALESCE.
        $norm = fn ($v) => mb_strtolower(trim((string) ($v ?? '')));
        // Numeric/FK criteria: NULL is treated as 0 so an unset FK on both
        // rows still compares equal.
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

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS — mirror EmployeeController/MasterController patterns
     * ───────────────────────────────────────────────────────────────── */

    /** Cap the granular permission check to the 'hr.recruitment' module. */
    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        // Tenant-level admins always pass.
        if ($user->isSuperAdmin())     return;
        if ($user->isClientAdmin())    return;

        // Reporting managers get implicit access — they own the hiring
        // pipeline for their direct reports, so the Recruitment module
        // is effectively part of their day-to-day. Mirrors the rule in
        // HiringRequestController so both sides of the flow stay in
        // sync. Two FK shapes — reporting_manager_user_id (direct User
        // FK) and reporting_manager_id (Employee FK, resolved through
        // this user's own employees.user_id row).
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

    /** Tenant scoping — same rules used everywhere else. The optional
     *  $branchFilter is honoured when the SPA's BranchSwitcher injects
     *  ?branch_id=N for client_admin views. */
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
            // Every branch is an isolated peer — globals + client-level rows
            // + own branch's rows only.
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

    /** Narrow to BranchSwitcher's selected branch, validated to belong to
     *  the user's own client (silent ignore for cross-tenant ids). */
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

    /**
     * Lazily expire overdue recruitments for the current tenant scope. Any
     * 'In Progress' row whose deadline has already passed (deadline < today)
     * is moved to 'Expired'. Idempotent — 'Expired'/'Completed'/'Cancelled'
     * rows and rows with no deadline (or a deadline still in the future) are
     * never touched. Runs as a single bulk UPDATE so listing stays cheap.
     */
    private function expireOverdue($user, ?int $branchFilter = null): void
    {
        $q = Recruitment::query();
        $this->applyScope($q, $user, $branchFilter);
        $q->where('status', 'In Progress')
          ->whereNotNull('deadline')
          ->whereDate('deadline', '<', today())
          ->update(['status' => 'Expired']);
    }

    /** Expire a single loaded row if it is overdue (mirrors expireOverdue). */
    private function maybeExpire(Recruitment $row): Recruitment
    {
        if ($row->status === 'In Progress' && $row->deadline && $row->deadline->lt(today())) {
            $row->status = 'Expired';
            $row->save();
        }
        return $row;
    }

    /**
     * Keep the In Progress <-> Expired status in sync with the deadline when a
     * recruitment is edited. Extending the deadline into the future reopens an
     * Expired recruitment; a past (or unchanged-and-past) deadline expires it.
     * Only toggles between those two states — an explicit move to Completed /
     * Cancelled, or a row already in those states, is left untouched.
     */
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
            // Reject special characters (@ # $ % ^ & * ( ) …). Only letters,
            // numbers, spaces and basic title punctuation (- . , /) allowed.
            'job_title'         => array_values(array_filter([
                $isUpdate ? 'sometimes' : null, 'required', 'string', 'max:191',
                'regex:/^[A-Za-z0-9 .,\-\/]+$/',
            ])),
            'department_id'     => ($isUpdate ? 'sometimes|' : '') . 'required|integer|exists:master_departments,id',
            'designation_id'    => ($isUpdate ? 'sometimes|' : '') . 'required|integer|exists:master_designations,id',
            'primary_role_id'   => 'nullable|integer|exists:master_roles,id',
            // Optional link back to the hiring request that spawned this
            // recruitment. The Hiring Requests list uses it to surface a
            // "Recruitment Created" tab. Stays nullable for recruitments
            // that didn't originate from a request.
            'hiring_request_id' => 'nullable|integer|exists:hiring_requests,id',

            'employment_type'   => ['nullable', Rule::in(self::EMPLOYMENT_TYPES)],
            'openings'          => 'nullable|integer|min:1|max:9999',
            'experience'        => 'nullable|string|max:30',
            // Optional (CBC #56). A recruitment may legitimately have no formal
            // qualification requirement, and requiring it would block every
            // existing row from being edited.
            'qualification'     => 'nullable|string|max:255',
            'work_mode'         => ['nullable', Rule::in(self::WORK_MODES)],
            // A single value or a proper "min-max" range — exactly one
            // hyphen, numbers/decimals only. Rejects multiple hyphens
            // ("10---20") and stray separators even if a payload bypasses
            // the SPA. Optional spaces around the hyphen are tolerated.
            'ctc_range'         => ['nullable', 'string', 'max:50', 'regex:/^\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?$/'],
            'priority'          => ['nullable', Rule::in(self::PRIORITIES)],

            'hiring_manager_id' => 'nullable|integer|exists:employees,id',
            'assigned_hr_id'    => 'nullable|integer|exists:employees,id',
            'start_date'        => 'nullable|date',
            // TAT/Deadline must be strictly later than the start date — the
            // same day is not a valid turnaround window, so 'after' (not
            // 'after_or_equal') is enforced here and on the SPA.
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
