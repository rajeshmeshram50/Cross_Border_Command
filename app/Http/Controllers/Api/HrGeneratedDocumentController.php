<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\HrDocumentTemplate;
use App\Models\HrGeneratedDocument;
use App\Models\Module;
use App\Models\Permission;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;


class HrGeneratedDocumentController extends Controller
{
    private const WITH = [
        'template:id,code,name,employee_category,role_type',
        'employee:id,emp_code,first_name,middle_name,last_name,display_name,email',
        'generator:id,name',
    ];

    private const MODULE_SLUG = 'hr.doc_templates';

    /* ───── PREVIEW ───── */

    /**
     * Render a single template/employee/custom-values combination and
     * return the resolved HTML + the token map used. No DB write — this
     * powers the Step 3 "Document Preview" cards in the wizard.
     */
    public function preview(Request $request)
    {
        $this->authorize($request, 'can_view');
        $data = $request->validate([
            'template_id'        => 'required|integer|exists:hr_document_templates,id',
            'employee_id'        => 'required|integer|exists:employees,id',
            'custom_values'      => 'nullable|array',
            'custom_values.*'    => 'nullable',
        ]);

        $tpl = $this->resolveTemplate($request, (int) $data['template_id']);
        $emp = $this->resolveEmployee($request, (int) $data['employee_id']);

        $customValues = $data['custom_values'] ?? [];
        $tokens = $this->resolveTokens($emp, $customValues, $tpl);
        // Bold any token the operator supplied a value for in Step 2 — these
        // are the "human-curated" parts of the document (registered custom
        // fields like LastWorkingDate, EffectiveDate, etc.) and need to pop
        // visually so reviewers can verify them at a glance.
        $boldNames = array_keys(array_filter($customValues, fn ($v) => $v !== '' && $v !== null));
        $html   = $this->renderTemplate((string) $tpl->content_html, $tokens, $boldNames);

        return response()->json([
            'rendered_html' => $html,
            'tokens'        => $tokens,
            'template'      => [
                'id' => $tpl->id, 'code' => $tpl->code, 'name' => $tpl->name,
            ],
            'employee'      => [
                'id' => $emp->id, 'emp_code' => $emp->emp_code,
                'full_name' => trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')),
            ],
        ]);
    }

    /* ───── BULK GENERATE ───── */

    /**
     * Bulk-render one row per employee for the given template + custom values.
     *
     * Payload shape:
     *   {
     *     template_id: int,
     *     recipients: [
     *       { employee_id, custom_values: { TokenName: value, ... } },
     *       ...
     *     ]
     *   }
     */
    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $request->validate([
            'template_id'                      => 'required|integer|exists:hr_document_templates,id',
            'recipients'                       => 'required|array|min:1',
            'recipients.*.employee_id'         => 'required|integer|exists:employees,id',
            'recipients.*.custom_values'       => 'nullable|array',
        ]);

        $tpl = $this->resolveTemplate($request, (int) $data['template_id']);
        if ($tpl->status !== 'Active') {
            abort(422, 'This template is not Active. Publish it before generating documents.');
        }

