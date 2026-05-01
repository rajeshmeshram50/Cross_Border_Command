<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\HiringRequest;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class HiringRequestController extends Controller
{
    /**
     * Eager-loads used by every read endpoint so the SPA gets nested names
     * (department.name, creator.name, …) without extra round-trips.
     * Mirrors RecruitmentController::WITH.
     */
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
        'creator:id,name,user_type',
        'department:id,name,code',
    ];

    /**
     * The hiring-request screen lives inside the recruitment module — there
     * is no separate `hr.hiring_requests` slug, so permission checks reuse
     * the recruitment module's row.
     */
    private const MODULE_SLUG = 'hr.recruitment';

    /** Whitelisted enums — keep in sync with the front-end form options. */
    private const EMPLOYMENT_TYPES   = ['Full-time', 'Part-time', 'Contract', 'Intern'];
    private const WORK_MODES         = ['Onsite', 'Remote', 'Hybrid', 'Flexible'];
    private const URGENCIES          = ['Low', 'Medium', 'High', 'Critical'];
    private const REQUEST_TYPES      = ['New Position', 'Replacement Hiring', 'Backfill', 'Expansion Hiring', 'Intern Requirement', 'Urgent Temporary Support'];
    private const STATUSES           = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Sent Back', 'Rejected'];

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HiringRequest::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('title', 'ilike', "%{$search}%")
                  ->orWhere('job_role', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%");
            });
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }
        if ($urgency = $request->query('urgency')) {
            $q->where('urgency', $urgency);
        }
        if ($dept = $request->query('department_id')) {
            $q->where('department_id', $dept);
        }

        return response()->json($q->orderByDesc('id')->get());
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

        return response()->json([
            'code'   => $this->peekNextCode($clientId, $branchId),
            'prefix' => 'HRQ-',
        ]);
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

            // Reject duplicates BEFORE allocating the next HRQ code so we
            // don't burn a sequence number on a request that's about to be
            // rejected. Surfaces inline on the `title` field.
            $this->guardDuplicate($data, $clientId, $branchId, null);

            $payload = array_merge($data, [
                'client_id'  => $clientId,
                'branch_id'  => $branchId,
                'created_by' => $auth?->id,
                'code'       => $this->allocateCode($clientId, $branchId),
                // Saved-as-draft rows arrive with status=Draft; submitted
                // rows arrive with status=Submitted from the frontend.
                'status'     => $data['status'] ?? 'Submitted',
            ]);
            $row = HiringRequest::create($payload);
            $row->load(self::WITH);

            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);
        // Block edits that would collide with another row's (title +
        // department) within the same tenant, but ignore the row being
        // updated itself.
        $this->guardDuplicate($data, $row->client_id, $row->branch_id, $row->id);

        $row->update($data);

        $row->load(self::WITH);
        return response()->json($row);
    }

    /**
     * Reject duplicates within the same tenant. The signature key is
     * (title, department_id) — two requests with the exact same title for
     * the same department are almost always an accidental double-submit.
     *
     * Skips when either field is missing (e.g. a half-baked draft) so the
     * Save-as-Draft path stays usable.
     */
    private function guardDuplicate(array $data, $clientId, $branchId, ?int $excludeId): void
    {
        $title = trim((string) ($data['title'] ?? ''));
        $deptId = $data['department_id'] ?? null;
        if ($title === '' || $deptId === null) return;

        $q = HiringRequest::query()
            ->whereRaw('LOWER(title) = ?', [mb_strtolower($title)])
            ->where('department_id', $deptId);

        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        if ($excludeId !== null) $q->where('id', '!=', $excludeId);

        $existing = $q->first(['id', 'code']);
        if ($existing) {
            throw ValidationException::withMessages([
                'title' => [sprintf(
                    'A hiring request with this title already exists for the selected department (%s).',
                    $existing->code ?: ('#' . $existing->id),
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
        return response()->json(['message' => 'Hiring request removed.']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS — same shape as RecruitmentController
     * ───────────────────────────────────────────────────────────────── */

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

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

    private function resolveRow(Request $request, int $id): HiringRequest
    {
        $q = HiringRequest::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function guardHierarchicalAction($user, HiringRequest $row, string $verb): void
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
            abort(403, "You cannot {$verb} this hiring request — created by a higher-privileged user.");
        }
    }

    /**
     * Validation rules.
     *
     * The frontend has TWO submit paths:
     *   - "Save as Draft"  → status='Draft'; the strict required fields are
     *     relaxed so a partial form can still be persisted.
     *   - "Submit to HR"   → status='Submitted'; everything the form marks
     *     with a red asterisk is required.
     *
     * We don't differentiate at the schema level — whichever required
     * fields the frontend chooses to omit it'll send as empty strings, and
     * the request validates either way.
     */
    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $isDraft  = strtolower((string) $request->input('status')) === 'draft';

        // Strict-mode = the user clicked Submit to HR. Draft mode relaxes
        // every required field down to nullable so half-finished forms can
        // be saved.
        $req = fn () => $isUpdate || $isDraft ? 'nullable' : 'required';

        return $request->validate([
            // Section 1
            'title'             => [$isUpdate || $isDraft ? 'nullable' : 'required', 'string', 'max:191'],
            'job_role'          => [$isUpdate || $isDraft ? 'nullable' : 'required', 'string', 'max:191'],
            'department_id'     => [$isUpdate || $isDraft ? 'nullable' : 'required', 'integer', 'exists:master_departments,id'],
            'team'              => 'nullable|string|max:100',
            'requested_by_name' => 'nullable|string|max:150',
            'request_date'      => 'nullable|date',

            // Section 2
            'openings'          => [$req(), 'integer', 'min:1', 'max:9999'],
            'employment_type'   => [$req(), Rule::in(self::EMPLOYMENT_TYPES)],
            'work_mode'         => [$req(), Rule::in(self::WORK_MODES)],
            'urgency'           => [$req(), Rule::in(self::URGENCIES)],

            // Section 3
            'job_description'        => [$req(), 'string'],
            'daily_responsibilities' => 'nullable|string',
            'required_skills'        => [$req(), 'string', 'max:255'],
            'required_experience'    => [$req(), 'string', 'max:30'],
            'required_qualification' => 'nullable|string|max:100',
            'preferred_profile'      => 'nullable|string|max:191',

            // Section 4
            'request_type'           => [$req(), Rule::in(self::REQUEST_TYPES)],
            'business_justification' => [$req(), 'string'],
            'hiring_need_reason'     => [$req(), 'string'],
            'current_team_gap'       => 'nullable|string',
            'what_if_not_filled'     => 'nullable|string',

            'target_join_date' => 'nullable|date',
            'status'           => ['nullable', Rule::in(self::STATUSES)],
        ]);
    }

    /** Compute the next HRQ-### atomically inside the create transaction. */
    private function allocateCode($clientId, $branchId): string
    {
        $q = HiringRequest::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        return $this->buildNext($q->pluck('code'));
    }

    /** Same logic without the row lock, for read-only previews. */
    private function peekNextCode($clientId, $branchId): string
    {
        $q = HiringRequest::query()->withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        return $this->buildNext($q->pluck('code'));
    }

    private function buildNext($codes): string
    {
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^HRQ-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'HRQ-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }
}
