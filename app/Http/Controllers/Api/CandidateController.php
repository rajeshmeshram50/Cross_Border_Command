<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Candidate;
use App\Models\Module;
use App\Models\Permission;
use App\Models\Recruitment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CandidateController extends Controller
{
    /**
     * Eager-loads used by every read endpoint so the SPA gets the parent
     * recruitment's code/title alongside each candidate row, no extra
     * round-trips required.
     */
    private const WITH = [
        'recruitment:id,code,job_title',
    ];

    /**
     * Candidates live under the recruitment screen — there's no separate
     * `hr.candidates` slug yet, so permission checks reuse the recruitment
     * module's row.
     */
    private const MODULE_SLUG = 'hr.recruitment';

    /** Whitelisted enums — keep in sync with the front-end form options. */
    private const STATUSES = [
        'Applied', 'Shortlisted', 'In Interview', 'Final Interview',
        'Selected', 'Offered', 'Rejected', 'On Hold',
    ];
    private const SOURCES = [
        'LinkedIn', 'Naukri', 'Indeed', 'Referral', 'Company Website',
        'Walk-in', 'Recruitment Agency', 'Internal', 'Other',
    ];
    private const NOTICE_PERIODS = [
        'Immediate', '15 Days', '30 Days', '45 Days', '60 Days', '90 Days',
    ];
    private const TRANSPORT_MODES = [
        'Walk', 'Bicycle', 'Two-wheeler', 'Four-wheeler', 'Public Transport', 'Other',
    ];

    /** Max CV upload size matches the front-end drop-zone (10 MB). */
    private const CV_MAX_KB     = 10240;
    private const CV_MIME_TYPES = 'pdf,doc,docx';

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Candidate::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

        // The candidate list page always filters by a single recruitment —
        // honour that early so the rest of the filters compose cleanly.
        if ($recId = $request->query('recruitment_id')) {
            $q->where('recruitment_id', $recId);
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }
        if ($source = $request->query('source')) {
            $q->where('source', $source);
        }
        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                  ->orWhere('email', 'ilike', "%{$search}%")
                  ->orWhere('mobile', 'ilike', "%{$search}%");
            });
        }

        return response()->json(
            $q->orderByDesc('id')->get()->map(fn ($c) => $this->serialize($c)),
        );
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($this->serialize($row));
    }

    /**
     * Recruitment summary endpoint used by the candidate page to render
     * the read-only context card above the list. Returns the recruitment
     * shape the SPA's RecruitmentInfo expects (camelCase keys).
     */
    public function recruitmentSummary(Request $request, $recruitmentId)
    {
        $this->authorize($request, 'can_view');

        $rec = Recruitment::with([
            'department:id,name',
            'designation:id,name',
            'hiringManager:id,emp_code,display_name,first_name,last_name',
            'assignedHr:id,emp_code,display_name,first_name,last_name',
        ]);
        $this->applyRecruitmentScope($rec, $request->user());
        $rec = $rec->findOrFail((int) $recruitmentId);

        $mgrName = $rec->hiringManager?->display_name
            ?: trim(($rec->hiringManager?->first_name ?? '') . ' ' . ($rec->hiringManager?->last_name ?? ''));
        $hrName  = $rec->assignedHr?->display_name
            ?: trim(($rec->assignedHr?->first_name ?? '') . ' ' . ($rec->assignedHr?->last_name ?? ''));

        return response()->json([
            'recruitment' => [
                'id'               => (string) $rec->id,
                'code'             => $rec->code,
                'jobTitle'         => $rec->job_title,
                'department'       => $rec->department?->name,
                'designation'      => $rec->designation?->name,
                'employmentType'   => $rec->employment_type,
                'openings'         => (int) $rec->openings,
                'experience'       => $rec->experience,
                'workMode'         => $rec->work_mode,
                'priority'         => $rec->priority,
                'hiringManagerRaw' => $mgrName ?: null,
                'assignedHrName'   => $hrName ?: null,
                'startDate'        => optional($rec->start_date)->toDateString(),
                'deadline'         => optional($rec->deadline)->toDateString(),
                'status'           => $rec->status,
            ],
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
            // Tenant is inherited from the parent recruitment so candidates
            // never escape the recruitment's own scope.
            $parent = $this->loadParentRecruitment($request, (int) $data['recruitment_id']);

            // Reject duplicates (same email under the same recruitment).
            // Mirrors the recruitment / hiring-request guard pattern — surfaces
            // inline on the `email` field with a friendly 422.
            $this->guardDuplicate($data, (int) $data['recruitment_id'], null);

            $payload = array_merge($data, [
                'client_id'  => $parent->client_id,
                'branch_id'  => $parent->branch_id,
                'created_by' => $auth?->id,
            ]);

            // Persist the CV file (if any) on the public disk under
            // candidates/<client>/<recruitment>/<random>.<ext>. Saved before
            // create() so we can roll the upload back if create() fails.
            if ($request->hasFile('cv')) {
                [$path, $original] = $this->storeCv($request->file('cv'), $parent->client_id, $parent->id);
                $payload['cv_path']          = $path;
                $payload['cv_original_name'] = $original;
            }

            $row = Candidate::create($payload);
            $row->load(self::WITH);

            return response()->json($this->serialize($row), 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);
        $this->guardDuplicate($data, $row->recruitment_id, $row->id);

        // Replace the CV if a new file came in. Old file is removed AFTER the
        // update succeeds so a failed save doesn't orphan the new upload.
        $oldPath = $row->cv_path;
        if ($request->hasFile('cv')) {
            [$path, $original] = $this->storeCv($request->file('cv'), $row->client_id, $row->recruitment_id);
            $data['cv_path']          = $path;
            $data['cv_original_name'] = $original;
        }

        $row->update($data);

        if ($request->hasFile('cv') && $oldPath && $oldPath !== ($data['cv_path'] ?? null)) {
            Storage::disk('public')->delete($oldPath);
        }

        $row->load(self::WITH);
        return response()->json($this->serialize($row));
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        // Soft-delete keeps the audit trail; the file stays on disk so a
        // restore can recover it. Hard delete would need to clear cv_path.
        $row->delete();
        return response()->json(['message' => 'Candidate removed.']);
    }

    /**
     * Pipeline status patch — used by the green ✓ / red ✗ row buttons and
     * the CandidateConfirmModal. Captures the rejection reason / notes so
     * the audit trail survives.
     */
    public function updateStatus(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $request->validate([
            'status'           => ['required', Rule::in(self::STATUSES)],
            'rejection_reason' => 'nullable|string|max:100',
            'status_notes'     => 'nullable|string',
        ]);

        $row->update($data);
        $row->load(self::WITH);
        return response()->json($this->serialize($row));
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS — same scoping/guard shape as RecruitmentController
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

    /** Mirrors applyScope but operates on a Recruitment query for the summary endpoint. */
    private function applyRecruitmentScope($q, $user): void
    {
        // Recruitment uses the same column shape so we can reuse applyScope.
        $this->applyScope($q, $user);
    }

    private function resolveRow(Request $request, int $id): Candidate
    {
        $q = Candidate::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    /** Confirm the parent recruitment is visible to the current user. */
    private function loadParentRecruitment(Request $request, int $recruitmentId): Recruitment
    {
        $q = Recruitment::query();
        $this->applyRecruitmentScope($q, $request->user());
        return $q->findOrFail($recruitmentId);
    }

    private function guardHierarchicalAction($user, Candidate $row, string $verb): void
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
            abort(403, "You cannot {$verb} this candidate — created by a higher-privileged user.");
        }
    }

    /**
     * Reject duplicate applications: the same email under the same
     * recruitment. Skips when email is missing (anonymous walk-ins still
     * happen) so the form's optional-email path stays usable.
     */
    private function guardDuplicate(array $data, int $recruitmentId, ?int $excludeId): void
    {
        $email = trim((string) ($data['email'] ?? ''));
        if ($email === '') return;

        $q = Candidate::query()
            ->where('recruitment_id', $recruitmentId)
            ->whereRaw('LOWER(email) = ?', [mb_strtolower($email)]);
        if ($excludeId !== null) $q->where('id', '!=', $excludeId);

        $existing = $q->first(['id', 'name']);
        if ($existing) {
            throw ValidationException::withMessages([
                'email' => [sprintf(
                    'A candidate with this email is already linked to this recruitment (%s).',
                    $existing->name,
                )],
            ]);
        }
    }

    /**
     * Validation rules.
     *
     * The frontend posts with multipart/form-data when a CV is attached, so
     * this also has to accept text values that arrive as strings (they're
     * cast back to numbers by the Eloquent decimal: cast).
     */
    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;

        return $request->validate([
            'recruitment_id'      => [$isUpdate ? 'sometimes' : 'required', 'integer', 'exists:recruitments,id'],

            'name'                => [$isUpdate ? 'sometimes' : 'required', 'string', 'max:150'],
            'email'               => 'nullable|email|max:191',
            'mobile'              => 'nullable|string|max:30',
            'current_address'     => 'nullable|string|max:500',
            'qualification'       => 'nullable|string|max:191',
            'experience_years'    => 'nullable|numeric|min:0|max:99.99',
            'mode_of_transport'   => ['nullable', Rule::in(self::TRANSPORT_MODES)],
            'distance_km'         => 'nullable|numeric|min:0|max:99999.99',

            'current_salary_lpa'  => 'nullable|numeric|min:0|max:9999.99',
            'expected_salary_lpa' => 'nullable|numeric|min:0|max:9999.99',
            'notice_period'       => ['nullable', Rule::in(self::NOTICE_PERIODS)],

            'source'              => ['nullable', Rule::in(self::SOURCES)],

            // CV: only validated when actually present so a partial PATCH
            // that doesn't touch the file still passes.
            'cv'                  => 'nullable|file|mimes:' . self::CV_MIME_TYPES . '|max:' . self::CV_MAX_KB,

            'status'              => ['nullable', Rule::in(self::STATUSES)],
            'rejection_reason'    => 'nullable|string|max:100',
            'status_notes'        => 'nullable|string',
        ]);
    }

    /**
     * Save the uploaded CV on the public disk and return [path, originalName].
     * The path scheme is candidates/{client_id|public}/{recruitment_id}/{rand}.ext
     * so files stay grouped by tenant + parent recruitment.
     */
    private function storeCv($file, $clientId, $recruitmentId): array
    {
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "candidates/{$clientSlug}/r{$recruitmentId}";

        $ext = strtolower($file->getClientOriginalExtension() ?: 'pdf');
        $filename = Str::random(16) . '.' . $ext;

        $path = $file->storeAs($folder, $filename, 'public');
        return [$path, $file->getClientOriginalName()];
    }

    /**
     * Flatten relationship names onto the row so the frontend's table can
     * render `recruitment_code` / `recruitment_title` directly without
     * drilling into nested objects.
     */
    private function serialize(Candidate $row): array
    {
        $arr = $row->toArray();
        $arr['recruitment_code']  = $row->recruitment?->code;
        $arr['recruitment_title'] = $row->recruitment?->job_title;
        // experience_years comes back as a string from the decimal cast —
        // coerce so the FE can do `c.experience_years ?? 0` without surprises.
        $arr['experience_years'] = $row->experience_years !== null ? (float) $row->experience_years : 0;
        return $arr;
    }
}
