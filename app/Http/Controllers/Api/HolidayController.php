<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * HRMS Holiday calendar — per-tenant company holidays. Manual CRUD plus a
 * bulk Excel/CSV import (rows parsed client-side, posted here as JSON).
 *
 * Tenant scoping, ownership resolution and the permission gate all mirror
 * AnnouncementController so the module behaves like the rest of HRMS.
 */
class HolidayController extends Controller
{
    use ScopesHolidayTenant;

    /** Module slug used for permission checks — matches ModuleSeeder. */
    private const MODULE_SLUG = 'hr.holiday';

    /** Tenant-facing timezone used to resolve "today" when freezing past
     *  holidays. The app runs in UTC; holiday dates are entered/read in IST. */
    private const DISPLAY_TZ = 'Asia/Kolkata';

    /** Allowed holiday categories. */
    private const TYPES = ['Public', 'Restricted', 'Company', 'Regional', 'Optional'];

    /* ─────────────────────────────────────────────────────────────────
     *  CRUD
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorizeAction($request, 'can_view');

        $q = Holiday::query()->with(['creator:id,name', 'group:id,name']);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($request->filled('holiday_group_id')) {
            $q->where('holiday_group_id', (int) $request->query('holiday_group_id'));
        }
        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%")
                  ->orWhere('description', 'ilike', "%{$search}%");
            });
        }
        if ($type = $request->query('type')) {
            $q->where('type', $type);
        }
        if ($year = $request->query('year')) {
            $q->whereYear('date', (int) $year);
        }

        // Date-wise, with id as a stable tie-breaker so same-date holidays keep
        // a deterministic order (the SPA prints a continuous Sr. No. over this).
        return response()->json($q->orderBy('date')->orderBy('id')->get());
    }

    public function show(Request $request, $id)
    {
        $this->authorizeAction($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($row);
    }

    public function store(Request $request)
    {
        $this->authorizeAction($request, 'can_add');
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            [$clientId, $branchId] = $this->resolveOwnership($request);

            $row = Holiday::create(array_merge($data, [
                'client_id'  => $clientId,
                'branch_id'  => $branchId,
                'created_by' => $auth?->id,
                'updated_by' => $auth?->id,
                'code'       => $this->allocateCode($clientId, $branchId),
            ]));

            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorizeAction($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);
        $this->assertGroupNotInUse($row, 'edited');

        $data = $this->validatePayload($request, $row->id);
        $data['updated_by'] = $request->user()?->id;

        $row->update($data);

        return response()->json($row->fresh());
    }

    public function destroy(Request $request, $id)
    {
        $this->authorizeAction($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->assertGroupNotInUse($row, 'removed');

        $row->delete();

        return response()->json(['message' => 'Holiday removed.']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  BULK IMPORT (Excel / CSV → JSON rows from the frontend)
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Import many holidays at once. The frontend parses the .xlsx with
     * SheetJS and posts `rows: [{ name, date, type?, is_recurring?,
     * description? }, ...]`. Each row is validated independently; valid
     * rows are inserted and invalid ones are returned with a reason so the
     * user can fix the sheet — a partial import never aborts the whole batch.
     */
    public function import(Request $request)
    {
        $this->authorizeAction($request, 'can_add');

        $payload = $request->validate([
            'rows'             => 'required|array|min:1|max:1000',
            'rows.*'           => 'array',
            'holiday_group_id' => 'nullable|integer',
        ]);

        $auth = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($request);
        // All imported rows land in this group (selected in the UI). Validated
        // against the caller's tenant scope so a forged id can't cross tenants.
        $groupId = $this->resolveGroupId($request, $request->input('holiday_group_id'));

        $created = 0;
        $skipped = 0;
        $errors  = [];

        // Existing dates in this tenant + group scope so we can skip duplicates
        // without a query per row. Duplicates are judged within the target
        // group, so the same date may legitimately exist in another group.
        $existing = Holiday::query()
            ->when($clientId === null, fn ($q) => $q->whereNull('client_id'), fn ($q) => $q->where('client_id', $clientId))
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($groupId === null, fn ($q) => $q->whereNull('holiday_group_id'), fn ($q) => $q->where('holiday_group_id', $groupId))
            ->pluck('date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())
            ->flip();

        DB::transaction(function () use ($payload, $clientId, $branchId, $groupId, $auth, &$created, &$skipped, &$errors, $existing) {
            $seenInBatch = [];

            foreach ($payload['rows'] as $i => $raw) {
                $line = $i + 1;
                $name = trim((string) ($raw['name'] ?? ''));
                $rawDate = trim((string) ($raw['date'] ?? ''));

                if ($name === '' || $rawDate === '') {
                    $errors[] = ['row' => $line, 'message' => 'Name and date are required.'];
                    continue;
                }

                $date = $this->parseImportDate($rawDate);
                if (!$date) {
                    $errors[] = ['row' => $line, 'message' => "Invalid date \"{$rawDate}\" (use YYYY-MM-DD or DD-MM-YYYY)."];
                    continue;
                }

                // De-dupe against the DB and against earlier rows in the same file.
                if (isset($existing[$date]) || isset($seenInBatch[$date])) {
                    $skipped++;
                    continue;
                }

                $type = ucfirst(strtolower(trim((string) ($raw['type'] ?? 'Public'))));
                if (!in_array($type, self::TYPES, true)) $type = 'Public';

                $recurring = filter_var($raw['is_recurring'] ?? false, FILTER_VALIDATE_BOOLEAN);

                Holiday::create([
                    'client_id'        => $clientId,
                    'branch_id'        => $branchId,
                    'holiday_group_id' => $groupId,
                    'created_by'       => $auth?->id,
                    'updated_by'       => $auth?->id,
                    'code'             => $this->allocateCode($clientId, $branchId),
                    'name'         => mb_substr($name, 0, 191),
                    'date'         => $date,
                    'type'         => $type,
                    'is_recurring' => $recurring,
                    'description'  => ($d = trim((string) ($raw['description'] ?? ''))) !== '' ? $d : null,
                ]);

                $seenInBatch[$date] = true;
                $created++;
            }
        });

        return response()->json([
            'message' => "Imported {$created} holiday(s), skipped {$skipped} duplicate(s).",
            'created' => $created,
            'skipped' => $skipped,
            'errors'  => $errors,
        ]);
    }

    /**
     * Holidays for the logged-in user — resolved from the holiday group their
     * employee record is assigned to. Lets an employee see exactly the
     * holidays that apply to them (and that payroll credits). Returns an empty
     * list (not an error) when the user has no employee row or no group.
     */
    public function my(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');

        $employee = Employee::where('user_id', $user->id)->first();
        $groupId = $employee?->holiday_group_id;
        if (!$groupId) {
            return response()->json([]);
        }

        $year = (int) ($request->query('year') ?: Carbon::now()->year);
        $holidays = Holiday::where('holiday_group_id', $groupId)
            ->with('group:id,name')
            ->orderBy('date')
            ->get()
            // Recurring holidays repeat yearly — surface them on the requested
            // year regardless of the original year stored on the row.
            ->map(function (Holiday $h) use ($year) {
                $arr = $h->toArray();
                if ($h->is_recurring && $h->date) {
                    $d = Carbon::parse($h->date);
                    $arr['date'] = Carbon::create($year, $d->month, $d->day)->toDateString();
                }
                return $arr;
            })
            ->filter(fn ($h) => (int) substr((string) $h['date'], 0, 4) === $year)
            ->sortBy('date')
            ->values();

        return response()->json($holidays);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $data = $request->validate([
            'name'             => 'required|string|max:191',
            'date'             => 'required|date',
            'type'             => ['nullable', Rule::in(self::TYPES)],
            'is_recurring'     => 'nullable|boolean',
            'description'      => 'nullable|string|max:1000',
            'holiday_group_id' => 'nullable|integer',
        ]);

        // Normalise to a clean date string + defaults so the DB never sees a
        // datetime or an unexpected type value.
        $data['date'] = Carbon::parse($data['date'])->toDateString();
        $data['type'] = $data['type'] ?? 'Public';
        $data['is_recurring'] = filter_var($request->input('is_recurring', false), FILTER_VALIDATE_BOOLEAN);
        // Only honour a group id that belongs to the caller's tenant scope.
        $data['holiday_group_id'] = $this->resolveGroupId($request, $request->input('holiday_group_id'));

        // Block duplicate holidays on the same date within the same tenant +
        // group scope (the same date may legitimately exist in another group).
        // Mirrors the bulk-import de-dupe so single-create can't bypass it.
        // On update, the row being edited is excluded.
        [$clientId, $branchId] = $this->resolveOwnership($request);
        $duplicate = Holiday::query()
            ->when($clientId === null, fn ($q) => $q->whereNull('client_id'), fn ($q) => $q->where('client_id', $clientId))
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when(
                $data['holiday_group_id'] === null,
                fn ($q) => $q->whereNull('holiday_group_id'),
                fn ($q) => $q->where('holiday_group_id', $data['holiday_group_id']),
            )
            ->whereDate('date', $data['date'])
            ->when($id !== null, fn ($q) => $q->where('id', '!=', $id))
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages([
                'date' => 'Holiday already exists for the selected date.',
            ]);
        }

        return $data;
    }

