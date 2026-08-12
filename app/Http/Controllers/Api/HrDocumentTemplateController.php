<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\HrDocumentTemplate;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\HrTemplateMatch;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;


class HrDocumentTemplateController extends Controller
{
    /* uploadDocx() calls docxPageLimitError(), which lives here along with the
       DOCX_MAX_PAGES constant it reads — the trait was never pulled in, so
       every .docx upload died on "Call to undefined method". ClmTradeDocument
       does the same page-limit check off the same trait.
       This class defines its own docxToHtml() and elementToHtml(); a class's
       own method wins over the trait's, so those two keep behaving exactly as
       they did. */
    use HandlesDocxHtmlRoundtrip;

    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
        'triggerPoint:id,module_name',
    ];

    private const MODULE_SLUG = 'hr.doc_templates';

    private const CATEGORIES   = ['IT', 'Non-IT', 'Legal'];
    // Role types now mirror the canonical designation levels stored in the
    // designation master (master_designations.level). Six values, exactly as
    // shown in the level-chip strip on the master.
    private const ROLE_TYPES   = ['Director / CEO', 'Head of Department (HOD)', 'Team Leader', 'Executive', 'Employee', 'Intern / Trainee'];
    private const STATUSES     = ['Draft', 'Active', 'Deprecated'];
    private const SIGN_MODES   = ['Sequential', 'Parallel'];
    private const EDITOR_MODES = ['web', 'word'];

    // Short codes baked into the auto-generated template code (IT-INT-001 etc).
    private const CAT_SHORT  = ['IT' => 'IT',  'Non-IT' => 'NIT', 'Legal' => 'LGL'];
    private const ROLE_SHORT = [
        'Director / CEO'           => 'DIR',
        'Head of Department (HOD)' => 'HOD',
        'Team Leader'              => 'TL',
        'Executive'                => 'EXE',
        'Employee'                 => 'EMP',
        'Intern / Trainee'         => 'INT',
    ];

    private const DOCX_MAX_KB = 20 * 1024;
    // Soft page cap for an uploaded DOCX template. Lenient by design (contracts
    // /policies run long); tune as policy dictates. See docxPageLimitError().
    private const DOCX_MAX_PAGES = 30;

    /* ───── LIST / SHOW / NEXT-CODE / STATS ───── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HrDocumentTemplate::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                    ->orWhere('code', 'ilike', "%{$search}%")
                    ->orWhere('description', 'ilike', "%{$search}%");
            });
        }
        if ($cat = $request->query('employee_category')) $q->where('employee_category', $cat);
        if ($role = $request->query('role_type'))        $q->where('role_type', $role);
        if ($docType = $request->query('doc_type'))      $q->where('doc_type', $docType);
        if ($trig = $request->query('trigger_point_id')) $q->where('trigger_point_id', $trig);
        if ($status = $request->query('status'))         $q->where('status', $status);

        return response()->json($q->orderByDesc('id')->get());
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        return response()->json($this->resolveRow($request, (int) $id));
    }

    public function nextCode(Request $request)
    {
        $this->authorize($request, 'can_view');
        [$clientId, $branchId] = $this->resolveOwnership($request);

        $cat  = (string) $request->query('employee_category', 'IT');
        $role = (string) $request->query('role_type', 'Intern');

        return response()->json([
            'code'   => $this->peekNextCode($clientId, $branchId, $cat, $role),
            'prefix' => $this->codePrefix($cat, $role),
        ]);
    }

    /**
     * GET /hr-document-templates/last-branding
     *
     * Header/footer config of the caller's most recent template, so a NEW
     * template can prefill the same letterhead (logo / title / footer) instead
     * of re-uploading it every time. Scoped like the list; null when the tenant
     * has no prior template.
     */
    public function lastBranding(Request $request)
    {
        $this->authorize($request, 'can_view');
        $q = HrDocumentTemplate::query()->whereNotNull('header_config');
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        $row = $q->orderByDesc('id')->first(['header_config', 'footer_config']);
        return response()->json([
            'header_config' => $row->header_config ?? null,
            'footer_config' => $row->footer_config ?? null,
        ]);
    }

    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HrDocumentTemplate::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        if ($cat  = $request->query('employee_category')) $q->where('employee_category', $cat);
        if ($role = $request->query('role_type'))         $q->where('role_type', $role);

        $rows = (clone $q)->selectRaw('status, COUNT(*) as c')->groupBy('status')->pluck('c', 'status');
        $get = fn(string $s) => (int) ($rows[$s] ?? 0);

        // Per-category counts for the IT/Non-IT/Legal top tabs.
        $byCat = HrDocumentTemplate::query();
        $this->applyScope($byCat, $request->user(), $request->integer('branch_id') ?: null);
        $catRows = (clone $byCat)
            ->selectRaw('employee_category, COUNT(*) as c')
            ->groupBy('employee_category')
            ->pluck('c', 'employee_category');

        return response()->json([
            'total'       => (int) $rows->sum(),
            'active'      => $get('Active'),
            'draft'       => $get('Draft'),
            'deprecated'  => $get('Deprecated'),
            'by_category' => [
                'IT'     => (int) ($catRows['IT'] ?? 0),
                'Non-IT' => (int) ($catRows['Non-IT'] ?? 0),
                'Legal'  => (int) ($catRows['Legal'] ?? 0),
            ],
        ]);
    }

    /* ───── STORE / UPDATE / DESTROY ───── */

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            [$clientId, $branchId] = $this->resolveOwnership($request);

            $payload = array_merge($data, [
                'client_id'  => $clientId,
                'branch_id'  => $branchId,
                'created_by' => $auth?->id,
                'code'       => $this->allocateCode($clientId, $branchId, $data['employee_category'], $data['role_type']),
                'version'    => $data['version']    ?? 'v1',
                'status'     => $data['status']     ?? 'Draft',
            ]);
            $row = HrDocumentTemplate::create($payload);

            if ($request->hasFile('docx')) {
                [$path, $orig] = $this->storeDocx($request->file('docx'), $clientId, $row->id);
                $row->update(['docx_path' => $path, 'docx_original_name' => $orig, 'editor_mode' => 'word']);
            }

            $row->load(self::WITH);
            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'edit');

        $data = $this->validatePayload($request, $row->id);

        // Re-allocate the code only if the category or role changed; the
        // template's old code is otherwise stable across edits.
        if (
            isset($data['employee_category']) && isset($data['role_type'])
            && ($data['employee_category'] !== $row->employee_category || $data['role_type'] !== $row->role_type)
        ) {
            $data['code'] = $this->allocateCode($row->client_id, $row->branch_id, $data['employee_category'], $data['role_type']);
        }

        if ($request->hasFile('docx')) {
            [$path, $orig] = $this->storeDocx($request->file('docx'), $row->client_id, $row->id);
            $data['docx_path'] = $path;
            $data['docx_original_name'] = $orig;
            $data['editor_mode'] = 'word';
        }

        $row->update($data);
        $row->load(self::WITH);
        return response()->json($row);
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            Storage::disk('public')->delete($row->docx_path);
        }
        $row->delete();
        return response()->json(['message' => 'Template removed.']);
    }

    /* ───── DOCX — download generated, upload revised ───── */

    /**
     * Build a DOCX from the template's stored HTML content and stream it
     * back. Used by the "Download DOCX" button on the MS Word tab.
     */
    public function downloadDocx(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        // Prefer the user's uploaded .docx so a re-download returns their EXACT
        // Word file — every table, font, image and layout they edited is kept
        // byte-for-byte. The file they edited was itself produced by our
        // renderer (header logo + footer already baked in), so the logo
        // round-trips INSIDE the uploaded file; re-rendering here would discard
        // all their hand formatting just to re-stamp a logo that's already
        // present. Verify the real file is on disk with is_file() (a DB row can
        // reference a docx_path whose file is absent in this environment;
        // download()-ing a missing path throws) and only fall back to a fresh
        // render when there's no usable upload.
        if ($row->docx_path) {
            // localFile() resolves to the real local file (local disk) OR a temp
            // copy streamed down from Azure (server). Either way native
            // download() gets a path it can open. Clean up the temp after send.
            $abs = $this->localFile($row->docx_path, $isTemp);
            if ($abs) {
                $name = $row->docx_original_name ?: ($row->code ?: 'template') . '.docx';
                $resp = response()->download($abs, $name);
                return $isTemp ? $resp->deleteFileAfterSend(true) : $resp;
            }
        }

        // No uploaded file yet → render fresh from content_html with the header
        // logo (from header_config OR the latest logo uploaded for this client)
        // and footer embedded, so the first download already carries the logo.
        return $this->renderDocx($row, ($row->code ?: 'template') . '.docx');
    }

    /**
     * Upload a revised DOCX. We store it as-is for later re-download and
     * also parse its HTML for the web editor so the user can keep editing
     * inline after uploading.
     */
    public function uploadDocx(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $request->validate(['docx' => 'required|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB]);

        $row = $this->resolveRow($request, (int) $id);

        // Parse from the uploaded file's REAL local temp path (getRealPath) — NOT
        // from the stored path. On the server the public disk is Azure Blob, so
        // Storage::path() of the stored file isn't a real local file and every
        // native reader (PhpWord, ZipArchive) would fail. The PHP upload temp
        // file is always local, so parse it first, then push it to storage.
        $uploaded = $request->file('docx');
        $abs = $uploaded->getRealPath();

        // Best-effort DOCX → HTML so the web editor stays usable. If parsing
        // fails (legacy .doc, embedded media, etc) we keep the upload but
        // skip the HTML refresh.
        $html = $row->content_html;
        try {
            $html = $this->docxToHtml($abs) ?: $row->content_html;
        } catch (\Throwable $e) {
            // ignore — file is saved, web editor falls back to previous content
        }

        // Checked AFTER the parse (the converted body is the fallback measure)
        // but BEFORE storing, so an oversized file never lands in the bucket or
        // replaces the template's current DOCX.
        if ($err = $this->docxPageLimitError($abs, $html)) {
            return response()->json(['status' => false, 'message' => $err], 422);
        }

        [$path, $orig] = $this->storeDocx($uploaded, $row->client_id, $row->id);

        $update = [
            'docx_path'          => $path,
            'docx_original_name' => $orig,
            'editor_mode'        => 'word',
            'content_html'       => $html,
        ];

        // Lift the header/footer the user edited INSIDE Word back into the
        // template (logo + title/subtitle + footer text) so the preview and
        // future renders reflect it — otherwise only the downloaded file would
        // carry the changes. Each piece is applied only when present, so an
        // upload missing a logo/title/footer never wipes the existing value.
        // (Parsed from $abs, the local upload temp file resolved above.)
        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $headerChanged = false;
        $footerChanged = false;

        $logo = $this->extractHeaderLogo($abs, $row->client_id);
        if ($logo) {
            $headerCfg['logo_path'] = $logo['path'];
            $headerCfg['logo_url']  = $logo['url'];
            $headerCfg['show_logo'] = true;
            $headerChanged = true;
        }

        $hf = $this->extractHeaderFooterText($abs);
        if (!empty($hf['header'])) {
            $headerCfg['title']    = $hf['header']['title'];
            $headerCfg['subtitle'] = $hf['header']['subtitle'];
            $headerChanged = true;
        }
        if (!empty($hf['footer'])) {
            $footerCfg['text'] = $hf['footer']['text'];
            $footerChanged = true;
        }

        if ($headerChanged) $update['header_config'] = $headerCfg;
        if ($footerChanged) $update['footer_config'] = $footerCfg;

        $row->update($update);
        $row->load(self::WITH);
        return response()->json($row);
    }

    /* ───── ONBOARDING INTEGRATION ───── */

    /**
     * Department-name → employee_category. The Document Template Master
     * categorises templates into IT / Non-IT / Legal; the onboarding flow
     * picks the employee's department and we have to slot it into one of
     * those buckets. Anything that doesn't smell like IT or Legal goes to
     * Non-IT (Accounts, Logistics, HR, Operations, etc.).
     */
    /* Moved to App\Support\HrTemplateMatch so the onboarding-completion guard
       matches templates by exactly the same rules this endpoint does. */
    private function mapDepartmentToCategory(?string $deptName): string
    {
        return HrTemplateMatch::categoryForDepartment($deptName);
    }

    /**
     * GET /api/hr-document-templates/match?employee_id=N
     *
     * Returns the Active templates whose (employee_category, role_type)
     * matches the given employee's (department-mapped-category,
     * designation.level). Used by the Onboarding > Evidence Vault to
     * surface generable documents (Offer Letter, NDA, Welcome Kit, etc).
     */
    public function matchForEmployee(Request $request)
    {
        $this->authorize($request, 'can_view');
        $request->validate([
            'employee_id'         => 'required|integer|exists:employees,id',
            'trigger_point_name'  => 'sometimes|nullable|string|max:255',
            // Substring/keyword variant — preferred over trigger_point_name
            // because branch users name their trigger-point rows freely
            // ("Exit process trigger point", "Onboarding point", …) and
            // the page can't rely on an exact title. Frontend now passes
            // just the lifecycle keyword ('onboarding' / 'exit') and we
            // LIKE-match against module_name.
            'trigger_keyword'     => 'sometimes|nullable|string|max:120',
        ]);

        $emp = Employee::with(['department:id,name', 'designation:id,name,level'])
            ->find((int) $request->query('employee_id'));

        // If the employee row is missing (deleted or wrong id), return an
        // empty template set rather than allowing a ModelNotFoundException
        // to bubble up and convert into a 404. The SPA expects an empty
        // `templates` array when no matching templates are found.
        if (!$emp) {
            return response()->json([
                'employee_category'  => null,
                'role_type'          => null,
                'department_name'    => null,
                'designation_name'   => null,
                'trigger_point_name' => null,
                'trigger_keyword'    => null,
                'templates'          => [],
            ]);
        }

        $category = HrTemplateMatch::categoryForDepartment($emp->department?->name);
        $level    = $emp->designation?->level;  // 'Director / CEO' | 'Head of Department (HOD)' | …

        // Optional lifecycle filter. Two variants, both handled by the matcher:
        //   - trigger_keyword (preferred) — substring LIKE match against
        //     module_name. Frontend passes just the lifecycle word
        //     ("onboarding" / "exit"), and any trigger row containing
        //     that keyword qualifies. Tolerates branch-user naming
        //     freedom ("Onboarding point", "Exit process trigger point").
        //   - trigger_point_name (legacy) — exact case-/whitespace-
        //     insensitive equality. Kept for any external callers still
        //     using the old contract.
        $keyword   = trim((string) $request->query('trigger_keyword', ''));
        $exactName = trim((string) $request->query('trigger_point_name', ''));

        // null = a keyword was asked for and no trigger point carries it, so
        // nothing can match. Return an empty list rather than an unfiltered one.
        $q = HrTemplateMatch::query($emp, $keyword, $exactName);
        if (!$q) {
            return response()->json([
                'employee_category'  => $category,
                'role_type'          => $level,
                'department_name'    => $emp->department?->name,
                'designation_name'   => $emp->designation?->name,
                'trigger_point_name' => $exactName ?: null,
                'trigger_keyword'    => $keyword ?: null,
                'templates'          => [],
            ]);
        }
        $q->with(self::WITH);

        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        return response()->json([
            'employee_category'  => $category,
            'role_type'          => $level,
            'department_name'    => $emp->department?->name,
            'designation_name'   => $emp->designation?->name,
            'trigger_point_name' => $exactName ?: null,
            'trigger_keyword'    => $keyword ?: null,
            'templates'          => $q->orderByDesc('id')->get(),
        ]);
    }

    /**
     * GET /api/hr-document-templates/{id}/generate?employee_id=N
     *
     * Resolves the template's {{Tokens}} against the employee's data and
     * streams the filled DOCX back to the client. Same header/footer baked
     * in as the plain download endpoint — just with placeholders replaced.
     */
    public function generateForEmployee(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $request->validate(['employee_id' => 'required|integer|exists:employees,id']);

        $row = $this->resolveRow($request, (int) $id);
        $emp = Employee::with([
            'department:id,name',
            'designation:id,name,level',
            'primaryRole:id,name',
            'reportingManager:id,display_name,first_name,last_name',
            'workCountry:id,name',
        ])->findOrFail((int) $request->query('employee_id'));

        $context = $this->buildTokenContext($emp, $row->signers ?? []);
        $resolvedHtml = $this->resolveTokens((string) $row->content_html, $context);

        // Reuse the existing DOCX builder by temporarily swapping
        // content_html on a non-persisted clone so we don't have to
        // duplicate the header/footer + table emission code.
        $clone = $row->replicate();
        $clone->setRawAttributes($row->getAttributes(), true);  // preserve casts
        $clone->id = $row->id;
        $clone->content_html = $resolvedHtml;
        // Push the clone through the same renderer used by downloadDocx().
        return $this->renderDocx($clone, ($emp->display_name ?: ('EMP-' . $emp->id)) . ' - ' . ($row->name ?: $row->code) . '.docx');
    }

    /**
     * GET /api/hr-document-templates/{id}/preview?employee_id=N
     *
     * Returns the template's resolved body HTML + header/footer config so
     * the SPA can render a live, page-style preview without round-tripping
     * through DOCX. Used by the "View" button on the Evidence Vault.
     */
    public function previewForEmployee(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $request->validate(['employee_id' => 'required|integer|exists:employees,id']);

        $row = $this->resolveRow($request, (int) $id);
        $emp = Employee::with([
            'department:id,name',
            'designation:id,name,level',
            'primaryRole:id,name',
            'reportingManager:id,display_name,first_name,last_name',
        ])->findOrFail((int) $request->query('employee_id'));

        $context = $this->buildTokenContext($emp, $row->signers ?? []);
        $resolvedHtml = $this->resolveTokens((string) $row->content_html, $context);

        // Surface which tokens did and didn't resolve so the Vault can warn
        // the user about unfilled placeholders before they generate.
        $tokensInTemplate = [];
        if (preg_match_all('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/', (string) $row->content_html, $m)) {
            $tokensInTemplate = array_values(array_unique($m[1]));
        }
        // "Missing" = the token isn't recognised at all. A known token with
        // an empty value (e.g. an employee whose Mobile field is blank) is
        // resolved-as-empty, not missing — flagging those as missing turns
        // the SPA's warning chip into a permanent false-positive.
        $unresolved = array_values(array_filter(
            $tokensInTemplate,
            fn($t) =>
            !array_key_exists($t, $context)
        ));

        return response()->json([
            'id'             => $row->id,
            'code'           => $row->code,
            'name'           => $row->name,
            'content_html'   => $resolvedHtml,
            'header_config'  => $row->header_config,
            'footer_config'  => $row->footer_config,
            'tokens_used'    => $tokensInTemplate,
            'tokens_missing' => $unresolved,
        ]);
    }

    /**
     * Token catalogue. Mirrors the placeholder sidebar in TemplateEditor
     * exactly — every token the user can click in the editor must resolve
     * to a meaningful string here (or empty if the underlying field is
     * null). Signer placeholders resolve to the role names captured in
     * step 2 of the wizard; signing date is left blank until the doc is
     * actually counter-signed.
     */
    private function buildTokenContext(Employee $emp, $signers): array
    {
        $signers = is_array($signers) ? $signers : (is_string($signers) ? json_decode($signers, true) : []);
        $signers = is_array($signers) ? $signers : [];

        $ctx = [
            // Basic
            'FirstName'      => (string) ($emp->first_name ?? ''),
            'MiddleName'     => (string) ($emp->middle_name ?? ''),
            'LastName'       => (string) ($emp->last_name ?? ''),
            'FullName'       => (string) ($emp->display_name ?? trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))),
            'DisplayName'    => (string) ($emp->display_name ?? ''),
            'EmployeeNumber' => (string) ($emp->emp_code ?? $emp->id),

            // Contact
            'Email'   => (string) ($emp->email ?? ''),
            'Mobile'  => (string) ($emp->mobile ?? ''),
            'Address' => trim(((string) ($emp->address_line1 ?? '')) . ' ' . ((string) ($emp->address_line2 ?? ''))),
            'City'    => (string) ($emp->city ?? ''),
            'State'   => '',

            // Job
            'JobTitle'    => (string) ($emp->designation?->name ?? ''),
            'Department'  => (string) ($emp->department?->name ?? ''),
            'Designation' => (string) ($emp->designation?->name ?? ''),
            'JoiningDate' => $emp->date_of_joining ? $emp->date_of_joining->format('d M Y') : '',
            'ReportsTo'   => (string) ($emp->reportingManager?->display_name ?? ''),

            // Salary
            'CTC'   => $emp->annual_salary !== null ? number_format((float) $emp->annual_salary, 2) : '',
            'Basic' => '',
            'HRA'   => '',

            // Organisation — best-effort from the tenant Client row.
            'CompanyName'    => (string) ($emp->client?->org_name ?? ''),
            'CompanyAddress' => '',
            'CompanyLogo'    => '',
        ];

        // Signer{N}{Name|Date} — N is 1-indexed, matching the editor sidebar.
        foreach ($signers as $i => $s) {
            $n = $i + 1;
            $ctx["Signer{$n}Name"] = (string) ($s['role_name'] ?? $s['designation_name'] ?? '');
            $ctx["Signer{$n}Date"] = '';
            // Designation token is still resolved in case a legacy template
            // references it — value falls back to role name when the wizard
            // didn't capture a designation per signer.
            $ctx["Signer{$n}Designation"] = (string) ($s['designation_name'] ?? $s['role_name'] ?? '');
        }

        return $ctx;
    }

    /** Replace every {{Token}} occurrence in $html using $ctx. Unknown
     *  tokens are left as-is so an admin can spot them in the output.
     *
     *  When $preserveSignerSlots is true, the per-signer fill-at-action
     *  tokens ({{Signer{N}Sign}} and {{Signer{N}Date}}) are NOT substituted
     *  even when present in $ctx — they're left as literal placeholders so
     *  the signature workflow can fill them when each signer acts. Used by
     *  HrDocumentSignatureController::store() when freezing content_html at
     *  send time; preview/generate flows leave this false to render unsigned
     *  slots as empty strings. */
    private function resolveTokens(string $html, array $ctx, bool $preserveSignerSlots = false): string
    {
        return preg_replace_callback('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/', function ($m) use ($ctx, $preserveSignerSlots) {
            $key = $m[1];
            if ($preserveSignerSlots && preg_match('/^Signer\d+(Sign|Date)$/', $key)) {
                return $m[0];
            }
            return array_key_exists($key, $ctx) ? htmlspecialchars((string) $ctx[$key], ENT_QUOTES) : $m[0];
        }, $html);
    }

    /**
     * Shared DOCX builder. Public + duck-typed so the signature controller
     * can reuse it against an HrDocumentSignature row (which carries the
     * same `content_html` / `header_config` / `footer_config` triple).
     *
     * Stage 1 — buildDocxFile — produces a tmp file path. Used by the
     * email-attachment path so we can attach + unlink after sending.
     * Stage 2 — renderDocx — wraps stage 1 + streams as a download.
     */
    /**
     * Resolve a header logo into a path PhpWord can actually embed.
     *
     * PhpWord's image element only accepts JPG/PNG/GIF/BMP. An uploaded SVG or
     * WEBP logo renders fine in the web editor's <img> preview but silently
     * fails addImage() — which is why the logo "disappears" in the downloaded
     * Word file. We convert WEBP (via GD) and SVG (via Imagick when present) to
     * a temporary PNG so the logo lands in the .docx. Returns null only when the
     * file is missing or genuinely can't be rasterised.
     */
    /**
     * Fallback logo lookup — the header logo is uploaded via uploadHeaderLogo()
     * which stores the file under doc_templates/c{clientId}/logos/, but the path
     * isn't always written back into the template's header_config. When that
     * happens we fetch the MOST RECENTLY uploaded logo for this client straight
     * from that folder so the download still carries a logo.
     */
    public function latestClientLogo($clientId): ?string
    {
        $folder = 'doc_templates/c' . ($clientId ?: 'public') . '/logos';
        if (!Storage::disk('public')->exists($folder)) return null;
        $files = Storage::disk('public')->files($folder);
        if (empty($files)) return null;
        usort($files, fn($a, $b) =>
        Storage::disk('public')->lastModified($b) <=> Storage::disk('public')->lastModified($a));
        return $files[0];
    }

    /**
     * Return a guaranteed LOCAL filesystem path for a file on the 'public' disk.
     *
     * On local disks this is just ->path(). On the SERVER the public disk is
     * Azure Blob (FILESYSTEM_DISK=azure) where blobs have NO local path —
     * ->path() returns a string that native libraries (ZipArchive, PhpWord's
     * IOFactory, getimagesize, PhpWord addImage) cannot open. So for remote
     * disks we stream the bytes into a temp file (keeping the original
     * extension) and hand that back. Returns null when the source is missing.
     *
     * The boolean out-param $isTemp tells the caller whether the returned path
     * is a throwaway copy it should unlink / deleteFileAfterSend.
     */
    private function localFile(?string $path, ?bool &$isTemp = null): ?string
    {
        $isTemp = false;
        if (!$path) return null;
        $disk = Storage::disk('public');
        if (!$disk->exists($path)) return null;

        // Local adapter — real file already on disk, use it directly.
        try {
            $local = $disk->path($path);
            if (is_string($local) && is_file($local)) return $local;
        } catch (\Throwable $e) { /* non-local adapter → copy below */ }

        // Remote adapter (Azure/S3) — pull the bytes into a temp local file.
        try {
            $bytes = $disk->get($path);
            if ($bytes === null) return null;
            $ext = pathinfo($path, PATHINFO_EXTENSION) ?: 'tmp';
            $tmp = tempnam(sys_get_temp_dir(), 'cbc_') . '.' . $ext;
            file_put_contents($tmp, $bytes);
            $isTemp = true;
            return $tmp;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function resolveDocxLogo(?string $logoPath): ?string
    {
        // localFile() copies Azure blobs to a temp file so addImage() works on
        // the server (where ->path() isn't a real local file).
        $abs = $this->localFile($logoPath);
        if (!$abs) return null;
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));

        // Formats PhpWord embeds natively — pass straight through.
        if (in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'bmp'], true)) return $abs;

        // WEBP → PNG via GD (bundled with PHP on XAMPP). Preserve transparency.
        if ($ext === 'webp' && function_exists('imagecreatefromwebp')) {
            try {
                $img = @imagecreatefromwebp($abs);
                if ($img) {
                    imagepalettetotruecolor($img);
                    imagealphablending($img, false);
                    imagesavealpha($img, true);
                    $tmp = tempnam(sys_get_temp_dir(), 'logo_') . '.png';
                    imagepng($img, $tmp);
                    imagedestroy($img);
                    return $tmp;
                }
            } catch (\Throwable $e) { /* fall through to null */
            }
        }

        // SVG → rasterise via Imagick when the extension is available.
        if ($ext === 'svg' && class_exists('Imagick')) {
            try {
                $im = new \Imagick();
                $im->setBackgroundColor(new \ImagickPixel('transparent'));
                $im->readImage($abs);
                $im->setImageFormat('png');
                $tmp = tempnam(sys_get_temp_dir(), 'logo_') . '.png';
                $im->writeImage($tmp);
                $im->clear();
                return $tmp;
            } catch (\Throwable $e) { /* fall through to null */
            }
        }

        return null;
    }

    public function buildDocxFile($row): string
    {
        $phpWord = new PhpWord();
        // A4 in twips as INTEGERS — PhpWord's default computes these from
        // inches with floating-point math and emits decimals (e.g.
        // w:w="11905.51181..."), which Word rejects as a schema violation
        // ("can't parse XML at line 2"). Hard-coding the spec values forces
        // valid <w:pgSz> regardless of php's serialize_precision.
        $section = $phpWord->addSection([
            'pageSizeW'    => 11906,
            'pageSizeH'    => 16838,
            'headerHeight' => 90 * 20,
            'footerHeight' => 50 * 20,
        ]);

        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        // Prefer the path saved in header_config; if it's missing (the frontend
        // didn't persist it), fall back to the latest logo uploaded for this
        // client via uploadHeaderLogo() so the logo still lands in the DOCX.
        $logoPath  = $headerCfg['logo_path'] ?: $this->latestClientLogo($row->client_id);
        $title     = (string) ($headerCfg['title'] ?? '');
        $subtitle  = (string) ($headerCfg['subtitle'] ?? '');
        $hAlign    = (string) ($headerCfg['align']    ?? 'right');
        // Logo size — pixels in the SPA, clamped 24-200. DOCX uses the same
        // pixel scale so the exported Word doc matches the on-screen preview.
        // Width is left to PhpWord's auto-scale (passed as 0) so non-2:1
        // logos aren't squished; ratio is preserved from the source image.
        $logoH     = (int) max(24, min(200, $headerCfg['logo_height'] ?? 60));

        $header = $section->addHeader();
        $table = $header->addTable([
            'borderSize' => 0,
            'cellMargin' => 0,
            'unit'  => \PhpOffice\PhpWord\SimpleType\TblWidth::PERCENT,
            'width' => 100 * 50,
        ]);
        $row1 = $table->addRow();
        $logoCell  = $row1->addCell(3200, ['valign' => 'center']);
        $titleCell = $row1->addCell(6800, ['valign' => 'center']);
        $absLogo = $this->resolveDocxLogo($logoPath);
        if ($absLogo) {
            try {
                // Scale to fit the logo cell: cap by height (logo_height) AND by
                // a max width so a wide logo isn't clipped by the cell. Aspect
                // ratio is preserved by deriving the missing dimension from the
                // source image's real pixel size.
                $maxW = 200; // px — fits comfortably inside the ~32% logo cell
                $dim  = @getimagesize($absLogo);
                $iw   = $dim[0] ?? 0;
                $ih   = $dim[1] ?? 0;
                $h    = $logoH;
                $w    = ($ih > 0) ? (int) round($iw * $h / $ih) : 0;
                if ($w > $maxW && $iw > 0) {            // too wide → cap width, recompute height
                    $w = $maxW;
                    $h = (int) round($ih * $w / $iw);
                }
                $opts = ['height' => $h];
                if ($w > 0) $opts['width'] = $w;
                $logoCell->addImage($absLogo, $opts);
            } catch (\Throwable $e) {
                $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']);
            }
        }
        $align = $hAlign === 'left' ? 'left' : ($hAlign === 'center' ? 'center' : 'right');
        // Split on CR/LF so multi-line titles entered in the SPA preview
        // (Enter → \n) render as separate Word paragraphs instead of a
        // single run with literal newline glyphs.
        $addMultiline = function ($cell, string $text, array $font, array $para) {
            $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
            $first = true;
            foreach ($lines as $line) {
                if (!$first) $cell->addTextBreak(1, $font);
                $cell->addText($line, $font, $para);
                $first = false;
            }
        };
        if ($title !== '')    $addMultiline($titleCell, $title,    ['bold' => true, 'size' => 14], ['alignment' => $align]);
        if ($subtitle !== '') $addMultiline($titleCell, $subtitle, ['size' => 10, 'color' => '6B7280'], ['alignment' => $align]);

        $footerCfg  = is_array($row->footer_config) ? $row->footer_config : [];
        $footerText = (string) ($footerCfg['text']  ?? '');
        $fAlign     = (string) ($footerCfg['align'] ?? 'center');
        $showPage   = !empty($footerCfg['show_page_number']);
        $pnAlign    = (string) ($footerCfg['page_number_align']  ?? 'right');
        $pnFormat   = (string) ($footerCfg['page_number_format'] ?? 'Page N of M');
        $footer = $section->addFooter();
        $fTable = $footer->addTable([
            'borderSize' => 0,
            'cellMargin' => 0,
            'unit'  => \PhpOffice\PhpWord\SimpleType\TblWidth::PERCENT,
            'width' => 100 * 50,
        ]);
        $fRow = $fTable->addRow();
        $cells = [
            'left'   => $fRow->addCell(3333, ['valign' => 'center']),
            'center' => $fRow->addCell(3333, ['valign' => 'center']),
            'right'  => $fRow->addCell(3333, ['valign' => 'center']),
        ];
        if ($footerText !== '' && isset($cells[$fAlign])) {
            $cells[$fAlign]->addText($footerText, ['size' => 9, 'color' => '6B7280'], ['alignment' => $fAlign]);
        }
        if ($showPage && isset($cells[$pnAlign])) {
            $run = $cells[$pnAlign]->addTextRun(['alignment' => $pnAlign]);
            $style = ['size' => 9, 'color' => '6B7280'];
            switch ($pnFormat) {
                case 'N':
                    $run->addField('PAGE', [], [], '', false);
                    break;
                case 'Page N':
                    $run->addText('Page ', $style);
                    $run->addField('PAGE', [], [], '', false);
                    break;
                case 'N / M':
                    $run->addField('PAGE', [], [], '', false);
                    $run->addText(' / ', $style);
                    $run->addField('NUMPAGES', [], [], '', false);
                    break;
                case 'Page N of M':
                default:
                    $run->addText('Page ', $style);
                    $run->addField('PAGE', [], [], '', false);
                    $run->addText(' of ', $style);
                    $run->addField('NUMPAGES', [], [], '', false);
            }
        }

        $html = (string) ($row->content_html ?: '<p>(empty template)</p>');
        // PhpWord's Html::addHtml uses loadXML (not loadHTML) so the body
        // must be valid XML. Bare void tags from rich-text editors (<br>,
        // <hr>, <img ...>) abort parsing silently and drop everything that
        // follows. Self-close them before handing off.
        $html = preg_replace('/<br\s*>/i',  '<br/>',  $html);
        $html = preg_replace('/<hr\s*>/i',  '<hr/>',  $html);
        $html = preg_replace('/<img([^>]*[^\/])>/i', '<img$1/>', $html);
        $wrapped = '<html><body>' . $html . '</body></html>';
        try {
            Html::addHtml($section, $wrapped, false, false);
        } catch (\Throwable $e) {
            $section->addText(strip_tags($html));
        }

        $writer = IOFactory::createWriter($phpWord, 'Word2007');
        $tmp = tempnam(sys_get_temp_dir(), 'tpl_') . '.docx';
        $writer->save($tmp);
        return $tmp;
    }

    /**
     * Stage 2 — wraps {@see buildDocxFile()} and streams the generated DOCX
     * back to the browser. Used by the "Download DOCX" button and the
     * per-employee generate flow. The tmp file is removed once the response
     * is flushed via `deleteFileAfterSend`.
     */
    public function renderDocx($row, string $filename)
    {
        $tmp = $this->buildDocxFile($row);
        return response()->download($tmp, $filename)->deleteFileAfterSend(true);
    }

    /* ───── HELPERS ───── */

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

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function resolveRow(Request $request, int $id): HrDocumentTemplate
    {
        $q = HrDocumentTemplate::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function guardHierarchicalAction($user, HrDocumentTemplate $row, string $verb): void
    {
        if (!$user || $user->user_type === 'super_admin' || !$row->created_by) return;
        if ($row->created_by === $user->id) return;

        $rank = fn(?string $t) => match ($t) {
            'super_admin'  => 4,
            'client_admin' => 3,
            'client_user'  => 3,
            'branch_user'  => 2,
            'employee'     => 1,
            default        => 0,
        };
        $creator = User::find($row->created_by);
        if ($creator && $rank($creator->user_type) > $rank($user->user_type)) {
            abort(403, "You cannot {$verb} this template — created by a higher-privileged user.");
        }
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $isDraft  = strtolower((string) $request->input('status')) === 'draft';
        // On Draft saves and on edits, only category/role/name are strictly
        // required so the wizard can persist partial progress.
        $req = fn() => $isUpdate || $isDraft ? 'nullable' : 'required';

        return $request->validate([
            // 100, not the column's 191: an over-long name breaks the template
            // card + list layouts. Mirrors TEMPLATE_NAME_MAX in TemplateForm.tsx.
            'name'              => [$req(), 'string', 'max:100'],
            'description'       => 'nullable|string',
            'employee_category' => ['nullable', Rule::in(self::CATEGORIES)],
            'role_type'         => ['nullable', Rule::in(self::ROLE_TYPES)],
            'doc_type'          => 'nullable|string|max:100',
            'trigger_point_id'  => 'nullable|integer|exists:master_trigger_points,id',
            'version'           => 'nullable|string|max:10',

            'is_mandatory'              => 'nullable|boolean',
            'requires_signature'        => 'nullable|boolean',
            'requires_manager_approval' => 'nullable|boolean',
            'include_in_audit'          => 'nullable|boolean',

            'signing_mode' => ['nullable', Rule::in(self::SIGN_MODES)],
            'signers'      => 'nullable|array',
            'signers.*.role_id'           => 'nullable|integer',
            'signers.*.role_name'         => 'nullable|string|max:100',
            'signers.*.designation_id'    => 'nullable|integer',
            'signers.*.designation_name'  => 'nullable|string|max:100',
            'signers.*.action'            => 'nullable|string|max:30',
            'signers.*.days'              => 'nullable|integer|min:0|max:365',

            'editor_mode'  => ['nullable', Rule::in(self::EDITOR_MODES)],
            'content_html' => 'nullable|string',
            'docx'         => 'nullable|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB,

            // Header / footer config — both are stored as JSON. The frontend
            // owns the schema; we just validate that it's an object with the
            // expected keys present.
            'header_config'                  => 'nullable|array',
            'header_config.logo_path'        => 'nullable|string|max:500',
            'header_config.logo_url'         => 'nullable|string|max:500',
            'header_config.title'            => 'nullable|string|max:2000',
            'header_config.subtitle'         => 'nullable|string|max:2000',
            'header_config.align'            => ['nullable', Rule::in(['left', 'center', 'right', 'space-between'])],
            'header_config.background'       => 'nullable|string|max:30',
            'header_config.text_color'       => 'nullable|string|max:30',
            'header_config.show_logo'        => 'nullable|boolean',
            'header_config.show_title'       => 'nullable|boolean',
            'header_config.logo_height'      => 'nullable|integer|between:24,200',
            // Free-drag positions (percentages of the header container,
            // center-anchored). Saved alongside the rest of the config.
            'header_config.logo_pos'         => 'nullable|array',
            'header_config.logo_pos.x'       => 'nullable|numeric|between:0,100',
            'header_config.logo_pos.y'       => 'nullable|numeric|between:0,100',
            'header_config.title_pos'        => 'nullable|array',
            'header_config.title_pos.x'      => 'nullable|numeric|between:0,100',
            'header_config.title_pos.y'      => 'nullable|numeric|between:0,100',

            'footer_config'                       => 'nullable|array',
            'footer_config.text'                  => 'nullable|string|max:500',
            'footer_config.align'                 => ['nullable', Rule::in(['left', 'center', 'right'])],
            'footer_config.background'            => 'nullable|string|max:30',
            'footer_config.text_color'            => 'nullable|string|max:30',
            'footer_config.show_page_number'      => 'nullable|boolean',
            'footer_config.page_number_align'     => ['nullable', Rule::in(['left', 'center', 'right'])],
            'footer_config.page_number_format'    => ['nullable', Rule::in(['N', 'Page N', 'Page N of M', 'N / M'])],

            'status' => ['nullable', Rule::in(self::STATUSES)],
        ], [
            // Match the wording the form shows, so an API-side rejection reads
            // the same as the inline message.
            'name.max' => 'Template Name cannot exceed 100 characters.',
        ]);
    }

    /* ───── Header logo upload ───── */

    /**
     * Stand-alone endpoint for uploading the header logo image. Works
     * pre-save (no template id required) so the wizard can attach a logo
     * before the row exists, and the path then rides along in the main
     * save payload under header_config.logo_path.
     */
    public function uploadHeaderLogo(Request $request)
    {
        $this->authorize($request, 'can_add');
        $request->validate(['logo' => 'required|file|mimes:png,jpg,jpeg,svg,webp|max:5120']);

        [$clientId] = $this->resolveOwnership($request);
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "doc_templates/{$clientSlug}/logos";
        $file = $request->file('logo');
        $ext = strtolower($file->getClientOriginalExtension() ?: 'png');
        $filename = Str::random(16) . '.' . $ext;
        $path = $file->storeAs($folder, $filename, 'public');

        return response()->json([
            'path' => $path,
            'url'  => file_url($path),
        ]);
    }

    /* ───── code allocation ───── */

    private function codePrefix(string $cat, string $role): string
    {
        $c = self::CAT_SHORT[$cat]  ?? 'GEN';
        $r = self::ROLE_SHORT[$role] ?? 'GEN';
        return "{$c}-{$r}-";
    }

    private function allocateCode($clientId, $branchId, string $cat, string $role): string
    {
        $q = HrDocumentTemplate::query()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        $q->where('employee_category', $cat)->where('role_type', $role);
        return $this->buildNext($q->pluck('code'), $this->codePrefix($cat, $role));
    }

    private function peekNextCode($clientId, $branchId, string $cat, string $role): string
    {
        $q = HrDocumentTemplate::query();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        $q->where('employee_category', $cat)->where('role_type', $role);
        return $this->buildNext($q->pluck('code'), $this->codePrefix($cat, $role));
    }

    private function buildNext($codes, string $prefix): string
    {
        $max = 0;
        $regex = '/^' . preg_quote($prefix, '/') . '(\d+)$/i';
        foreach ($codes as $c) {
            if (preg_match($regex, (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return $prefix . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    /* ───── DOCX storage + parse ───── */

    /**
     * Best-effort page-limit guard for an uploaded DOCX. Word records the page
     * count in docProps/app.xml (<Pages>N</Pages>); when present and above the
     * cap we reject BEFORE storing. If the count can't be determined (a
     * programmatically-built docx often omits it) we do NOT block — the file
     * size is already capped by DOCX_MAX_KB.
     *
     * @param  string       $absPath  local path to the uploaded temp file
     * @param  string|null  $html     converted body (reserved for a future
     *                                HTML-based estimate; not required here)
     * @return string|null            error message when over the limit, else null
     */
    private function docxPageLimitError(string $absPath, ?string $html = null): ?string
    {
        try {
            $zip = new \ZipArchive();
            if ($zip->open($absPath) !== true) {
                return null;
            }
            $xml = $zip->getFromName('docProps/app.xml');
            $zip->close();
            if ($xml === false || $xml === '') {
                return null;
            }
            if (preg_match('/<Pages>\s*(\d+)\s*<\/Pages>/', $xml, $m)) {
                $pages = (int) $m[1];
                if ($pages > self::DOCX_MAX_PAGES) {
                    return 'This template is ' . $pages . ' pages — the limit is '
                        . self::DOCX_MAX_PAGES . ' pages. Please shorten the document and upload again.';
                }
            }
        } catch (\Throwable $e) {
            // Unreadable zip / missing property — a soft check must never block a
            // valid upload, so treat "can't tell" as "within limit".
        }
        return null;
    }

    private function storeDocx($file, $clientId, $templateId): array
    {
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "doc_templates/{$clientSlug}/t{$templateId}";
        $ext = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename = Str::random(16) . '.' . $ext;
        $path = $file->storeAs($folder, $filename, 'public');
        return [$path, $file->getClientOriginalName()];
    }

    /**
     * Pull the logo image out of an uploaded DOCX's header so a logo the user
     * swapped INSIDE Word is reflected back into the template (preview + future
     * renders), not just left as the old panel logo.
     *
     * A .docx is a zip: header parts live at word/header*.xml and the images
     * they reference are wired through word/_rels/header*.xml.rels (Type ending
     * in /image) → word/media/*. We grab the first image referenced by any
     * header and copy it into the client's logos folder. Returns ['path','url']
     * or null when the header carries no usable image (logo removed, never
     * present, or a vector/metafile a browser can't show).
     */
    private function extractHeaderLogo(string $docxAbsPath, $clientId): ?array
    {
        if (!class_exists('ZipArchive') || !is_file($docxAbsPath)) return null;

        $zip = new \ZipArchive();
        if ($zip->open($docxAbsPath) !== true) return null;

        try {
            $target = null; // e.g. "media/image1.png" (relative to word/)
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = $zip->getNameIndex($i);
                if (!is_string($name) || !preg_match('#^word/_rels/header\d*\.xml\.rels$#i', $name)) continue;
                $xml = $zip->getFromIndex($i);
                if ($xml === false) continue;
                // Match an image relationship regardless of attribute order.
                if (preg_match('#Type="[^"]*/image"[^>]*?Target="([^"]+)"#i', $xml, $m)
                 || preg_match('#Target="([^"]+)"[^>]*?Type="[^"]*/image"#i', $xml, $m)) {
                    $target = $m[1];
                    break;
                }
            }
            if (!$target) return null;

            // Resolve the relationship Target to an entry inside the zip. Header
            // rels are relative to word/, so "media/imageN.png" → word/media/...
            $target = str_replace('\\', '/', $target);
            $entry  = str_starts_with($target, '/')
                ? ltrim($target, '/')
                : 'word/' . ltrim($target, './');
            $data = $zip->getFromName($entry);
            if ($data === false) {
                $entry = 'word/media/' . basename($target);
                $data  = $zip->getFromName($entry);
                if ($data === false) return null;
            }

            // Only keep raster formats the web preview <img> and PhpWord both
            // understand. EMF/WMF/SVG inside a Word header can't render in a
            // browser, so skip rather than store a broken preview logo.
            $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION) ?: '');
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'bmp'], true)) return null;

            $clientSlug = $clientId ? 'c' . $clientId : 'public';
            $path = "doc_templates/{$clientSlug}/logos/" . Str::random(16) . '.' . $ext;
            Storage::disk('public')->put($path, $data);

            return ['path' => $path, 'url' => file_url($path)];
        } finally {
            $zip->close();
        }
    }

    /**
     * Read the header TITLE/SUBTITLE and footer TEXT a user typed inside Word
     * back out of an uploaded DOCX, so edits to those strings reflect into the
     * template (preview + future renders), same as the logo. Header/footer
     * parts live at word/header*.xml and word/footer*.xml.
     *
     * Returns ['header' => ['title','subtitle'], 'footer' => ['text']] with
     * only the keys we could read; missing/empty parts are omitted so the
     * caller never wipes an existing value with a blank.
     */
    private function extractHeaderFooterText(string $docxAbsPath): array
    {
        $result = [];
        if (!class_exists('ZipArchive') || !is_file($docxAbsPath)) return $result;

        $zip = new \ZipArchive();
        if ($zip->open($docxAbsPath) !== true) return $result;

        try {
            $headerParts = [];
            $footerParts = [];
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $n = $zip->getNameIndex($i);
                if (!is_string($n)) continue;
                if (preg_match('#^word/header\d*\.xml$#i', $n)) $headerParts[] = $n;
                if (preg_match('#^word/footer\d*\.xml$#i', $n)) $footerParts[] = $n;
            }
            sort($headerParts);
            sort($footerParts);

            // HEADER: first part that carries visible (non page-number) text.
            // Our generated header puts the title on the first text paragraph
            // and the subtitle on the second, so map them positionally.
            foreach ($headerParts as $hp) {
                $lines = array_values(array_filter(
                    array_map(fn ($p) => $p['field'] ? null : $p['text'], $this->docxPartParagraphs($zip, $hp))
                ));
                if ($lines) {
                    $result['header'] = ['title' => $lines[0] ?? '', 'subtitle' => $lines[1] ?? ''];
                    break;
                }
            }

            // FOOTER: first non page-number text paragraph is the footer line.
            foreach ($footerParts as $fp) {
                foreach ($this->docxPartParagraphs($zip, $fp) as $pa) {
                    if (!$pa['field']) { $result['footer'] = ['text' => $pa['text']]; break 2; }
                }
            }
        } finally {
            $zip->close();
        }

        return $result;
    }

    /**
     * Extract per-paragraph visible text from a header/footer XML part inside an
     * open DOCX zip. Each item is ['text' => string, 'field' => bool] where
     * `field` flags a paragraph that holds a PAGE/NUMPAGES field (page numbers),
     * so callers can skip those when looking for hand-typed header/footer text.
     */
    private function docxPartParagraphs(\ZipArchive $zip, string $entry): array
    {
        $xml = $zip->getFromName($entry);
        if ($xml === false) return [];

        $out = [];
        // Split on paragraph boundaries; each chunk is one <w:p>.
        foreach (preg_split('#<w:p[ >]#', $xml) as $chunk) {
            $isField = preg_match('#\b(PAGE|NUMPAGES)\b#', $chunk)
                    && preg_match('#w:(instrText|fldSimple|fldChar)#', $chunk);
            if (preg_match_all('#<w:t[^>]*>(.*?)</w:t>#s', $chunk, $m)) {
                $text = trim(html_entity_decode(implode('', $m[1]), ENT_QUOTES | ENT_XML1, 'UTF-8'));
                if ($text !== '') $out[] = ['text' => $text, 'field' => (bool) $isField];
            }
        }
        return $out;
    }

    /**
     * Lightweight DOCX → HTML extractor. PhpWord doesn't ship a stock HTML
     * reader so we walk the parsed model and stitch <p>/<b>/<i>/<u> tags
     * from the rich elements PhpWord understands. Good enough for the
     * "round-trip" use case where someone downloads, edits in Word, and
     * uploads back — preserves text + basic formatting + paragraph breaks.
     */
    private function docxToHtml(string $absPath): string
    {
        $phpWord = IOFactory::load($absPath);
        $html = '';
        foreach ($phpWord->getSections() as $section) {
            foreach ($section->getElements() as $el) {
                $html .= $this->elementToHtml($el);
            }
        }
        return trim($html) ?: '<p></p>';
    }

    private function elementToHtml($el): string
    {
        $cls = class_basename($el);

        if ($cls === 'TextRun') {
            $inner = '';
            foreach ($el->getElements() as $child) $inner .= $this->elementToHtml($child);
            return '<p>' . $inner . '</p>';
        }
        if ($cls === 'Text') {
            $text = htmlspecialchars($el->getText() ?? '', ENT_QUOTES);
            $f = $el->getFontStyle();
            if ($f) {
                if (method_exists($f, 'isBold')      && $f->isBold())      $text = "<b>{$text}</b>";
                if (method_exists($f, 'isItalic')    && $f->isItalic())    $text = "<i>{$text}</i>";
                if (method_exists($f, 'isUnderline') && $f->isUnderline()) $text = "<u>{$text}</u>";
            }
            return $text;
        }
        if ($cls === 'Title') {
            return '<h2>' . htmlspecialchars((string) $el->getText(), ENT_QUOTES) . '</h2>';
        }
        if ($cls === 'ListItem') {
            return '<li>' . htmlspecialchars((string) $el->getText(), ENT_QUOTES) . '</li>';
        }
        if ($cls === 'Table') {
            $rows = '';
            foreach ($el->getRows() as $r) {
                $cells = '';
                foreach ($r->getCells() as $cell) {
                    $cellInner = '';
                    foreach ($cell->getElements() as $child) $cellInner .= $this->elementToHtml($child);
                    $cells .= '<td>' . $cellInner . '</td>';
                }
                $rows .= '<tr>' . $cells . '</tr>';
            }
            return '<table border="1">' . $rows . '</table>';
        }
        if (method_exists($el, 'getText')) {
            return '<p>' . htmlspecialchars((string) $el->getText(), ENT_QUOTES) . '</p>';
        }
        return '';
    }
}