        try {
            return DB::transaction(function () use ($request, $data, $tpl) {
                $auth = $request->user();
                $now  = now();
                $generated = [];

                foreach ($data['recipients'] as $r) {
                    $emp = $this->resolveEmployee($request, (int) $r['employee_id']);
                    $custom = is_array($r['custom_values'] ?? null) ? $r['custom_values'] : [];

                    $tokens = $this->resolveTokens($emp, $custom, $tpl);
                    // Bold operator-supplied values — same rule as the preview
                    // endpoint, so what they see in Step 3 is what gets stored.
                    $boldNames = array_keys(array_filter($custom, fn ($v) => $v !== '' && $v !== null));
                    $html   = $this->renderTemplate((string) $tpl->content_html, $tokens, $boldNames);

                    $row = HrGeneratedDocument::create([
                        'client_id'     => $tpl->client_id,
                        'branch_id'     => $tpl->branch_id,
                        'template_id'   => $tpl->id,
                        'employee_id'   => $emp->id,
                        'rendered_html' => $html,
                        'custom_values' => $custom,
                        'resolved_vars' => $tokens,
                        'status'        => 'Generated',
                        'generated_by'  => $auth?->id,
                        'generated_at'  => $now,
                    ]);
                    $row->load(self::WITH);
                    $generated[] = $row;
                }

                return response()->json([
                    'count'     => count($generated),
                    'documents' => $generated,
                ], 201);
            });
        } catch (QueryException $e) {
            return $this->humaniseDbException($e, 'generate documents');
        }
    }

   public function index(Request $request): JsonResponse
    {
        $this->authorize($request, 'can_view');

        $q = HrGeneratedDocument::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($request->filled('employee_id')) {
            $q->where('employee_id', (int) $request->integer('employee_id'));
        }
        if ($request->filled('template_id')) {
            $q->where('template_id', (int) $request->integer('template_id'));
        }

        return response()->json($q->orderByDesc('id')->get());
    }

    /* ───── SHOW / DOWNLOAD ───── */

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        return response()->json($this->resolveRow($request, (int) $id));
    }

    /**
     * Build a DOCX from the row's stored rendered_html and stream it back.
     * Reuses the same renderer as the template editor's "Download DOCX" so
     * the output carries the template's header strip (logo + title +
     * subtitle), the body, and the footer (text + page number) — exactly
     * what the operator sees in the Step 3 preview.
     *
     * Filename: {template_code}-{employee_code}.docx
     */
    public function downloadDocx(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        if (!class_exists(PhpWord::class)) {
            abort(503, 'DOCX export is not available on this server — the phpoffice/phpword package is missing. Run "composer install" to enable downloads.');
        }

        $tpl = HrDocumentTemplate::find($row->template_id);
        if (!$tpl) abort(404, 'Source template missing.');

        // Non-persisted clone of the template with content_html swapped for
        // the row's fully-resolved HTML — the renderer handles the rest
        // (header strip, footer strip, page setup, font sizing).
        $clone = $tpl->replicate();
        $clone->setRawAttributes($tpl->getAttributes(), true);
        $clone->id = $tpl->id;
        $clone->content_html = (string) ($row->rendered_html ?: '<p>(empty document)</p>');

        $tplCode  = $tpl->code ?: 'doc';
        $empCode  = $row->employee?->emp_code ?: ('emp' . $row->employee_id);
        $filename = "{$tplCode}-{$empCode}.docx";

        return \App\Services\HrTemplateDocxRenderer::render($clone, $filename);
    }

    /* ───── VARIABLE RESOLVER ───── */

    /**
     * Build the full token → value map for one employee.
     *
     * Order of precedence (later wins):
     *   1. Employee-derived tokens (FirstName, JoiningDate, …)
     *   2. Template-derived tokens (Signer{N}*, CompanyName from branch)
     *   3. Operator-entered custom_values
     */
    private function resolveTokens(Employee $emp, array $customValues, ?HrDocumentTemplate $tpl): array
    {
        $emp->loadMissing(['department', 'designation', 'reportingManager', 'legalEntity', 'branch.client']);

        $first  = trim((string) ($emp->first_name ?? ''));
        $middle = trim((string) ($emp->middle_name ?? ''));
        $last   = trim((string) ($emp->last_name ?? ''));
        $full   = trim($first . ' ' . ($middle ? $middle . ' ' : '') . $last);

        $joining = $emp->date_of_joining
            ? Carbon::parse($emp->date_of_joining)->format('d M Y')
            : '';

        $manager = $emp->reportingManager;
        $managerName = $manager
            ? trim(((string) ($manager->first_name ?? '')) . ' ' . ((string) ($manager->last_name ?? '')))
            : '';

        $companyName = $emp->legalEntity?->legal_entity_name
            ?? $emp->branch?->client?->org_name
            ?? '';

        $tokens = [
            // Basic
            'FirstName'      => $first,
            'MiddleName'     => $middle,
            'LastName'       => $last,
            'FullName'       => $full,
            'DisplayName'    => (string) ($emp->display_name ?: $full),
            'EmployeeNumber' => (string) ($emp->emp_code ?? ''),

            // Contact
            'Email'   => (string) ($emp->email ?? ''),
            'Mobile'  => (string) ($emp->mobile ?? ''),
            'Address' => trim(((string) ($emp->address_line1 ?? '')) . ' ' . ((string) ($emp->address_line2 ?? ''))),
            'City'    => (string) ($emp->city ?? ''),
            'State'   => '', // resolved via master_states when relation exists; left blank for Phase 1

            // Job
            'JobTitle'    => (string) ($emp->designation?->name ?? ''),
            'Department'  => (string) ($emp->department?->name ?? ''),
            'Designation' => (string) ($emp->designation?->name ?? ''),
            'JoiningDate' => $joining,
            'ReportsTo'   => $managerName,

            // Salary — only the headline figure is stored on the employee row.
            // Basic/HRA breakdowns live in salary_structure (JSON) and are
            // deferred to Phase 2 when we wire the salary engine in.
            'CTC'   => (string) ($emp->annual_salary ?? ''),
            'Basic' => '',
            'HRA'   => '',

            // Organization
            'CompanyName'    => $companyName,
            'CompanyAddress' => '',
            'CompanyLogo'    => '',
        ];

        // Signer slot tokens — until the e-sign loop runs, the name/date
        // come from the template configuration, not from the actual signer.
        if ($tpl && is_array($tpl->signers)) {
            foreach ($tpl->signers as $i => $s) {
                $n = $i + 1;
                $tokens["Signer{$n}Name"]        = (string) ($s['role_name'] ?? '');
                $tokens["Signer{$n}Designation"] = (string) ($s['designation_name'] ?? '');
                $tokens["Signer{$n}Date"]        = '';
            }
        }

        // Operator overrides — wins over derived values so an HR user can
        // manually correct an auto-fetched field before generating.
        foreach ($customValues as $name => $val) {
            if (!is_string($name) || $name === '') continue;
            $tokens[$name] = is_scalar($val) ? (string) $val : '';
        }

        return $tokens;
    }

    /**
     * Substitute every {{Token}} in the template HTML with its resolved
     * value. Unknown tokens are left untouched so the operator notices them
     * in the preview. Placeholder-chip wrappers are stripped before
     * substitution so the rendered output isn't full of indigo pills.
     *
     * @param  string[] $boldNames  token names whose substituted value should
     *                              be wrapped in <strong> in the output —
     *                              used for operator-supplied custom field
     *                              values so they pop visually.
     */
    private function renderTemplate(string $html, array $tokens, array $boldNames = []): string
    {
        // Strip Tiptap PlaceholderNode chip wrappers — keep only the inner
        // {{Name}} text so the regex below can substitute it.
        $html = preg_replace(
            '/<span[^>]*data-placeholder="([^"]+)"[^>]*>([^<]*)<\/span>/',
            '$2',
            $html
        );

        $boldSet = array_flip($boldNames);

        return preg_replace_callback(
            '/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/u',
            function ($m) use ($tokens, $boldSet) {
                $name = $m[1];
                if (!array_key_exists($name, $tokens)) return $m[0];
                $val = htmlspecialchars((string) $tokens[$name], ENT_QUOTES, 'UTF-8');
                // Operator-supplied values render bold so reviewers can spot
                // the human-curated bits at a glance — and so the bold
                // round-trips into DOCX via PhpWord's <strong> handling.
                if (isset($boldSet[$name])) {
                    return '<strong>' . $val . '</strong>';
                }
                return $val;
            },
            (string) $html
        ) ?? $html;
    }

    /* ───── HELPERS ───── */

    private function resolveTemplate(Request $request, int $id): HrDocumentTemplate
    {
        $q = HrDocumentTemplate::query();
        $this->applyTemplateScope($q, $request->user(), $request->integer('branch_id') ?: null);
        return $q->findOrFail($id);
    }

    private function resolveEmployee(Request $request, int $id): Employee
    {
        $q = Employee::query();
        $this->applyEmployeeScope($q, $request->user(), $request->integer('branch_id') ?: null);
        return $q->findOrFail($id);
    }

    private function resolveRow(Request $request, int $id): HrGeneratedDocument
    {
        $q = HrGeneratedDocument::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        return $q->findOrFail($id);
    }

    private function humaniseDbException(QueryException $e, string $action): JsonResponse
    {
        $sqlState = $e->errorInfo[0] ?? null;
        Log::error('hr_generated_documents DB exception', [
            'action'    => $action,
            'sql_state' => $sqlState,
            'message'   => $e->getMessage(),
        ]);

        [$status, $message] = match ($sqlState) {
            '23503' => [422, "Cannot {$action} — one of the referenced records (template / employee) doesn't exist."],
            '23502' => [422, "A required field is missing. Please fill in every required input and try again."],
            '42703', '42P01' => [500, "The database schema is out of date. Run \"php artisan migrate\" and try again."],
            '08006', '08001', '08003', '08004' => [503, "Could not reach the database. Please try again in a moment."],
            default => [500, "Could not {$action} due to a database error. Please try again."],
        };
        return response()->json(['message' => $message], $status);
    }

    /* ───── auth + tenant scoping ───── */

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Document Templates module not enabled.');
        }
        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
    }

    /** Shared tenant-scope shape used for templates, employees, and generated rows. */
    private function applyScopeOnTable($q, $user, ?int $branchFilter = null): void
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

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        $this->applyScopeOnTable($q, $user, $branchFilter);
    }

    private function applyTemplateScope($q, $user, ?int $branchFilter = null): void
    {
        $this->applyScopeOnTable($q, $user, $branchFilter);
    }

    private function applyEmployeeScope($q, $user, ?int $branchFilter = null): void
    {
        $this->applyScopeOnTable($q, $user, $branchFilter);
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
}
