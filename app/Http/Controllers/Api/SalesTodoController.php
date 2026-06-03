<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\SalesMeeting;
use App\Models\SalesReminder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;


class SalesTodoController extends Controller
{
    /** Per-attachment cap. Aligns with the existing 20MB cap used by
     *  Announcement attachments and HR doc uploads. */
    private const ATTACH_MAX_KB = 20 * 1024;
    private const ATTACH_MIMES  = 'png,jpg,jpeg,pdf,doc,docx,xls,xlsx,csv';

    /* ─────────────────────────────────────────────────────────────────
     *  REMINDERS — list / create / update / delete / status
     * ───────────────────────────────────────────────────────────────── */

    public function listReminders(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = SalesReminder::query()
            ->with(['creator:id,name,email']);

        $this->applyScope($q, $user, $request->query('scope', 'mine'));

        if ($status = $request->query('status')) {
            if (in_array($status, SalesReminder::STATUSES, true)) {
                $q->where('status', $status);
            }
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('subject', 'ilike', "%{$search}%")
                  ->orWhere('opp_id', 'ilike', "%{$search}%")
                  ->orWhere('remark', 'ilike', "%{$search}%");
            });
        }

        $rows = $q->orderByDesc('set_date')->orderByDesc('id')->get();
        return response()->json($rows);
    }

    public function storeReminder(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $this->validateReminderPayload($request);

        [$clientId, $branchId] = $this->resolveOwnership($user);
        $employeeId = Employee::where('user_id', $user->id)->value('id');

        // Move the uploaded attachment to permanent storage AFTER row
        // creation so the relative path can include the new id.
        $row = SalesReminder::create([
            'client_id'          => $clientId,
            'branch_id'          => $branchId,
            'created_by_user_id' => $user->id,
            'employee_id'        => $employeeId,
            'opp_id'             => $data['opp_id'] ?? null,
            'opp_date'           => $data['opp_date'] ?? null,
            'subject'            => $data['subject'],
            'set_date'           => $data['set_date'],
            'tat'                => $data['tat'] ?? '24 Hours',
            'remark'             => $data['remark'] ?? null,
            'status'             => $data['status'] ?? SalesReminder::STATUS_IN_PROGRESS,
        ]);

        if ($request->hasFile('attachment')) {
            [$path, $orig] = $this->storeAttachment($request->file('attachment'), $clientId, 'reminder', $row->id);
            $row->update(['attachment_path' => $path, 'attachment_original_name' => $orig]);
        }

        $row->load('creator:id,name,email');
        return response()->json($row, 201);
    }

    public function updateReminder(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findReminderOrFail($user, $id);
        $data = $this->validateReminderPayload($request, $id);

        $row->fill([
            'opp_id'   => $data['opp_id']   ?? $row->opp_id,
            'opp_date' => array_key_exists('opp_date', $data) ? $data['opp_date'] : $row->opp_date,
            'subject'  => $data['subject']  ?? $row->subject,
            'set_date' => $data['set_date'] ?? $row->set_date,
            'tat'      => $data['tat']      ?? $row->tat,
            'remark'   => array_key_exists('remark', $data) ? $data['remark'] : $row->remark,
            'status'   => $data['status']   ?? $row->status,
        ]);

        if ($request->hasFile('attachment')) {
            $old = $row->attachment_path;
            [$path, $orig] = $this->storeAttachment($request->file('attachment'), $row->client_id, 'reminder', $row->id);
            $row->attachment_path = $path;
            $row->attachment_original_name = $orig;
            if ($old) Storage::disk('public')->delete($old);
        }

        $row->save();
        $row->load('creator:id,name,email');
        return response()->json($row);
    }

    public function setReminderStatus(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findReminderOrFail($user, $id);

        $data = $request->validate([
            'status' => ['required', Rule::in(SalesReminder::STATUSES)],
        ]);
        $row->update(['status' => $data['status']]);
        return response()->json($row);
    }

    public function destroyReminder(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findReminderOrFail($user, $id);
        if ($row->attachment_path) {
            Storage::disk('public')->delete($row->attachment_path);
        }
        $row->delete();
        return response()->json(['message' => 'Reminder deleted', 'id' => $id]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  MEETINGS — list / create / update / delete / status / next-code
     * ───────────────────────────────────────────────────────────────── */

    public function listMeetings(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = SalesMeeting::query()
            ->with(['creator:id,name,email']);

        $this->applyScope($q, $user, $request->query('scope', 'mine'));

        if ($type = $request->query('type')) {
            if (in_array($type, SalesMeeting::TYPES, true)) {
                $q->where('type', $type);
            }
        }
        if ($status = $request->query('status')) {
            if (in_array($status, SalesMeeting::STATUSES, true)) {
                $q->where('status', $status);
            }
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('customer', 'ilike', "%{$search}%")
                  ->orWhere('opp_id', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%")
                  ->orWhere('agenda', 'ilike', "%{$search}%");
            });
        }

        $rows = $q->orderByDesc('date')->orderByDesc('id')->get();
        return response()->json($rows);
    }

    public function nextMeetingCode(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $type = $request->query('type', SalesMeeting::TYPE_VIRTUAL);
        if (!in_array($type, SalesMeeting::TYPES, true)) {
            $type = SalesMeeting::TYPE_VIRTUAL;
        }

        [$clientId, $branchId] = $this->resolveOwnership($user);
        return response()->json([
            'code' => $this->peekNextCode($type, $clientId, $branchId),
        ]);
    }

    public function storeMeeting(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $this->validateMeetingPayload($request);

        return DB::transaction(function () use ($user, $data) {
            [$clientId, $branchId] = $this->resolveOwnership($user);
            $employeeId = Employee::where('user_id', $user->id)->value('id');

            $code = $this->allocateMeetingCode($data['type'], $clientId, $branchId);

            $row = SalesMeeting::create([
                'client_id'          => $clientId,
                'branch_id'          => $branchId,
                'created_by_user_id' => $user->id,
                'employee_id'        => $employeeId,
                'code'               => $code,
                'opp_id'             => $data['opp_id'] ?? null,
                'customer'           => $data['customer'],
                'email'              => $data['email'] ?? null,
                'contact'            => $data['contact'] ?? null,
                'platform'           => $data['platform'] ?? null,
                'date'               => $data['date'],
                'start_time'         => $data['start_time'] ?? null,
                'end_time'           => $data['end_time'] ?? null,
                'link'               => $data['link'] ?? null,
                'venue'              => $data['venue'] ?? null,
                'agenda'             => $data['agenda'] ?? null,
                'status'             => $data['status'] ?? SalesMeeting::STATUS_IN_PROGRESS,
                'type'               => $data['type'],
            ]);

            $row->load('creator:id,name,email');
            return response()->json($row, 201);
        });
    }

    public function updateMeeting(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findMeetingOrFail($user, $id);
        $data = $this->validateMeetingPayload($request, $id);

        // Type can change (Virtual → Physical) but the code prefix must
        // change with it. Allocate a fresh code when type flips.
        if (isset($data['type']) && $data['type'] !== $row->type) {
            $row->type = $data['type'];
            $row->code = $this->allocateMeetingCode($data['type'], $row->client_id, $row->branch_id);
        }

        foreach (['opp_id','customer','email','contact','platform','start_time','end_time','link','venue','agenda','status'] as $f) {
            if (array_key_exists($f, $data)) $row->{$f} = $data[$f];
        }
        if (isset($data['date'])) $row->date = $data['date'];
        $row->save();

        $row->load('creator:id,name,email');
        return response()->json($row);
    }

    public function setMeetingStatus(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findMeetingOrFail($user, $id);
        $data = $request->validate([
            'status' => ['required', Rule::in(SalesMeeting::STATUSES)],
        ]);
        $row->update(['status' => $data['status']]);
        return response()->json($row);
    }

    public function destroyMeeting(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findMeetingOrFail($user, $id);
        $row->delete();
        return response()->json(['message' => 'Meeting deleted', 'id' => $id]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  VALIDATION
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Shared content rule for user-facing free-text fields. One rule, one
     * message: only letters, digits and spaces are allowed. Rejects every
     * abuse pattern QA reported ("!@#####mdsdsds", "!!!!!", "1234..." etc.)
     * without forcing the user to memorise a punctuation allowlist.
     */
    private function safeTextRule(int $min, int $max): \Closure
    {
        return function (string $attribute, $value, $fail) use ($min, $max) {
            $v = trim((string) $value);
            if ($v === '') { return; } // 'required' is enforced separately
            $label = ucfirst(str_replace('_', ' ', $attribute));
            if (!preg_match('/^[A-Za-z0-9 ]+$/u', $v)) { $fail("Special characters are not allowed in $label."); return; }
            if (mb_strlen($v) < $min) { $fail("$label must be at least $min characters."); return; }
            if (mb_strlen($v) > $max) { $fail("$label cannot exceed $max characters."); return; }
        };
    }

    private function validateReminderPayload(Request $request, ?int $editingId = null): array
    {
        return $request->validate([
            'opp_id'     => 'nullable|string|max:60',
            'opp_date'   => 'nullable|date',
            'subject'    => ['required','string','max:255', $this->safeTextRule(3, 255)],
            'set_date'   => ['required','date'],
            'tat'        => 'nullable|string|max:60',
            'remark'     => 'nullable|string|max:2000',
            'status'     => ['nullable', Rule::in(SalesReminder::STATUSES)],
            'attachment' => 'nullable|file|max:' . self::ATTACH_MAX_KB . '|mimes:' . self::ATTACH_MIMES,
        ]);
    }

    private function validateMeetingPayload(Request $request, ?int $editingId = null): array
    {
        return $request->validate([
            'type'       => ['required', Rule::in(SalesMeeting::TYPES)],
            'opp_id'     => 'nullable|string|max:60',
            'customer'   => ['required','string','max:255', $this->safeTextRule(3, 255)],
            'email'      => 'nullable|email|max:191',
            // Contact: 10–15 digits after stripping separators; allow + space -
            'contact'    => ['required','string','max:50','regex:/^\+?[\d\s\-]{10,20}$/',
                              function (string $attribute, $value, $fail) {
                                  $digits = preg_replace('/\D/', '', (string) $value);
                                  if (strlen($digits) < 10) $fail('Contact number must be at least 10 digits.');
                                  if (strlen($digits) > 15) $fail('Contact number cannot exceed 15 digits.');
                              }],
            'platform'   => ['required','string','max:100'],
            'date'       => ['required','date'],
            'start_time' => ['required','date_format:H:i'],
            'end_time'   => ['required','date_format:H:i','after_or_equal:start_time'],
            // Link required for virtual; venue required for physical. Cross-field
            // checks below the array-validate call would be cleaner, but Laravel's
            // sometimes+required_if covers it inline.
            'link'       => ['nullable','string','max:2048','required_if:type,virtual','url'],
            'venue'      => ['nullable','string','max:1000','required_if:type,physical',
                              function (string $attribute, $value, $fail) use ($request) {
                                  if ($request->input('type') === 'physical') {
                                      $closure = $this->safeTextRule(3, 1000);
                                      $closure($attribute, $value, $fail);
                                  }
                              }],
            'agenda'     => ['required','string','max:2000', $this->safeTextRule(3, 2000)],
            'status'     => ['nullable', Rule::in(SalesMeeting::STATUSES)],
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Resolve which (client_id, branch_id) tuple a new row should be
     * stamped with based on the caller's account. Mirrors the helper
     * used in AnnouncementController / RecruitmentController.
     */
    private function resolveOwnership($user): array
    {
        if ($user->user_type === 'super_admin') {
            return [null, null];
        }
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return [$user->client_id, null];
        }
        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return [$user->client_id, $user->branch_id];
        }
        return [null, null];
    }

    /**
     * Constrain the query to rows the caller is allowed to read.
     *
     *   scope=mine (default) → only the caller's own rows
     *   scope=all            → admin path; sees everything in their tenant
     *
     * Tenant isolation always applies on top — a client_admin asking for
     * `scope=all` never sees another client's rows. Non-super_admin rows
     * are pinned to the caller's client_id at the SQL layer.
     */
    private function applyScope($q, $user, string $scope): void
    {
        $scope = $scope === 'all' ? 'all' : 'mine';

        // Tenant isolation first (defense in depth).
        if ($user->user_type !== 'super_admin') {
            if ($user->client_id) {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
                });
            }
            // Sub-branch users (non-main) are pinned to their own branch.
            $isMain = $user->branch?->is_main ?? false;
            if ($user->user_type === 'branch_user' && !$isMain) {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }

        if ($scope === 'all') {
            // Admin / HR scope — only privileged roles can request this
            // and actually see other people's rows. Everyone else gets
            // their own rows back even when they ask for "all".
            $allowedAll = in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true)
                || ($user->user_type === 'branch_user' && ($user->branch?->is_main ?? false));
            if ($allowedAll) return;
        }

        $q->where('created_by_user_id', $user->id);
    }

    private function findReminderOrFail($user, int $id): SalesReminder
    {
        $q = SalesReminder::query();
        $this->applyScope($q, $user, 'all'); // admins can edit anyone's; tenant isolation still applies
        $row = $q->whereKey($id)->first();
        if (!$row) abort(404, 'Reminder not found.');
        // Non-admin users can only modify their own rows — re-check.
        $canTouchAnyone = in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true)
            || ($user->user_type === 'branch_user' && ($user->branch?->is_main ?? false));
        if (!$canTouchAnyone && (int) $row->created_by_user_id !== (int) $user->id) {
            abort(403, 'You cannot modify another user\'s reminder.');
        }
        return $row;
    }

    private function findMeetingOrFail($user, int $id): SalesMeeting
    {
        $q = SalesMeeting::query();
        $this->applyScope($q, $user, 'all');
        $row = $q->whereKey($id)->first();
        if (!$row) abort(404, 'Meeting not found.');
        $canTouchAnyone = in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true)
            || ($user->user_type === 'branch_user' && ($user->branch?->is_main ?? false));
        if (!$canTouchAnyone && (int) $row->created_by_user_id !== (int) $user->id) {
            abort(403, 'You cannot modify another user\'s meeting.');
        }
        return $row;
    }

    /**
     * Allocate the next code for a meeting in this tenant. Atomic via
     * SELECT … FOR UPDATE on the existing rows so two concurrent saves
     * can't allocate the same code.
     */
    private function allocateMeetingCode(string $type, ?int $clientId, ?int $branchId): string
    {
        $prefix = $type === SalesMeeting::TYPE_PHYSICAL ? 'P-' : 'M-';

        return DB::transaction(function () use ($prefix, $clientId, $branchId) {
            // withTrashed() is essential: the unique index on
            // (client_id, branch_id, code) still counts soft-deleted rows, so
            // reusing a deleted meeting's code would violate it on insert.
            $q = SalesMeeting::withTrashed()
                ->where('code', 'like', $prefix . '%')
                ->lockForUpdate();
            if ($clientId !== null) $q->where('client_id', $clientId);
            else                    $q->whereNull('client_id');
            if ($branchId !== null) $q->where('branch_id', $branchId);
            else                    $q->whereNull('branch_id');

            $rows = $q->pluck('code');
            $maxN = 0;
            foreach ($rows as $code) {
                if (preg_match('/^' . preg_quote($prefix, '/') . '(\d+)$/', $code, $m)) {
                    $maxN = max($maxN, (int) $m[1]);
                }
            }
            return $prefix . str_pad((string) ($maxN + 1), 3, '0', STR_PAD_LEFT);
        });
    }

    /** Non-locking preview — used by /next-code so the form can render
     *  the expected next code as a placeholder before save. */
    private function peekNextCode(string $type, ?int $clientId, ?int $branchId): string
    {
        $prefix = $type === SalesMeeting::TYPE_PHYSICAL ? 'P-' : 'M-';
        // Match allocateMeetingCode(): include trashed rows so the preview
        // matches the code that will actually be assigned.
        $q = SalesMeeting::withTrashed()->where('code', 'like', $prefix . '%');
        if ($clientId !== null) $q->where('client_id', $clientId);
        else                    $q->whereNull('client_id');
        if ($branchId !== null) $q->where('branch_id', $branchId);
        else                    $q->whereNull('branch_id');

        $rows = $q->pluck('code');
        $maxN = 0;
        foreach ($rows as $code) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '(\d+)$/', $code, $m)) {
                $maxN = max($maxN, (int) $m[1]);
            }
        }
        return $prefix . str_pad((string) ($maxN + 1), 3, '0', STR_PAD_LEFT);
    }

    /**
     * Persist an attachment to the public disk under a tenant-scoped
     * folder. Returns [relativePath, originalName].
     */
    private function storeAttachment($file, ?int $clientId, string $kind, int $rowId): array
    {
        $tenantSeg = $clientId ? "c{$clientId}" : 'global';
        $dir = "sales-todo/{$kind}s/{$tenantSeg}/" . now()->format('Y/m');
        $orig = (string) $file->getClientOriginalName();
        $path = $file->store($dir, 'public');
        return [$path, $orig];
    }
}
