<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\HrCustomField;
use App\Models\HrDocumentTemplate;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

class HrCustomFieldController extends Controller
{
    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
    ];

    private const MODULE_SLUG = 'hr.custom_fields';

    private const TYPES = ['text', 'date', 'number', 'textarea'];

    private const EMPLOYEE_TOKENS = [
        'FirstName', 'MiddleName', 'LastName', 'FullName', 'DisplayName', 'EmployeeNumber',
        'Email', 'Mobile', 'Address', 'City', 'State',
        'Department', 'Designation', 'JoiningDate', 'ReportsTo',
        'CTC', 'Basic', 'HRA',
        'CompanyName', 'CompanyAddress', 'CompanyLogo',
    ];

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HrCustomField::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                  ->orWhere('description', 'ilike', "%{$search}%");
            });
        }
        if ($type = $request->query('type')) $q->where('type', $type);

        $rows = $q->orderBy('name')->get();

        $usage = $this->computeUsage($request, $rows->pluck('name')->all());

        return response()->json($rows->map(function ($r) use ($usage) {
            $u = $usage[$r->name] ?? ['templates' => [], 'count' => 0];
            return [
                'id'           => $r->id,
                'client_id'    => $r->client_id,
                'branch_id'    => $r->branch_id,
                'name'         => $r->name,
                'type'         => $r->type,
                'description'  => $r->description,
                'used_in_hint' => $r->used_in_hint,
                'created_by'   => $r->created_by,
                'created_at'   => $r->created_at,
                'updated_at'   => $r->updated_at,
                'creator'      => $r->creator,
                'used_in'      => $u['templates'],
                'used_count'   => $u['count'],
            ];
        }));
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        $usage = $this->computeUsage($request, [$row->name]);
        $u = $usage[$row->name] ?? ['templates' => [], 'count' => 0];

        return response()->json(array_merge($row->toArray(), [
            'used_in'    => $u['templates'],
            'used_count' => $u['count'],
        ]));
    }

    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HrCustomField::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        $rows = (clone $q)->selectRaw('type, COUNT(*) as c')->groupBy('type')->pluck('c', 'type');
        $get = fn (string $t) => (int) ($rows[$t] ?? 0);

        $text = $get('text');
        $date = $get('date');
        return response()->json([
            'total'    => (int) $rows->sum(),
            'text'     => $text,
            'date'     => $date,
            'number'   => $get('number'),
            'textarea' => $get('textarea'),
            'other'    => $get('number') + $get('textarea'),
        ]);
    }

    public function knownTokens(Request $request)
    {
        $this->authorizeAny($request, 'can_view', [self::MODULE_SLUG, 'hr.doc_templates']);

        $q = HrCustomField::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        $customs = $q->orderBy('name')->get(['id', 'name', 'type', 'description']);

        return response()->json([
            'employee'      => self::EMPLOYEE_TOKENS,
            'custom_fields' => $customs->map(fn ($c) => [
                'id'          => $c->id,
                'name'        => $c->name,
                'token'       => '{{' . $c->name . '}}',
                'type'        => $c->type,
                'description' => $c->description,
            ])->values(),
        ]);
    }

    public function validateTokens(Request $request)
    {
        $this->authorize($request, 'can_view');

        $html = (string) $request->input('content_html', '');
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        preg_match_all('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/u', $text, $m);
        $found = array_values(array_unique($m[1] ?? []));

        $isSigner = fn (string $t) => (bool) preg_match('/^Signer\d+(Name|Designation|Date)$/', $t);

        $customNames = HrCustomField::query()->when(true, function ($q) use ($request) {
            $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        })->pluck('name')->all();

        $employeeSet = array_flip(self::EMPLOYEE_TOKENS);
        $customSet   = array_flip($customNames);

        $known = $unknown = [];
        foreach ($found as $tok) {
            if (isset($employeeSet[$tok]) || isset($customSet[$tok]) || $isSigner($tok)) {
                $known[] = $tok;
            } else {
                $unknown[] = $tok;
            }
        }

        return response()->json([
            'found'   => $found,
            'known'   => $known,
            'unknown' => $unknown,
        ]);
    }

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);

        try {
            return DB::transaction(function () use ($request, $data) {
                $auth = $request->user();
                [$clientId, $branchId] = $this->resolveOwnership($request);

                $this->ensureUniqueName($clientId, $branchId, $data['name']);

                $row = HrCustomField::create(array_merge($data, [
                    'client_id'  => $clientId,
                    'branch_id'  => $branchId,
                    'created_by' => $auth?->id,
                ]));

                $row->load(self::WITH);
                return response()->json(array_merge($row->toArray(), [
                    'used_in' => [], 'used_count' => 0,
                ]), 201);
            });
        } catch (QueryException $e) {
            return $this->humaniseDbException($e, "add custom field '" . ($data['name'] ?? '') . "'");
        }
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'edit');

        $data = $this->validatePayload($request, $row->id);

        if (isset($data['name']) && $data['name'] !== $row->name) {
            $this->ensureUniqueName($row->client_id, $row->branch_id, $data['name'], $row->id);
        }

        try {
            $row->update($data);
            $row->load(self::WITH);
        } catch (QueryException $e) {
            return $this->humaniseDbException($e, "update {{{$row->name}}}");
        }

        $usage = $this->computeUsage($request, [$row->name]);
        $u = $usage[$row->name] ?? ['templates' => [], 'count' => 0];

        return response()->json(array_merge($row->toArray(), [
            'used_in' => $u['templates'], 'used_count' => $u['count'],
        ]));
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        $usage = $this->computeUsage($request, [$row->name]);
        $count = $usage[$row->name]['count'] ?? 0;
        if ($count > 0) {
            $names = collect($usage[$row->name]['templates'])->pluck('name')->take(3)->implode(', ');
            $rest  = $count > 3 ? " and " . ($count - 3) . " more" : '';
            abort(422, "Cannot delete — {{{$row->name}}} is used in {$count} template(s): {$names}{$rest}.");
        }

        try {
            $row->delete();
        } catch (QueryException $e) {
            return $this->humaniseDbException($e, "delete {{{$row->name}}}");
        }
        return response()->json(['message' => 'Custom field removed.']);
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        return $request->validate([
            'name'         => ['required', 'string', 'max:100', 'regex:/^[A-Za-z_][A-Za-z0-9_]*$/'],
            'type'         => ['required', Rule::in(self::TYPES)],
            'description'  => 'nullable|string|max:500',
            'used_in_hint' => 'nullable|string|max:500',
        ], [
            'name.regex' => 'No spaces — use PascalCase (e.g. LastWorkingDate).',
        ]);
    }

    private function ensureUniqueName($clientId, $branchId, string $name, ?int $ignoreId = null): void
    {
        $q = HrCustomField::query()
            ->where('name', $name)
            ->when($clientId === null, fn ($w) => $w->whereNull('client_id'), fn ($w) => $w->where('client_id', $clientId))
            ->when($branchId === null, fn ($w) => $w->whereNull('branch_id'), fn ($w) => $w->where('branch_id', $branchId));
        if ($ignoreId) $q->where('id', '!=', $ignoreId);
        if ($q->exists()) {
            abort(422, "A custom field named '{$name}' already exists for this branch.");
        }
    }

    private function computeUsage(Request $request, array $names): array
    {
        if (empty($names)) return [];

        $tpl = HrDocumentTemplate::query()
            ->select('id', 'code', 'name', 'content_html');
        $this->applyScopeTemplate($tpl, $request->user(), $request->integer('branch_id') ?: null);
        $templates = $tpl->get();

        $plain = $templates->mapWithKeys(function ($t) {
            $html = is_string($t->content_html) ? $t->content_html : '';
            $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            return [$t->id => $text];
        });

        $result = [];
        foreach ($names as $name) {
            $pattern = '/\{\{\s*' . preg_quote($name, '/') . '\s*\}\}/u';
            $matches = $templates->filter(fn ($t) => (bool) preg_match($pattern, $plain[$t->id] ?? ''));
            $result[$name] = [
                'templates' => $matches->map(fn ($t) => [
                    'id'   => $t->id,
                    'code' => $t->code,
                    'name' => $t->name,
                ])->values()->all(),
                'count' => $matches->count(),
            ];
        }
        return $result;
    }

    private function humaniseDbException(QueryException $e, string $action): JsonResponse
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driver   = $e->errorInfo[1] ?? null;

        Log::error('hr_custom_fields DB exception', [
            'action'    => $action,
            'sql_state' => $sqlState,
            'driver'    => $driver,
            'message'   => $e->getMessage(),
        ]);

        [$status, $message] = match ($sqlState) {
            '23505' => [422, "A custom field with this name already exists."],
            '23503' => [422, "Cannot {$action} — it is referenced by other records."],
            '23502' => [422, "A required field is missing. Please fill in every required input and try again."],
            '42703' => [500, "The database schema is out of date. Run \"php artisan migrate\" and try again."],
            '42P01' => [500, "The custom fields table is missing. Run \"php artisan migrate\" to create it."],
            '08006', '08001', '08003', '08004' => [503, "Could not reach the database. Please try again in a moment."],
            default => [500, "Could not {$action} due to a database error. Please try again."],
        };

        return response()->json(['message' => $message], $status);
    }

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Custom Fields module not enabled.');
        }
        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
    }

    private function authorizeAny(Request $request, string $perm, array $moduleSlugs): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleIds = Module::whereIn('slug', $moduleSlugs)->pluck('id');
        if ($moduleIds->isEmpty()) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Document variables are not available — the module is not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->whereIn('module_id', $moduleIds)
            ->where($perm, true)
            ->exists();

        if (!$allowed) {
            abort(403, 'You do not have access to document variables. Ask your administrator for access to Document Templates or Custom Fields.');
        }
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

    private function applyScopeTemplate($q, $user, ?int $branchFilter = null): void
    {
        $this->applyScope($q, $user, $branchFilter);
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function resolveRow(Request $request, int $id): HrCustomField
    {
        $q = HrCustomField::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function guardHierarchicalAction($user, HrCustomField $row, string $verb): void
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
            abort(403, "You cannot {$verb} this custom field — created by a higher-privileged user.");
        }
    }
}
