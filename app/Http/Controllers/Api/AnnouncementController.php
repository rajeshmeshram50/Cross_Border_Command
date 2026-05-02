<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AnnouncementController extends Controller
{
    /** Eager-loads used by every read endpoint. */
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
        'creator:id,name,user_type',
    ];

    /** Module slug used for permission checks — matches ModuleSeeder. */
    private const MODULE_SLUG = 'hr.broadcast';

    private const TYPES        = ['General', 'Policy', 'Urgent'];
    private const PRIORITIES   = ['Normal', 'High', 'Critical'];
    private const AUDIENCES    = ['all_employees', 'roles', 'designations'];
    private const PUBLISH_TYPES = ['immediate', 'scheduled'];
    private const ACK_MODES    = ['Mandatory', 'Optional'];
    private const ACK_FREQS    = ['Daily', 'Weekly', 'Never'];
    private const STATUSES     = ['Draft', 'Scheduled', 'Active', 'Expired', 'Archived'];

    private const ATTACH_MAX_KB     = 20 * 1024;            // 20 MB
    private const ATTACH_MIME_TYPES = 'png,jpg,jpeg,pdf';

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE / STATS
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        // Re-classify Active → Expired (and Scheduled → Active when due) on
        // the fly so the list reflects the right lifecycle status without a
        // background scheduler. Runs against tenant-scoped rows only.
        $this->refreshLifecycleStatuses($request->user());

        $q = Announcement::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('title', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%")
                  ->orWhere('description', 'ilike', "%{$search}%");
            });
        }
        if ($type = $request->query('type'))     $q->where('type', $type);
        if ($status = $request->query('status')) $q->where('status', $status);

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
            'prefix' => 'ANN-',
        ]);
    }

    /**
     * Aggregate counts driving the KPI strip on the list page (Total /
     * Active / Scheduled / Draft / Expired). Single grouped query.
     */
    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Announcement::query();
        $this->applyScope($q, $request->user());

        $rows = (clone $q)
            ->selectRaw('status, COUNT(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status');

        $get = fn (string $s) => (int) ($rows[$s] ?? 0);

        return response()->json([
            'total'     => (int) $rows->sum(),
            'active'    => $get('Active'),
            'scheduled' => $get('Scheduled'),
            'draft'     => $get('Draft'),
            'expired'   => $get('Expired'),
            'archived'  => $get('Archived'),
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

            // Cache the recipient count so the list view can render it
            // without re-counting on every read.
            $data['audience_count'] = $this->computeAudienceCount(
                $data['audience_type'] ?? 'all_employees',
                $data['audience_role_ids'] ?? [],
                $data['audience_designation_ids'] ?? [],
                $data['exclude_employee_ids'] ?? [],
                $clientId,
                $branchId,
            );

            $payload = array_merge($data, [
                'client_id'  => $clientId,
                'branch_id'  => $branchId,
                'created_by' => $auth?->id,
                'updated_by' => $auth?->id,
                'code'       => $this->allocateCode($clientId, $branchId),
                'status'     => $this->resolveLifecycleStatus($data),
            ]);

            // Persist optional attachment AFTER the row is created so we have
            // an id to scope the file under (announcements/c{client}/{id}/...).
            $row = Announcement::create($payload);
            if ($request->hasFile('attachment')) {
                [$path, $orig] = $this->storeAttachment($request->file('attachment'), $clientId, $row->id);
                $row->update(['attachment_path' => $path, 'attachment_original_name' => $orig]);
            }

            $row->load(self::WITH);

            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);

        // Re-evaluate audience count if any audience field changed.
        if (
            array_key_exists('audience_type', $data) ||
            array_key_exists('audience_role_ids', $data) ||
            array_key_exists('audience_designation_ids', $data) ||
            array_key_exists('exclude_employee_ids', $data)
        ) {
            $data['audience_count'] = $this->computeAudienceCount(
                $data['audience_type'] ?? $row->audience_type,
                $data['audience_role_ids'] ?? $row->audience_role_ids ?? [],
                $data['audience_designation_ids'] ?? $row->audience_designation_ids ?? [],
                $data['exclude_employee_ids'] ?? $row->exclude_employee_ids ?? [],
                $row->client_id,
                $row->branch_id,
            );
        }

        // Replace the attachment if a new file came in.
        $oldPath = $row->attachment_path;
        if ($request->hasFile('attachment')) {
            [$path, $orig] = $this->storeAttachment($request->file('attachment'), $row->client_id, $row->id);
            $data['attachment_path'] = $path;
            $data['attachment_original_name'] = $orig;
        }

        // Recompute lifecycle status after applying the diff.
        $merged = array_merge($row->toArray(), $data);
        $data['status'] = $this->resolveLifecycleStatus($merged);
        $data['updated_by'] = $request->user()?->id;

        $row->update($data);

        if ($request->hasFile('attachment') && $oldPath && $oldPath !== ($data['attachment_path'] ?? null)) {
            Storage::disk('public')->delete($oldPath);
        }

        $row->load(self::WITH);
        return response()->json($row);
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        $row->delete();

        return response()->json(['message' => 'Announcement removed.']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            // First-run: module row not seeded yet. Fall back to a sensible
            // default (allow client_admin / branch_user; deny others) so the
            // page works on a freshly-seeded environment.
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Broadcast Centre module not enabled.');
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

    private function resolveRow(Request $request, int $id): Announcement
    {
        $q = Announcement::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function guardHierarchicalAction($user, Announcement $row, string $verb): void
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
            abort(403, "You cannot {$verb} this announcement — created by a higher-privileged user.");
        }
    }

    /**
     * Validation rules. The form has a Save-as-Draft path that submits with
     * status='Draft', so most fields are nullable when status is Draft;
     * publish-time validation is enforced via resolveLifecycleStatus / the
     * fields being meaningful by then.
     */
    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $isDraft = strtolower((string) $request->input('status')) === 'draft';
        $req = fn () => $isUpdate || $isDraft ? 'nullable' : 'required';

        return $request->validate([
            'title'       => [$req(), 'string', 'max:191'],
            'description' => [$req(), 'string'],
            'type'        => ['nullable', Rule::in(self::TYPES)],
            'priority'    => ['nullable', Rule::in(self::PRIORITIES)],
            'attachment'  => 'nullable|file|mimes:' . self::ATTACH_MIME_TYPES . '|max:' . self::ATTACH_MAX_KB,

            'audience_type'                => ['nullable', Rule::in(self::AUDIENCES)],
            'audience_role_ids'            => 'nullable|array',
            'audience_role_ids.*'          => 'integer',
            'audience_designation_ids'     => 'nullable|array',
            'audience_designation_ids.*'   => 'integer',
            'exclude_employee_ids'         => 'nullable|array',
            'exclude_employee_ids.*'       => 'integer',

            'publish_type'  => ['nullable', Rule::in(self::PUBLISH_TYPES)],
            'publish_at'    => 'nullable|date',
            'expires_at'    => 'nullable|date|after_or_equal:publish_at',

            'ack_required'           => 'nullable|boolean',
            'ack_mode'               => ['nullable', Rule::in(self::ACK_MODES)],
            'ack_reminder_frequency' => ['nullable', Rule::in(self::ACK_FREQS)],
            'ack_escalation_days'    => 'nullable|integer|min:0|max:365',

            'notify_email'    => 'nullable|boolean',
            'notify_in_app'   => 'nullable|boolean',
            'notify_sms'      => 'nullable|boolean',
            'notify_whatsapp' => 'nullable|boolean',

            'status' => ['nullable', Rule::in(self::STATUSES)],
        ]);
    }

    /**
     * Map the submitted data to a lifecycle status — server is authoritative
     * so the UI can't accidentally publish something past its expiry, etc.
     *
     *   Draft        → status explicitly "Draft" or no publish info yet.
     *   Scheduled    → publish_type=scheduled and publish_at is in the future.
     *   Expired      → expires_at has already passed (regardless of publish_at).
     *   Active       → published and not yet expired.
     */
    private function resolveLifecycleStatus(array $d): string
    {
        $status = $d['status'] ?? null;
        if ($status === 'Draft') return 'Draft';
        if ($status === 'Archived') return 'Archived';

        $expiresAt = !empty($d['expires_at']) ? strtotime((string) $d['expires_at']) : null;
        $publishAt = !empty($d['publish_at']) ? strtotime((string) $d['publish_at']) : null;
        $now = time();

        if ($expiresAt !== null && $expiresAt < $now) return 'Expired';
        $publishType = $d['publish_type'] ?? 'immediate';
        if ($publishType === 'scheduled' && $publishAt !== null && $publishAt > $now) {
            return 'Scheduled';
        }
        return 'Active';
    }

    /**
     * Recalculate Active → Expired for any rows whose expires_at has
     * passed since the last list load. Cheap targeted UPDATE instead of
     * rewriting every row on every request.
     */
    private function refreshLifecycleStatuses($user): void
    {
        $q = Announcement::query()
            ->whereIn('status', ['Active', 'Scheduled'])
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now());
        $this->applyScope($q, $user);
        $q->update(['status' => 'Expired']);

        // Promote scheduled rows whose publish_at has come due.
        $p = Announcement::query()
            ->where('status', 'Scheduled')
            ->whereNotNull('publish_at')
            ->where('publish_at', '<=', now());
        $this->applyScope($p, $user);
        $p->update(['status' => 'Active']);
    }

    /**
     * Audience count — best-effort estimate of how many employees a
     * particular audience filter would reach, scoped to the same tenant
     * tuple the announcement will live under. Uses the existing employees
     * table; future per-recipient delivery will replace this with a real
     * pivot.
     */
    private function computeAudienceCount(
        string $audienceType,
        array $roleIds,
        array $designationIds,
        array $excludeEmployeeIds,
        $clientId,
        $branchId,
    ): int {
        $q = Employee::query();
        // Apply same tenant scope used for reads.
        if ($clientId === null) {
            $q->whereNull('client_id');
        } else {
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
        }
        // Branch scoping is best-effort — main branches see everyone in
        // the client, sub-branches see their own + main + null. Mirrors
        // applyScope's logic at a high level.
        if ($branchId !== null) {
            $q->where(function ($w) use ($branchId) {
                $w->whereNull('branch_id')->orWhere('branch_id', $branchId);
            });
        }

        if ($audienceType === 'roles' && !empty($roleIds)) {
            $q->where(function ($w) use ($roleIds) {
                $w->whereIn('primary_role_id', $roleIds)
                  ->orWhereIn('ancillary_role_id', $roleIds);
            });
        } elseif ($audienceType === 'designations' && !empty($designationIds)) {
            $q->whereIn('designation_id', $designationIds);
        }

        if (!empty($excludeEmployeeIds)) {
            $q->whereNotIn('id', $excludeEmployeeIds);
        }

        return (int) $q->count();
    }

    /** Save the uploaded attachment under announcements/c{client}/{ann}/<rand>.ext. */
    private function storeAttachment($file, $clientId, $annId): array
    {
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "announcements/{$clientSlug}/a{$annId}";
        $ext = strtolower($file->getClientOriginalExtension() ?: 'pdf');
        $filename = Str::random(16) . '.' . $ext;
        $path = $file->storeAs($folder, $filename, 'public');
        return [$path, $file->getClientOriginalName()];
    }

    private function allocateCode($clientId, $branchId): string
    {
        $q = Announcement::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        return $this->buildNext($q->pluck('code'));
    }

    private function peekNextCode($clientId, $branchId): string
    {
        $q = Announcement::query()->withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        return $this->buildNext($q->pluck('code'));
    }

    private function buildNext($codes): string
    {
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^ANN-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'ANN-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }
}
