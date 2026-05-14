<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\HrDocumentTemplate;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;

/**
 * HR > Document & Evidence > Document Templates.
 *
 * Pattern follows AnnouncementController / RecruitmentController:
 *   - tenant scoping by (client_id, branch_id) with the usual main/sub
 *     branch hierarchy + BranchSwitcher narrowing
 *   - per-module permission flag check (module slug: hr.doc_templates)
 *   - tenant-isolated auto-numbered code (CAT-ROLE-NNN sequence per
 *     (client, branch, category, role) tuple)
 */
class HrDocumentTemplateController extends Controller
{
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
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

    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HrDocumentTemplate::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        if ($cat  = $request->query('employee_category')) $q->where('employee_category', $cat);
        if ($role = $request->query('role_type'))         $q->where('role_type', $role);

        $rows = (clone $q)->selectRaw('status, COUNT(*) as c')->groupBy('status')->pluck('c', 'status');
        $get = fn (string $s) => (int) ($rows[$s] ?? 0);

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
        if (isset($data['employee_category']) && isset($data['role_type'])
            && ($data['employee_category'] !== $row->employee_category || $data['role_type'] !== $row->role_type)) {
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

        // If the user uploaded a revised DOCX previously, prefer that.
        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $abs = Storage::disk('public')->path($row->docx_path);
            $name = $row->docx_original_name ?: ($row->code ?: 'template') . '.docx';
            return response()->download($abs, $name);
        }

        $phpWord = new PhpWord();
        // Section page setup — give the header + footer enough vertical room
        // to render at the heights the SPA preview uses (header ≈ 90pt, footer
        // ≈ 50pt). PhpWord expects twentieths of a point, hence the *20.
        $section = $phpWord->addSection([
            'headerHeight' => 90 * 20,
            'footerHeight' => 50 * 20,
        ]);

        // ── Header: logo + title (matches the fixed-height preview zone) ──
        $header = $section->addHeader();
        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $logoPath  = $headerCfg['logo_path'] ?? null;
        $title     = (string) ($headerCfg['title'] ?? '');
        $subtitle  = (string) ($headerCfg['subtitle'] ?? '');
        $hAlign    = (string) ($headerCfg['align']    ?? 'space-between');

        // Two-cell table so the logo can sit on one side and the title on
        // the other (Word's header has no flexbox; a 2-col table is the
        // standard trick).
        $table = $header->addTable([
            'borderSize'   => 0,
            'cellMargin'   => 0,
            'unit'         => \PhpOffice\PhpWord\SimpleType\TblWidth::PERCENT,
            'width'        => 100 * 50,
        ]);
        $row1 = $table->addRow();
        $logoCell  = $row1->addCell(2500, ['valign' => 'center']);
        $titleCell = $row1->addCell(7500, ['valign' => 'center']);

        $absLogo = $logoPath && Storage::disk('public')->exists($logoPath)
            ? Storage::disk('public')->path($logoPath) : null;
        if ($absLogo) {
            try {
                $logoCell->addImage($absLogo, ['height' => 60, 'width' => 120]);
            } catch (\Throwable $e) {
                $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']);
            }
        }
        $align = $hAlign === 'left' ? 'left' : ($hAlign === 'center' ? 'center' : 'right');
        if ($title !== '') {
            $titleCell->addText($title, ['bold' => true, 'size' => 14], ['alignment' => $align]);
        }
        if ($subtitle !== '') {
            $titleCell->addText($subtitle, ['size' => 10, 'color' => '6B7280'], ['alignment' => $align]);
        }

        // ── Footer ──
        // Word footers have no flex layout either — we use a 3-cell table
        // so footer.align and footer.page_number_align can point at separate
        // cells (matching the SPA preview). The page number is rendered as
        // live PAGE / NUMPAGES fields so it stays accurate across exports.
        $footer = $section->addFooter();
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $footerText = (string) ($footerCfg['text']  ?? '');
        $fAlign     = (string) ($footerCfg['align'] ?? 'center');
        $showPage   = !empty($footerCfg['show_page_number']);
        $pnAlign    = (string) ($footerCfg['page_number_align']  ?? 'right');
        $pnFormat   = (string) ($footerCfg['page_number_format'] ?? 'Page N of M');

        $fTable = $footer->addTable([
            'borderSize'   => 0,
            'cellMargin'   => 0,
            'unit'         => \PhpOffice\PhpWord\SimpleType\TblWidth::PERCENT,
            'width'        => 100 * 50,
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
            $cell  = $cells[$pnAlign];
            $style = ['size' => 9, 'color' => '6B7280'];
            $para  = ['alignment' => $pnAlign];
            // PhpWord's TextRun lets us interleave literal text with PAGE /
            // NUMPAGES fields. Word will render the fields live on open.
            $run = $cell->addTextRun($para);
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
                    break;
            }
        }

        // ── Body ──
        $html = (string) ($row->content_html ?: '<p>(empty template)</p>');
        $wrapped = '<html><body>' . $html . '</body></html>';
        try {
            Html::addHtml($section, $wrapped, false, false);
        } catch (\Throwable $e) {
            $section->addText(strip_tags($html));
        }

        $writer = IOFactory::createWriter($phpWord, 'Word2007');
        $tmp = tempnam(sys_get_temp_dir(), 'tpl_') . '.docx';
        $writer->save($tmp);

        $filename = ($row->code ?: 'template') . '.docx';
        return response()->download($tmp, $filename)->deleteFileAfterSend(true);
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
        [$path, $orig] = $this->storeDocx($request->file('docx'), $row->client_id, $row->id);

        // Best-effort DOCX → HTML so the web editor stays usable. If parsing
        // fails (legacy .doc, embedded media, etc) we keep the upload but
        // skip the HTML refresh.
        $html = $row->content_html;
        try {
            $html = $this->docxToHtml(Storage::disk('public')->path($path)) ?: $row->content_html;
        } catch (\Throwable $e) {
            // ignore — file is saved, web editor falls back to previous content
        }

        $row->update([
            'docx_path'          => $path,
            'docx_original_name' => $orig,
            'editor_mode'        => 'word',
            'content_html'       => $html,
        ]);
        $row->load(self::WITH);
        return response()->json($row);
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
            abort(403, "You cannot {$verb} this template — created by a higher-privileged user.");
        }
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $isDraft  = strtolower((string) $request->input('status')) === 'draft';
        // On Draft saves and on edits, only category/role/name are strictly
        // required so the wizard can persist partial progress.
        $req = fn () => $isUpdate || $isDraft ? 'nullable' : 'required';

        return $request->validate([
            'name'              => [$req(), 'string', 'max:191'],
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
            'header_config.title'            => 'nullable|string|max:191',
            'header_config.subtitle'         => 'nullable|string|max:191',
            'header_config.align'            => ['nullable', Rule::in(['left', 'center', 'right', 'space-between'])],
            'header_config.background'       => 'nullable|string|max:30',
            'header_config.text_color'       => 'nullable|string|max:30',
            'header_config.show_logo'        => 'nullable|boolean',
            'header_config.show_title'       => 'nullable|boolean',
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
            'url'  => Storage::disk('public')->url($path),
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
