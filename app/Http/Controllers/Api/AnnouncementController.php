<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Services\AnnouncementMailer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AnnouncementController extends Controller
{
    public function __construct(private AnnouncementMailer $announcementMailer) {}

    
    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
    ];

   
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

   

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

       
        $this->refreshLifecycleStatuses($request->user());

        $q = Announcement::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

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

    /**
     * PUBLIC (signed) — stream a broadcast announcement's attachment.
     *
     * The emailed announcement links here instead of a raw /storage or Azure
     * blob URL, so the link opens on BOTH local and Azure (public or private
     * container) and works even when the recipient isn't logged in. The route
     * carries a `signed` signature so the id can't be tampered with. Streamed
     * inline so PDFs/images open in the browser (still downloadable from there).
     */
    public function attachment(Request $request, $id)
    {
        $row = Announcement::findOrFail((int) $id);
        $rel = $row->attachment_path;
        if (!$rel) abort(404);

        $norm = ltrim(str_replace('\\', '/', $rel), '/');
        if (str_starts_with($norm, 'storage/')) $norm = substr($norm, 8);
        if (str_starts_with($norm, 'public/'))  $norm = substr($norm, 7);
        if ($norm === '' || !Storage::disk('public')->exists($norm)) abort(404);

        // Storage::response() streams via the DISK, so it reads the bytes from
        // local OR Azure identically — no dependency on a real local file path.
        $name = $row->attachment_original_name ?: basename($norm);
        return Storage::disk('public')->response($norm, $name);
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

  
    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Announcement::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

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

   

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            [$clientId, $branchId] = $this->resolveOwnership($request);

           
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

            $row = Announcement::create($payload);
            if ($request->hasFile('attachment')) {
                [$path, $orig] = $this->storeAttachment($request->file('attachment'), $clientId, $row->id);
                $row->update(['attachment_path' => $path, 'attachment_original_name' => $orig]);
            }

            $row->load(self::WITH);

         
            if ($row->status === 'Active') {
                // Run after the response is flushed (no queue worker needed) so
                // a slow SMTP host can't block the publish or roll back this
                // committed row via PHP's max_execution_time.
                $mailer = $this->announcementMailer;
                defer(fn () => $mailer->sendForAnnouncement($row, $auth));
            }

            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);

       
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

       
        $oldPath = $row->attachment_path;
        $dropAttachment = false;
        if ($request->hasFile('attachment')) {
            [$path, $orig] = $this->storeAttachment($request->file('attachment'), $row->client_id, $row->id);
            $data['attachment_path'] = $path;
            $data['attachment_original_name'] = $orig;
        } elseif ($request->boolean('remove_attachment')) {
            // Composer's Delete on an already-saved attachment. Clear the row
            // first; the stored file is unlinked after the save below, so a
            // failed update can't leave the row pointing at a deleted file.
            $data['attachment_path'] = null;
            $data['attachment_original_name'] = null;
            $dropAttachment = true;
        }

    
        /* The status the CALLER asked for, never the one already on the row.
         *
         * $merged exists so the lifecycle can be resolved against the whole
         * post-update record (publish_at / expires_at may come from either
         * side). But feeding the row's own status into that resolver made an
         * omitted status mean "keep whatever it is", and since the resolver
         * short-circuits on 'Draft', a publish that did not name a status was
         * written back as a draft. (#2)
         *
         * An absent status still means "leave it alone" — the row's status is
         * put back below — so no other caller starts silently publishing
         * drafts. It simply no longer overrides a status that WAS sent. */
        $merged = array_merge($row->toArray(), $data);
        $merged['status'] = array_key_exists('status', $data) ? $data['status'] : $row->status;
        $data['status'] = $this->resolveLifecycleStatus($merged);
        $data['updated_by'] = $request->user()?->id;


        if ($row->status !== 'Active' && $data['status'] === 'Active') {
            $errors = [];
            if (trim((string) ($merged['title'] ?? '')) === '')       $errors['title'] = ['The title is required to publish.'];
            if (trim((string) ($merged['description'] ?? '')) === '')  $errors['description'] = ['The description is required to publish.'];
            if ($errors) {
                throw ValidationException::withMessages($errors);
            }
        }

        $previousStatus = $row->status;
        $row->update($data);

        if ($oldPath && ($dropAttachment
            || ($request->hasFile('attachment') && $oldPath !== ($data['attachment_path'] ?? null)))) {
            Storage::disk('public')->delete($oldPath);
        }

        $row->load(self::WITH);

        if ($previousStatus !== 'Active' && $row->status === 'Active') {
            // See store(): deliver after the response so SMTP never blocks/rolls
            // back the publish, without depending on a queue worker.
            $mailer = $this->announcementMailer;
            $publisher = $request->user();
            defer(fn () => $mailer->sendForAnnouncement($row, $publisher));
        }

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

            // Every branch is an isolated peer — globals + client-level rows + own branch only.
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

    /** BranchSwitcher narrowing — see RecruitmentController for full notes. */
    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
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

        /* Normalise line endings BEFORE the length rules run. (#1)
         *
         * The composer posts as multipart/form-data (it carries the optional
         * attachment), and the FormData spec has the browser rewrite every
         * newline in a text entry to CRLF on the way out. The textarea counts
         * in JS, where a newline is ONE character, so a description the
         * composer reports as 1,991 / 2,000 arrives here as 1,991 plus one
         * extra byte per line break — and a notice with a dozen paragraphs then
         * failed max:2000 while the counter on screen still read green. The
         * user is told to fix a field that is, by the only count they can see,
         * already inside the limit.
         *
         * Normalising to LF makes the server count what the composer counted,
         * and it is the right storage form regardless: the same text was stored
         * with CRLF from here and with LF from anywhere else, so the email body
         * and the inbox row rendered from two different strings. */
        foreach (['title', 'description'] as $field) {
            $value = $request->input($field);
            if (is_string($value)) {
                $request->merge([$field => preg_replace('/\r\n?/', "\n", $value)]);
            }
        }

        $validated = $request->validate([
            'title'       => [$req(), 'string', 'max:191'],
            // Capped to match the composer's counter (DESC_MAX in
            // HrBroadcastCentre.tsx). The column is `text`, but an
            // announcement is a notice: an unbounded paste broke the Review &
            // Publish card, the inbox row and the email body alike, and there
            // is no reader for 50 KB of it. The longest description on record
            // when this cap went in was 255 characters.
            'description' => [$req(), 'string', 'max:2000'],
            'type'        => ['nullable', Rule::in(self::TYPES)],
            'priority'    => ['nullable', Rule::in(self::PRIORITIES)],
            'attachment'  => 'nullable|file|mimes:' . self::ATTACH_MIME_TYPES . '|max:' . self::ATTACH_MAX_KB,
            // Explicit "drop the file that is already on this row". Omitting
            // `attachment` means "unchanged", so removal needs its own flag —
            // see update(). Ignored when a replacement file is also sent.
            'remove_attachment' => 'nullable|boolean',

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

        // Multipart form-data delivers array members as strings ("3"), and the
        // `integer` rule validates without casting — so the JSON columns would
        // persist ["3","4"] and the wizard's strict id comparison ("3" !== 3)
        // renders a blank audience on re-open. Cast to real ints before saving.
        foreach (['audience_role_ids', 'audience_designation_ids', 'exclude_employee_ids'] as $key) {
            if (array_key_exists($key, $validated) && is_array($validated[$key])) {
                $validated[$key] = array_values(array_map('intval', $validated[$key]));
            }
        }

        return $validated;
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
        // Branch scoping is best-effort — branch users see their own branch
        // + client-level + null rows (every branch is an isolated peer).
        // Mirrors applyScope's logic at a high level.
        if ($branchId !== null) {
            $q->where(function ($w) use ($branchId) {
                $w->whereNull('branch_id')->orWhere('branch_id', $branchId);
            });
        }

        // Count only fully-onboarded, operational staff so the saved
        // audience_count matches the wizard's list exactly. Mirrors the
        // `onboarded_only` gate EmployeeController applies to /employees:
        // status=Active + onboarding_stage_completed >= 6 + not soft-deleted
        // (the default scope already drops trashed rows). This keeps
        // half-onboarded / pending people out of the broadcast audience.
        $q->where('status', 'Active')
          ->where('onboarding_stage_completed', '>=', 6);

        if ($audienceType === 'roles' && !empty($roleIds)) {
            $q->where(function ($w) use ($roleIds) {
                // Primary role + the LEGACY single ancillary column (for rows
                // not yet migrated to the multi-role array).
                $w->whereIn('primary_role_id', $roleIds)
                  ->orWhereIn('ancillary_role_id', $roleIds);
                // Modern multi-role storage lives in the `ancillary_role_ids`
                // JSON array (added 2026-05-08). Match any target role held as
                // an ancillary role there — otherwise multi-role employees are
                // under-counted / never reached when targeting by role.
                foreach ($roleIds as $rid) {
                    $w->orWhereJsonContains('ancillary_role_ids', (int) $rid);
                }
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

    /** Sequential ANN code. Shared allocator — see \App\Support\DocumentNumber.
     *
     *  peekNextCode() below keeps the local buildNext() on purpose: it is the
     *  unlocked preview behind GET /announcements/next-code, and must NOT take a
     *  lock — a preview that locked rows would block real writes for its caller. */
    private function allocateCode($clientId, $branchId): string
    {
        return \App\Support\DocumentNumber::next(
            \App\Models\Announcement::class,
            'code',
            'ANN',
            $clientId,
            $branchId,
            withTrashed: true,
        );
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
 