    /** Accept ISO (YYYY-MM-DD), DD-MM-YYYY, DD/MM/YYYY or Excel-ish dates. */
    private function parseImportDate(string $raw): ?string
    {
        $raw = trim($raw);

        // Excel serial date number (days since 1899-12-30).
        if (preg_match('/^\d{5}$/', $raw)) {
            return Carbon::create(1899, 12, 30)->addDays((int) $raw)->toDateString();
        }

        foreach (['Y-m-d', 'd-m-Y', 'd/m/Y', 'm/d/Y', 'd.m.Y', 'd M Y', 'd-M-Y', 'j M Y'] as $fmt) {
            try {
                $d = Carbon::createFromFormat($fmt, $raw);
                if ($d !== false) return $d->toDateString();
            } catch (\Throwable $e) {
                // try next format
            }
        }

        // Last resort — let Carbon guess (handles "2026-01-26T00:00:00.000Z").
        try {
            return Carbon::parse($raw)->toDateString();
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Block edits/deletes on a holiday whose group is assigned to employees.
     * Once a group is somebody's holiday list, its dates feed that employee's
     * attendance/payroll, so changing or removing a holiday inside it would
     * silently rewrite a calendar people depend on. The admin must first
     * unassign the group from all employees. Un-grouped holidays are exempt.
     */
    private function assertGroupNotInUse(Holiday $row, string $verb): void
    {
        if (!$row->holiday_group_id) return;

        $assigned = Employee::where('holiday_group_id', $row->holiday_group_id)->count();
        if ($assigned > 0) {
            throw ValidationException::withMessages([
                'holiday_group_id' => "This holiday's group is assigned to {$assigned} employee"
                    . ($assigned === 1 ? '' : 's')
                    . ", so its holidays can't be {$verb}. Reassign those employees to another group first.",
            ]);
        }
    }

    /**
     * Fetch a row enforcing tenant scope so one tenant can't read/edit
     * another's holiday by guessing an id.
     */
    private function resolveRow(Request $request, int $id): Holiday
    {
        $q = Holiday::query()->where('id', $id);
        $this->applyScope($q, $request->user(), null);
        return $q->firstOrFail();
    }

    /**
     * Validate that the given holiday_group_id exists within the caller's
     * tenant scope. Returns the id when valid, or null (un-grouped) when blank
     * or out of scope — never trusts a raw id from the request body.
     */
    private function resolveGroupId(Request $request, $rawId): ?int
    {
        if (!$rawId) return null;
        $q = \App\Models\HolidayGroup::query()->where('id', (int) $rawId);
        $this->applyScope($q, $request->user(), null);
        return $q->exists() ? (int) $rawId : null;
    }

    private function authorizeAction(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if (method_exists($user, 'isSuperAdmin') && $user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            // Module row not seeded yet — fall back to a sensible default so a
            // freshly-migrated env still works for tenant admins.
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Holiday module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
    }

    private function allocateCode($clientId, $branchId): string
    {
        $q = Holiday::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck('code') as $c) {
            if (preg_match('/^HOL-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'HOL-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }
}
