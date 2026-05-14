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

/**
 * HR > Document & Evidence > Custom Fields.
 *
 * Variables document templates can reference via {{FieldName}} that are NOT
 * available in the employee data set. At document-generation time the system
 * prompts the user to fill them in manually.
 *
 * Scoping mirrors HrDocumentTemplateController exactly so a custom field
 * defined at a tenant is visible to the same tenants as the templates that
 * would reference it.
 *
 *   used_in:  intentionally NOT a column — derived on read by scanning
 *             hr_document_templates.content_html for the literal {{name}}.
 *             Always-truthful, no de-sync risk.
 *
 *   tokens:   the known-tokens endpoint feeds the TemplateEditor's left
 *             sidebar so the user can insert custom-field placeholders the
 *             same way they insert employee-data placeholders. The
 *             validate-tokens endpoint returns the list of {{X}} found in a
 *             given HTML blob that are neither known employee fields nor
 *             registered custom fields — used by the editor to surface an
 *             "Add as Custom Field" CTA.
 */
class HrCustomFieldController extends Controller
{
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
        'creator:id,name,user_type',
    ];

    private const MODULE_SLUG = 'hr.custom_fields';

    private const TYPES = ['text', 'date', 'number', 'textarea'];

    /**
     * The hard-coded employee-data tokens the TemplateEditor offers in its
     * STATIC_PLACEHOLDER_GROUPS. Mirror this list when adding new built-in
     * placeholders to the editor — see resources/js/pages/hrms/doc-templates/
     * TemplateEditor.tsx.
     */
    private const EMPLOYEE_TOKENS = [
        // Basic
        'FirstName', 'MiddleName', 'LastName', 'FullName', 'DisplayName', 'EmployeeNumber',
        // Contact
        'Email', 'Mobile', 'Address', 'City', 'State',
        // Job
        'JobTitle', 'Department', 'Designation', 'JoiningDate', 'ReportsTo',
        // Salary
        'CTC', 'Basic', 'HRA',
        // Org
        'CompanyName', 'CompanyAddress', 'CompanyLogo',
    ];

    /* ───── LIST / SHOW / STATS ───── */

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

        // Derive used_in by scanning templates the same user can see. One
        // query for all templates in scope + a per-row substring check keeps
        // this O(rows * templates) but cheap (typical counts are < 200).
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
            // "Other Types" tile on the page — every type that isn't pure text/date.
            'other'    => $get('number') + $get('textarea'),
        ]);
    }

    /* ───── EDITOR INTEGRATION ───── */

    /**
     * Full token catalogue for the template editor's left sidebar. Returns
     * both the hard-coded employee-data tokens (grouped) and the user's
     * registered custom fields, so the editor can render them in one strip
     * with consistent styling and a single source of truth for "what's a
     * known token."
     */
    public function knownTokens(Request $request)
    {
        $this->authorize($request, 'can_view');

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

    /**
     * Given an HTML/text blob, extract every {{Token}} occurrence and split
     * them into known (employee field or registered custom field) vs unknown.
     * The editor uses the unknown list to surface an "Add as Custom Field"
     * CTA pre-filled with each unrecognised name.
     */
    public function validateTokens(Request $request)
    {
        $this->authorize($request, 'can_view');

        // Strip tags + decode entities before scanning so a token wrapped or
        // split by inline markup ({{<b>Name</b>}}) still counts — same rule
        // computeUsage() uses on the index endpoint.
        $html = (string) $request->input('content_html', '');
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        preg_match_all('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/u', $text, $m);
        $found = array_values(array_unique($m[1] ?? []));

        // Built-in signer tokens follow a positional pattern — Signer{N}Name,
        // Signer{N}Designation, Signer{N}Date — and are resolved at gen time
        // from the template's own signers[] array. Treat them as known.
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

    /* ───── STORE / UPDATE / DESTROY ───── */

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

        // Refuse to delete a field that's actively referenced — the user has
        // to clean up the templates first. Senior-dev safety net: prevents
        // silently breaking documents that compile {{X}} placeholders.
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

    /* ───── HELPERS ───── */

    private function validatePayload(Request $request, ?int $id = null): array
    {
        return $request->validate([
            // PascalCase identifier — letters, digits, underscore; must start
            // with a letter or underscore. Same shape as a JavaScript ident.
            'name'         => ['required', 'string', 'max:100', 'regex:/^[A-Za-z_][A-Za-z0-9_]*$/'],
            'type'         => ['required', Rule::in(self::TYPES)],
            'description'  => 'nullable|string|max:500',
            // Free-text hint for which templates the user *intends* this field
            // to be used in. Independent of the server-derived `used_in` scan.
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

    /**
     * Scan every template in scope for each given name; return a map of
     *   name => [ 'templates' => [{id, code, name}], 'count' => int ]
     *
     * Match rules (kept aligned with the frontend's extractTokens regex so
     * both sides agree on what counts as "this template references X"):
     *   - tolerate whitespace inside the braces: {{ Name }} === {{Name}}
     *   - tolerate stray HTML markup splitting the token, e.g.
     *     "{{<span>Name</span>}}" or "{{Name<br></br>}}" — Tiptap and the
     *     DOCX importer can interleave tags inside a run, especially when
     *     formatting touches a placeholder. We strip tags from a sanitised
     *     copy before scanning rather than trying to grok HTML in regex.
     *
     * Performance: one SELECT for the templates in scope + one strip_tags +
     * one preg_match per (template, name) pair. For realistic sizes (low
     * hundreds × low dozens) this is sub-millisecond. If the working set
     * ever blows up, push the search into the DB (Postgres regexp_matches
     * over content_html) or denormalise into a join table.
     */
    private function computeUsage(Request $request, array $names): array
    {
        if (empty($names)) return [];

        $tpl = HrDocumentTemplate::query()
            ->select('id', 'code', 'name', 'content_html');
        $this->applyScopeTemplate($tpl, $request->user(), $request->integer('branch_id') ?: null);
        $templates = $tpl->get();

        // Pre-compute the plain-text view of each template once so per-name
        // scans don't repeat the strip_tags + html_entity_decode work.
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

    /**
     * Translate a raw QueryException into a clean user-facing JSON response.
     *
     * Why: with APP_DEBUG=true Laravel's default renderer dumps the full
     * SQL + file + line + trace into the response `message` field, which the
     * frontend toaster then surfaces verbatim. That leaks schema details and
     * is unreadable for end users. We catch the common SQLSTATEs explicitly
     * and fall back to a generic message for everything else; the raw
     * exception is logged so operators can still debug.
     *
     * @param  string $action  what the user was trying to do — used in the
     *                         leading clause of the toast ("Could not add …").
     */
    private function humaniseDbException(QueryException $e, string $action): JsonResponse
    {
        // Postgres / MySQL share most SQLSTATE codes — those used below are
        // Postgres canonical; MySQL maps the same situations to the same codes.
        $sqlState = $e->errorInfo[0] ?? null;
        $driver   = $e->errorInfo[1] ?? null;

        // Log the raw exception with full context so operators can debug, but
        // never echo it to the user.
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

    /* ───── auth + scoping (mirrors HrDocumentTemplateController) ───── */

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
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                $this->applySwitcherBranchFilter($q, $user, $branchFilter);
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

    /**
     * Same shape as applyScope() but for an HrDocumentTemplate query — kept
     * separate so future divergence (e.g. doc templates require Active status
     * for usage counts) doesn't bleed into the custom-fields scope itself.
     */
    private function applyScopeTemplate($q, $user, ?int $branchFilter = null): void
    {
        // Identical algorithm — share it via inlined call.
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
