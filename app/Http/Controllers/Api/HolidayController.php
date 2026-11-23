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

class HolidayController extends Controller
{
    use ScopesHolidayTenant;

    private const MODULE_SLUG = 'hr.holiday';


    private const TYPES = ['Public', 'Restricted', 'Company', 'Regional', 'Optional'];

    private const DEFAULT_PER_PAGE = 25;
    private const MAX_PER_PAGE = 200;

    public function index(Request $request)
    {
        $this->authorizeAction($request, 'can_view');

        $q = Holiday::query()->with(['group:id,name']);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($request->filled('holiday_group_id')) {
            $ids = array_values(array_filter(array_map('intval', explode(',', (string) $request->query('holiday_group_id')))));
            $q->whereIn('holiday_group_id', $ids ?: [0]);
        }
        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                    ->orWhere('code', 'ilike', "%{$search}%")
                    ->orWhere('description', 'ilike', "%{$search}%");
            });
        }
        if ($type = $request->query('type')) {
            $types = array_values(array_filter(array_map('trim', explode(',', (string) $type))));
            if ($types) $q->whereIn('type', $types);
        }
        if ($year = $request->query('year')) {
            $years = array_values(array_filter(array_map('intval', explode(',', (string) $year))));
            if ($years) {
                $q->where(function ($w) use ($years) {
                    foreach ($years as $y) $w->orWhereYear('date', $y);
                });
            }
        }

        $q->orderBy('date')->orderBy('id');

        if ($request->has('per_page') || $request->has('page')) {
            $requested = $request->query('per_page');
            $perPage = is_numeric($requested) && (int) $requested > 0
                ? min(self::MAX_PER_PAGE, (int) $requested)
                : self::DEFAULT_PER_PAGE;

            $page = $q->paginate($perPage);
            $this->stripGroupCounts($page->items());

            $payload = $page->toArray();
            $payload['years'] = $this->yearOptions($request);

            return response()->json($payload);
        }

        $rows = $q->get();
        $this->stripGroupCounts($rows);

        return response()->json($rows);
    }

    private function yearOptions(Request $request): array
    {
        $q = Holiday::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        return $q->distinct()
            ->pluck('date')
            ->map(fn($d) => $d ? (int) Carbon::parse($d)->year : null)
            ->filter()
            ->unique()
            ->sortDesc()
            ->values()
            ->all();
    }

    private function stripGroupCounts(iterable $rows): void
    {
        foreach ($rows as $row) {
            $row->group?->setAppends([]);
        }
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
        $groupId = $this->resolveGroupId($request, $request->input('holiday_group_id'));

        $created = 0;
        $skipped = 0;
        $errors  = [];
        $today = Carbon::now()->toDateString();

        $groupMapQ = \App\Models\HolidayGroup::query();
        $this->applyScope($groupMapQ, $auth, null);
        $groupMap = [];
        foreach ($groupMapQ->get(['id', 'name']) as $g) {
            $groupMap[mb_strtolower(trim((string) $g->name))] = (int) $g->id;
        }

        $existing = Holiday::query()
            ->when($clientId === null, fn($q) => $q->whereNull('client_id'), fn($q) => $q->where('client_id', $clientId))
            ->when($branchId !== null, fn($q) => $q->where('branch_id', $branchId))
            ->get(['holiday_group_id', 'date'])
            ->mapWithKeys(fn($h) => [(($h->holiday_group_id ?? 'null') . '|' . Carbon::parse($h->date)->toDateString()) => true])
            ->all();

        DB::transaction(function () use ($payload, $clientId, $branchId, $groupId, $groupMap, $auth, &$created, &$skipped, &$errors, $existing, $today) {
            $seenInBatch = [];

            foreach ($payload['rows'] as $i => $raw) {
                $line = $i + 1;
                $name = trim((string) ($raw['name'] ?? ''));
                $rawDate = trim((string) ($raw['date'] ?? ''));

                if ($name === '' || $rawDate === '') {
                    $errors[] = ['row' => $line, 'message' => 'Name and date are required.'];
                    continue;
                }

                if (!preg_match('/^(?=.*\pL)[\pL\pN .\'\-]+$/u', $name)) {
                    $errors[] = ['row' => $line, 'message' => "Invalid holiday name \"{$name}\" — a name must include at least one letter."];
                    continue;
                }

                $date = $this->parseImportDate($rawDate);
                if (!$date) {
                    $errors[] = ['row' => $line, 'message' => "Invalid date \"{$rawDate}\" (use YYYY-MM-DD or DD-MM-YYYY)."];
                    continue;
                }

                $recurring = filter_var($raw['is_recurring'] ?? false, FILTER_VALIDATE_BOOLEAN);

                if ($date <= $today) {
                    $errors[] = ['row' => $line, 'message' => "Date \"{$rawDate}\" is today or in the past — a holiday must be a future date."];
                    continue;
                }

                $rowGroupName = trim((string) ($raw['group'] ?? ''));
                if ($rowGroupName !== '') {
                    $rowGroupId = $groupMap[mb_strtolower($rowGroupName)] ?? null;
                    if ($rowGroupId === null) {
                        $errors[] = ['row' => $line, 'message' => "Group \"{$rowGroupName}\" does not exist. Create it under Groups first, then re-import."];
                        continue;
                    }
                } else {
                    $rowGroupId = $groupId;
                }
                if ($rowGroupId === null) {
                    $errors[] = ['row' => $line, 'message' => 'No holiday group — set the Group column to an existing group, or pick a group before importing.'];
                    continue;
                }

                $dupeKey = ($rowGroupId ?? 'null') . '|' . $date;
                if (isset($existing[$dupeKey]) || isset($seenInBatch[$dupeKey])) {
                    $skipped++;
                    continue;
                }

                $type = ucfirst(strtolower(trim((string) ($raw['type'] ?? 'Public'))));
                if (!in_array($type, self::TYPES, true)) $type = 'Public';

                Holiday::create([
                    'client_id'        => $clientId,
                    'branch_id'        => $branchId,
                    'holiday_group_id' => $rowGroupId,
                    'created_by'       => $auth?->id,
                    'updated_by'       => $auth?->id,
                    'code'             => $this->allocateCode($clientId, $branchId),
                    'name'         => mb_substr($name, 0, 191),
                    'date'         => $date,
                    'type'         => $type,
                    'is_recurring' => $recurring,
                    'description'  => ($d = trim((string) ($raw['description'] ?? ''))) !== '' ? $d : null,
                ]);

                $seenInBatch[$dupeKey] = true;
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

    public function my(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');

        $employee = Employee::find($user->employee_id);
        $groupId = $employee?->holiday_group_id;
        if (!$groupId) {
            return response()->json([]);
        }

        $year = (int) ($request->query('year') ?: Carbon::now()->year);
        $holidays = Holiday::where('holiday_group_id', $groupId)
            ->with('group:id,name')
            ->orderBy('date')
            ->get()
            ->map(function (Holiday $h) use ($year) {
                $arr = $h->toArray();
                if ($h->is_recurring && $h->date) {
                    $d = Carbon::parse($h->date);
                    $arr['date'] = Carbon::create($year, $d->month, $d->day)->toDateString();
                }
                return $arr;
            })
            ->filter(fn($h) => (int) substr((string) $h['date'], 0, 4) === $year)
            ->sortBy('date')
            ->values();

        return response()->json($holidays);
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $data = $request->validate([
            'name'             => ['required', 'string', 'max:191', 'regex:/^(?=.*\pL)[\pL\pN .\'\-]+$/u'],
            'date'             => 'required|date',
            'type'             => ['nullable', Rule::in(self::TYPES)],
            'is_recurring'     => 'nullable|boolean',
            'description'      => 'nullable|string|max:1000',
            'holiday_group_id' => 'nullable|integer',
        ], [
            'name.regex' => 'Holiday name must include at least one letter — it can also contain numbers, spaces, dots, apostrophes and hyphens, but not numbers alone.',
        ]);

        $data['name'] = trim($data['name']);

        $data['date'] = Carbon::parse($data['date'])->toDateString();
        $data['type'] = $data['type'] ?? 'Public';
        $data['is_recurring'] = filter_var($request->input('is_recurring', false), FILTER_VALIDATE_BOOLEAN);
        $data['holiday_group_id'] = $this->resolveGroupId($request, $request->input('holiday_group_id'));

        [$clientId, $branchId] = $this->resolveOwnership($request);
        $duplicate = Holiday::query()
            ->when($clientId === null, fn($q) => $q->whereNull('client_id'), fn($q) => $q->where('client_id', $clientId))
            ->when($branchId !== null, fn($q) => $q->where('branch_id', $branchId))
            ->when(
                $data['holiday_group_id'] === null,
                fn($q) => $q->whereNull('holiday_group_id'),
                fn($q) => $q->where('holiday_group_id', $data['holiday_group_id']),
            )
            ->whereDate('date', $data['date'])
            ->when($id !== null, fn($q) => $q->where('id', '!=', $id))
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages([
                'date' => 'Holiday already exists for the selected date.',
            ]);
        }

        return $data;
    }

    private function parseImportDate(string $raw): ?string
    {
        $raw = trim($raw);

        if (preg_match('/^\d{5}$/', $raw)) {
            return Carbon::create(1899, 12, 30)->addDays((int) $raw)->toDateString();
        }

        foreach (['Y-m-d', 'd-m-Y', 'd/m/Y', 'm/d/Y', 'd.m.Y', 'd M Y', 'd-M-Y', 'j M Y'] as $fmt) {
            try {
                $d = Carbon::createFromFormat($fmt, $raw);
                if ($d !== false) return $d->toDateString();
            } catch (\Throwable $e) {
            }
        }

        try {
            return Carbon::parse($raw)->toDateString();
        } catch (\Throwable $e) {
            return null;
        }
    }

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

    private function resolveRow(Request $request, int $id): Holiday
    {
        $q = Holiday::query()->where('id', $id);
        $this->applyScope($q, $request->user(), null);
        return $q->firstOrFail();
    }

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
