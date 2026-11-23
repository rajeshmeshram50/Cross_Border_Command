<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SalesMeeting;
use App\Models\SalesReminder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class SalesTodoController extends Controller
{
    private const ATTACH_MAX_KB = 20 * 1024;
    private const ATTACH_MIMES  = 'png,jpg,jpeg,webp,pdf';

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
        $employeeId = $user->employee_id;

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
            $employeeId = $user->employee_id;

            $this->assertNoScheduleConflict($data, $clientId, $branchId);

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

        if (isset($data['type']) && $data['type'] !== $row->type) {
            $row->type = $data['type'];
            $row->code = $this->allocateMeetingCode($data['type'], $row->client_id, $row->branch_id);
        }

        foreach (['opp_id','customer','email','contact','platform','start_time','end_time','link','venue','agenda','status'] as $f) {
            if (array_key_exists($f, $data)) $row->{$f} = $data[$f];
        }
        if (isset($data['date'])) $row->date = $data['date'];

        $this->assertNoScheduleConflict([
            'opp_id'     => $row->opp_id,
            'type'       => $row->type,
            'venue'      => $row->venue,
            'date'       => $row->date instanceof \Carbon\Carbon ? $row->date->toDateString() : $row->date,
            'start_time' => $row->start_time,
            'end_time'   => $row->end_time,
        ], $row->client_id, $row->branch_id, $row->id);

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

    private function safeTextRule(int $min, int $max): \Closure
    {
        return function (string $attribute, $value, $fail) use ($min, $max) {
            $v = trim((string) $value);
            if ($v === '') { return; }
            $label = ucfirst(str_replace('_', ' ', $attribute));
            if (!preg_match('/^[A-Za-z0-9 ,.\'\-&()\/:]+$/u', $v)) { $fail("Special characters are not allowed in $label."); return; }
            if (!preg_match('/[A-Za-z]/u', $v)) { $fail("$label must contain letters."); return; }
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
            'tat'        => 'required|string|max:60',
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
            'contact'    => ['required','string','max:50','regex:/^\+?[\d\s\-]{10,20}$/',
                              function (string $attribute, $value, $fail) {
                                  $digits = preg_replace('/\D/', '', (string) $value);
                                  if (strlen($digits) < 10) $fail('Contact number must be at least 10 digits.');
                                  if (strlen($digits) > 15) $fail('Contact number cannot exceed 15 digits.');
                              }],
            'platform'   => ['required','string','max:100'],
            'date'       => ['required','date'],
            'start_time' => ['required','date_format:H:i'],
            'end_time'   => ['required','date_format:H:i','after:start_time'],
            'link'       => ['nullable','string','max:2048','required_if:type,virtual','url'],
            'venue'      => ['nullable','string','max:1000','required_if:type,physical',
                              function (string $attribute, $value, $fail) use ($request) {
                                  if ($request->input('type') === 'physical') {
                                      $closure = $this->safeTextRule(3, 1000);
                                      $closure($attribute, $value, $fail);
                                  }
                              }],
            'agenda'     => ['required','string','max:1000', $this->safeTextRule(2, 1000)],
            'status'     => ['nullable', Rule::in(SalesMeeting::STATUSES)],
        ], [
            'end_time.after' => 'End Time must be greater than Start Time.',
        ]);
    }

    private function assertNoScheduleConflict(array $data, $clientId, $branchId, ?int $ignoreId = null): void
    {
        $type  = $data['type'] ?? null;
        $venue = trim((string) ($data['venue'] ?? ''));
        if ($type === 'physical' && $venue !== ''
            && !empty($data['date']) && !empty($data['start_time']) && !empty($data['end_time'])) {
            $venueConflict = SalesMeeting::query()
                ->where('client_id', $clientId)
                ->when(
                    $branchId === null,
                    fn ($q) => $q->whereNull('branch_id'),
                    fn ($q) => $q->where('branch_id', $branchId),
                )
                ->where('type', 'physical')
                ->whereDate('date', $data['date'])
                ->whereRaw('LOWER(TRIM(venue)) = ?', [strtolower($venue)])
                ->where('status', '!=', SalesMeeting::STATUS_CANCELLED)
                ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
                ->where('start_time', $data['start_time'])
                ->where('end_time', $data['end_time'])
                ->exists();

            if ($venueConflict) {
                abort(response()->json([
                    'message' => 'Time and venue conflict identified',
                    'errors'  => ['venue' => ['Time and venue conflict identified']],
                ], 422));
            }
        }

        $oppId = $data['opp_id'] ?? null;
        if (!$oppId || empty($data['date']) || empty($data['start_time']) || empty($data['end_time'])) {
            return;
        }

        $conflict = SalesMeeting::query()
            ->where('client_id', $clientId)
            ->when(
                $branchId === null,
                fn ($q) => $q->whereNull('branch_id'),
                fn ($q) => $q->where('branch_id', $branchId),
            )
            ->whereDate('date', $data['date'])
            ->where('opp_id', $oppId)
            ->where('status', '!=', SalesMeeting::STATUS_CANCELLED)
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->where('start_time', '<', $data['end_time'])
            ->where('end_time', '>', $data['start_time'])
            ->exists();

        if ($conflict) {
            abort(response()->json([
                'message' => 'Time Conflict: A meeting is already scheduled for this time slot.',
                'errors'  => ['start_time' => ['Time Conflict: A meeting is already scheduled for this time slot.']],
            ], 422));
        }
    }

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

    private function applyScope($q, $user, string $scope): void
    {
        $scope = $scope === 'all' ? 'all' : 'mine';

        if ($user->user_type !== 'super_admin') {
            if ($user->client_id) {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
                });
            }
            if ($user->user_type === 'branch_user') {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }

        if ($scope === 'all') {
            $allowedAll = in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true);
            if ($allowedAll) return;
        }

        $q->where('created_by_user_id', $user->id);
    }

    private function findReminderOrFail($user, int $id): SalesReminder
    {
        $q = SalesReminder::query();
        $this->applyScope($q, $user, 'all');
        $row = $q->whereKey($id)->first();
        if (!$row) abort(404, 'Reminder not found.');
        $canTouchAnyone = in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true);
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
        $canTouchAnyone = in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true);
        if (!$canTouchAnyone && (int) $row->created_by_user_id !== (int) $user->id) {
            abort(403, 'You cannot modify another user\'s meeting.');
        }
        return $row;
    }

    private function allocateMeetingCode(string $type, ?int $clientId, ?int $branchId): string
    {
        $prefix = $type === SalesMeeting::TYPE_PHYSICAL ? 'P-' : 'M-';

        return DB::transaction(function () use ($prefix, $clientId, $branchId) {
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

    private function peekNextCode(string $type, ?int $clientId, ?int $branchId): string
    {
        $prefix = $type === SalesMeeting::TYPE_PHYSICAL ? 'P-' : 'M-';
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

    private function storeAttachment($file, ?int $clientId, string $kind, int $rowId): array
    {
        $tenantSeg = $clientId ? "c{$clientId}" : 'global';
        $dir = "sales-todo/{$kind}s/{$tenantSeg}/" . now()->format('Y/m');
        $orig = (string) $file->getClientOriginalName();
        $path = $file->store($dir, 'public');
        return [$path, $orig];
    }
}
