<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\HrDocumentSignature;
use App\Models\HrDocumentTemplate;
use App\Models\HrDocumentTemplateVersion;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\HrTemplateMatch;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;

class HrDocumentTemplateController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
        'triggerPoint:id,module_name',
    ];

    private const MODULE_SLUG = 'hr.doc_templates';

    private const CATEGORIES   = ['IT', 'Non-IT', 'Legal'];
    private const ROLE_TYPES   = ['Director / CEO', 'Head of Department (HOD)', 'Team Leader', 'Executive', 'Employee', 'Intern / Trainee'];
    private const STATUSES     = ['Draft', 'Active', 'Deprecated'];
    private const SIGN_MODES   = ['Sequential', 'Parallel'];
    private const EDITOR_MODES = ['web', 'word'];

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

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = HrDocumentTemplate::query()
            ->select([
                'id', 'client_id', 'branch_id',
                'code', 'name', 'description',
                'employee_category', 'role_type', 'doc_type', 'trigger_point_id',
                'version', 'status', 'editor_mode',
                'is_mandatory', 'requires_signature', 'requires_manager_approval', 'include_in_audit',
                'signing_mode', 'docx_path', 'docx_original_name',
                'created_by', 'created_at', 'updated_at',
            ])
            ->with(self::WITH);
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

        $rows = $q->orderByDesc('id')->get();

        $live = HrDocumentSignature::whereIn('template_id', $rows->pluck('id'))
            ->whereIn('status', ['Pending', 'In Progress'])
            ->pluck('template_id')->map(fn ($x) => (int) $x)->flip();
        $rows->each(fn ($r) => $r->setAttribute('out_for_signature', isset($live[(int) $r->id])));

        return response()->json($rows);
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

    public function lastBranding(Request $request)
    {
        $this->authorize($request, 'can_view');
        $q = HrDocumentTemplate::query()->whereNotNull('header_config');
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        $row = $q->orderByDesc('id')->first(['header_config', 'footer_config']);
        return response()->json([
            'header_config' => $row?->header_config,
            'footer_config' => $row?->footer_config,
            'org' => $this->orgIdentity($request->user()),
        ]);
    }

    private function orgIdentity(?\App\Models\User $user): array
    {
        $branch = $user?->branch;
        $client = $user?->client;

        $address = $branch
            ? trim(implode(', ', array_filter([
                trim((string) ($branch->address ?? '')),
                trim((string) ($branch->city ?? '')),
                trim((string) ($branch->state ?? '')),
                trim((string) ($branch->pincode ?? '')),
            ], fn ($v) => $v !== '')))
            : '';

        $logoPath = $branch?->logo ?: $client?->logo;

        return [
            'name'      => (string) ($branch?->name ?: $client?->org_name ?: ''),
            'address'   => $address,
            'logo_path' => $logoPath ? (string) $logoPath : null,
            'logo_url'  => $logoPath ? file_url($logoPath) : null,
        ];
    }
    public function previewLive(Request $request)
    {
        $this->authorize($request, 'can_view');
        @ini_set('memory_limit', '512M');
        @set_time_limit(60);

        $data = $request->validate([
            'id'            => 'nullable|integer',
            'content'       => 'nullable|string',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        $row = null;
        if (!empty($data['id'])) {
            try { $row = $this->resolveRow($request, (int) $data['id']); }
            catch (\Throwable $e) { $row = null; }
        }

        $headerCfg = $data['header_config'] ?? (is_array($row?->header_config) ? $row->header_config : []);
        $footerCfg = $data['footer_config'] ?? (is_array($row?->footer_config) ? $row->footer_config : []);

        $html = (string) ($data['content'] ?? $row?->content_html ?? '');
        if (trim(strip_tags($html)) === '' && !str_contains($html, '<img')) {
            $html = '<p style="color:#9ca3af">(empty template)</p>';
        }

        $document = $row ?: new HrDocumentTemplate(['name' => 'Template preview']);

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.signed-document', [
            'row'         => $document,
            'header'      => $headerCfg,
            'footer'      => $footerCfg,
            'logoDataUri' => $this->previewLogoDataUri($headerCfg, $request->user()),
            'companyName' => (string) (
                $request->user()?->branch?->name
                ?: $request->user()?->client?->org_name
                ?: ''
            ),
            'bodyHtml'    => $this->inlineLocalImages($html),
        ])->setPaper('A4');

        return $pdf->stream('template-preview.pdf');
    }

    private function previewLogoDataUri(array $headerCfg, $user): ?string
    {
        $candidates = array_filter([
            (string) ($headerCfg['logo_path'] ?? ''),
            $this->previewDiskPath((string) ($headerCfg['logo_url'] ?? '')) ?? '',
            (string) ($user?->branch?->logo ?? ''),
            (string) ($user?->client?->logo ?? ''),
        ]);

        foreach ($candidates as $path) {
            $uri = $this->previewImageDataUri($path);
            if ($uri) return $uri;
        }
        return null;
    }

    private function previewDiskPath(string $src): ?string
    {
        $src = trim($src);
        if ($src === '' || str_starts_with($src, 'data:')) return null;

        $parsed = parse_url($src);
        $path = ltrim(str_replace('\\', '/', $parsed['path'] ?? $src), '/');

        if (preg_match('#(?:^|/)storage/(.+)$#', $path, $m)) return $m[1];
        if (isset($parsed['scheme'])) return null;
        if (str_starts_with($path, 'public/')) $path = substr($path, strlen('public/'));
        return str_contains($path, '/') ? $path : null;
    }

    private function previewImageDataUri(string $path): ?string
    {
        return \App\Support\InlineImage::dataUri($path);
    }

    private function inlineLocalImages(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*?)/?>#i',
            function (array $m) {
                [$full, $pre, $q, $src, $post] = $m;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;
                $path = $this->previewDiskPath($src);
                if (!$path) return $full;
                $uri = $this->previewImageDataUri($path);
                return $uri ? '<img' . $pre . 'src=' . $q . $uri . $q . $post . '/>' : $full;
            },
            $html,
        ) ?? $html;
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

            $this->snapshotVersion($row, $auth?->id);

            $row->load(self::WITH);
            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $row = $this->resolveRow($request, (int) $id);
        $this->authorizeTemplateWrite($request, $row);

        $becomingDeprecated = strcasecmp((string) $request->input('status'), 'Deprecated') === 0
            && strcasecmp((string) $row->status, 'Deprecated') !== 0;
        if ($becomingDeprecated
            && HrDocumentSignature::where('template_id', $row->id)
                ->whereIn('status', ['Pending', 'In Progress'])->exists()) {
            return response()->json([
                'status'  => false,
                'message' => 'This document is out for signature, so it can’t be deprecated yet. Recall the pending signature request (or wait for it to complete) first.',
            ], 422);
        }

        $data = $this->validatePayload($request, $row->id);

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

        $data['version'] = $this->nextVersion($row->version);

        if (!HrDocumentTemplateVersion::where('template_id', $row->id)->exists()) {
            $this->snapshotVersion($row, $request->user()?->id);
        }

        $row->update($data);
        $this->snapshotVersion($row, $request->user()?->id);

        $row->load(self::WITH);
        return response()->json($row);
    }

    public function versions(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        $rows = HrDocumentTemplateVersion::where('template_id', $row->id)
            ->orderByDesc('id')
            ->get(['id', 'version', 'code', 'name', 'status', 'editor_mode', 'docx_original_name', 'created_by', 'created_at']);

        $names = User::whereIn('id', $rows->pluck('created_by')->filter()->unique())
            ->pluck('name', 'id');

        return response()->json([
            'template_id' => $row->id,
            'current'     => $row->version,
            'versions'    => $rows->map(fn ($v) => [
                'id'         => $v->id,
                'version'    => $v->version,
                'code'       => $v->code,
                'name'       => $v->name,
                'status'     => $v->status,
                'source'     => $v->editor_mode === 'word' ? 'Word' : 'Editor',
                'saved_by'   => $names[$v->created_by] ?? null,
                'saved_at'   => $v->created_at?->toIso8601String(),
                'is_current' => $v->version === $row->version,
            ])->all(),
        ]);
    }

    public function downloadVersion(Request $request, $id, $versionId)
    {
        $this->authorize($request, 'can_view');
        @ini_set('memory_limit', '512M');
        @set_time_limit(60);

        $row = $this->resolveRow($request, (int) $id);

        $v = HrDocumentTemplateVersion::where('template_id', $row->id)
            ->where('id', (int) $versionId)
            ->firstOrFail();

        $snapshot = new HrDocumentTemplate();
        $snapshot->forceFill([
            'id'            => $row->id,
            'code'          => $v->code ?: $row->code,
            'name'          => $v->name ?: $row->name,
            'content_html'  => $v->content_html,
            'header_config' => $v->header_config,
            'footer_config' => $v->footer_config,
            'editor_mode'   => $v->editor_mode,
            'client_id'     => $v->client_id,
            'branch_id'     => $v->branch_id,
        ]);

        $stem = ($v->code ?: 'template') . '-' . ($v->version ?: 'v1');

        return strtolower((string) $request->query('format')) === 'pdf'
            ? $this->pdfResponse($snapshot, $request, $stem . '.pdf')
            : $this->renderDocx($snapshot, $stem . '.docx', true);
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);

        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            Storage::disk('public')->delete($row->docx_path);
        }
        $row->delete();
        return response()->json(['message' => 'Template removed.']);
    }

    public function downloadDocx(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        return $this->renderDocx($row, ($row->code ?: 'template') . '.docx', true);
    }

    public function downloadPdf(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        @ini_set('memory_limit', '512M');
        @set_time_limit(60);

        $row = $this->resolveRow($request, (int) $id);

        return $this->pdfResponse($row, $request, ($row->code ?: 'template') . '.pdf');
    }

    private function pdfResponse($row, Request $request, string $filename)
    {
        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];

        $html = (string) ($row->content_html ?? '');
        if (trim(strip_tags($html)) === '' && !str_contains($html, '<img')) {
            $html = '<p style="color:#9ca3af">(empty template)</p>';
        }

        $data = [
            'row'         => $row,
            'header'      => $headerCfg,
            'footer'      => $footerCfg,
            'logoDataUri' => $this->previewLogoDataUri($headerCfg, $request->user()),
            'companyName' => (string) (
                $request->user()?->branch?->name
                ?: $request->user()?->client?->org_name
                ?: ''
            ),
            'bodyHtml'    => $this->inlineLocalImages($html),
        ];

        $bytes = $this->cachedPdf($data, $row);

        return response($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="' . addslashes($filename) . '"',
            'Content-Length'      => (string) strlen($bytes),
        ]);
    }

    private function cachedPdf(array $data, $row): string
    {
        $fingerprint = sha1(serialize([
            $data['bodyHtml'], $data['header'], $data['footer'],
            $data['logoDataUri'], $data['companyName'],
        ]));

        $id   = (int) ($row->id ?? 0);
        $disk = Storage::disk('local');
        $dir  = 'pdf-cache/hr-template';
        $path = $dir . '/' . ($id ?: 'adhoc') . '-' . $fingerprint . '.pdf';

        try {
            if ($disk->exists($path)) return (string) $disk->get($path);
        } catch (\Throwable $e) {
        }

        $bytes = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.signed-document', $data)
            ->setPaper('A4')
            ->output();

        try {
            $disk->put($path, $bytes);

            if ($id) {
                $mine = array_values(array_filter(
                    $disk->files($dir),
                    fn ($f) => str_starts_with(basename($f), $id . '-'),
                ));
                if (count($mine) > 3) {
                    usort($mine, fn ($a, $b) => $disk->lastModified($b) <=> $disk->lastModified($a));
                    foreach (array_slice($mine, 3) as $stale) $disk->delete($stale);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('hr template pdf cache write failed', ['path' => $path, 'err' => $e->getMessage()]);
        }

        return $bytes;
    }

    public function uploadDocx(Request $request, $id)
    {
        $request->validate(['docx' => 'required|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB]);

        $row = $this->resolveRow($request, (int) $id);
        $this->authorizeTemplateWrite($request, $row);

        $uploaded = $request->file('docx');
        $abs = $uploaded->getRealPath();

        $html = $row->content_html;
        $contentExtracted = false;
        try {
            $parsed = $this->docxToHtml($abs);
            if (trim(strip_tags($parsed)) !== '') {
                $html = $parsed;
                $contentExtracted = true;
            }
        } catch (\Throwable $e) {
        }

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

        $row->update($update);
        $row->load(self::WITH);
        return response()->json(array_merge($row->toArray(), ['content_extracted' => $contentExtracted]));
    }

    public function matchForEmployee(Request $request)
    {
        $this->authorize($request, 'can_view');
        $request->validate([
            'employee_id'         => 'required|integer|exists:employees,id',
            'trigger_point_name'  => 'sometimes|nullable|string|max:255',
            'trigger_keyword'     => 'sometimes|nullable|string|max:120',
            'trigger_keywords'    => 'sometimes|nullable|string|max:400',
        ]);

        $emp = Employee::with(['department:id,name', 'designation:id,name,level'])
            ->find((int) $request->query('employee_id'));

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
        $level    = $emp->designation?->level;

        $keyword   = trim((string) $request->query('trigger_keyword', ''));
        $exactName = trim((string) $request->query('trigger_point_name', ''));

        $many = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) $request->query('trigger_keywords', '')),
        ), fn ($k) => $k !== ''));

        if ($many) {
            $meta = [
                'employee_category' => $category,
                'role_type'         => $level,
                'department_name'   => $emp->department?->name,
                'designation_name'  => $emp->designation?->name,
            ];
            $groups = [];
            foreach (array_unique($many) as $kw) {
                $groups[$kw] = $this->matchGroup($request, $emp, $kw, '', $meta);
            }
            return response()->json($meta + ['groups' => $groups]);
        }

        return response()->json($this->matchGroup($request, $emp, $keyword, $exactName, [
            'employee_category' => $category,
            'role_type'         => $level,
            'department_name'   => $emp->department?->name,
            'designation_name'  => $emp->designation?->name,
        ]));
    }

    private function matchGroup(Request $request, Employee $emp, string $keyword, string $exactName, array $meta): array
    {
        $q = HrTemplateMatch::query($emp, $keyword, $exactName);
        if (!$q) {
            return $meta + [
                'trigger_point_name' => $exactName ?: null,
                'trigger_keyword'    => $keyword ?: null,
                'templates'          => [],
            ];
        }
        $q->with(self::WITH);

        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        $templates = $q->orderByDesc('id')->get();

        $runs = HrDocumentSignature::where('employee_id', $emp->id)
            ->whereIn('template_id', $templates->pluck('id'))
            ->orderBy('id')
            ->get(['id', 'template_id', 'status', 'code']);

        $latestByTemplate = $runs->keyBy('template_id');
        $templates->each(function ($t) use ($latestByTemplate) {
            $run = $latestByTemplate->get($t->id);
            $t->setAttribute('signature_status', $run->status ?? null);
            $t->setAttribute('signature_id', $run->id ?? null);
            $t->setAttribute('signature_code', $run->code ?? null);
            $t->setAttribute('is_sent', (bool) $run);
        });

        return $meta + [
            'trigger_point_name' => $exactName ?: null,
            'trigger_keyword'    => $keyword ?: null,
            'templates'          => $templates,
            'pending_count'      => $templates->where('is_sent', false)->count(),
        ];
    }

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

        if ($unfilled = $this->unfilledCustomFields($request, $resolvedHtml)) {
            return response()->json([
                'status'        => false,
                'message'       => 'Fill the custom fields first: ' . implode(', ', $unfilled)
                                   . '. Use Generate Document so the values can be entered.',
                'custom_fields' => $unfilled,
            ], 422);
        }

        $clone = $row->replicate();
        $clone->setRawAttributes($row->getAttributes(), true);
        $clone->id = $row->id;
        $clone->content_html = $resolvedHtml;
        return $this->renderDocx($clone, ($emp->display_name ?: ('EMP-' . $emp->id)) . ' - ' . ($row->name ?: $row->code) . '.docx');
    }

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

        $tokensInTemplate = [];
        if (preg_match_all('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/', (string) $row->content_html, $m)) {
            $tokensInTemplate = array_values(array_unique($m[1]));
        }
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

    private function buildTokenContext(Employee $emp, $signers): array
    {
        $signers = is_array($signers) ? $signers : (is_string($signers) ? json_decode($signers, true) : []);
        $signers = is_array($signers) ? $signers : [];

        $emp->loadMissing(['branch.client', 'legalEntity', 'client']);

        $empBranch = $emp->branch;
        $branchAddress = $empBranch
            ? trim(implode(', ', array_filter([
                trim((string) ($empBranch->address ?? '')),
                trim((string) ($empBranch->city ?? '')),
                trim((string) ($empBranch->state ?? '')),
                trim((string) ($empBranch->pincode ?? '')),
            ], fn ($v) => $v !== '')))
            : '';
        $branchLogoUrl = $empBranch ? file_url($empBranch->logo) : null;
        $branchLogo = $branchLogoUrl
            ? sprintf(
                '<img src="%s" alt="Company logo" style="max-height:64px;max-width:220px;" />',
                htmlspecialchars($branchLogoUrl, ENT_QUOTES),
            )
            : '';

        $ctx = [
            'FirstName'      => (string) ($emp->first_name ?? ''),
            'MiddleName'     => (string) ($emp->middle_name ?? ''),
            'LastName'       => (string) ($emp->last_name ?? ''),
            'FullName'       => (string) ($emp->display_name ?? trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))),
            'DisplayName'    => (string) ($emp->display_name ?? ''),
            'EmployeeNumber' => (string) ($emp->emp_code ?? $emp->id),

            'Email'   => (string) ($emp->email ?? ''),
            'Mobile'  => (string) ($emp->mobile ?? ''),
            'Address' => trim(((string) ($emp->address_line1 ?? '')) . ' ' . ((string) ($emp->address_line2 ?? ''))),
            'City'    => (string) ($emp->city ?? ''),
            'State'   => '',

            'JobTitle'    => (string) ($emp->designation?->name ?? ''),
            'Department'  => (string) ($emp->department?->name ?? ''),
            'Designation' => (string) ($emp->designation?->name ?? ''),
            'JoiningDate' => $emp->date_of_joining ? $emp->date_of_joining->format('d M Y') : '',
            'ReportsTo'   => (string) ($emp->reportingManager?->display_name ?? ''),

            'CTC'   => $emp->annual_salary !== null ? number_format((float) $emp->annual_salary, 2) : '',
            'Basic' => '',
            'HRA'   => '',

            'CompanyName'    => (string) ($emp->legalEntity?->name
                ?: $emp->branch?->client?->org_name
                ?: $emp->client?->org_name
                ?: $emp->branch?->name
                ?: ''),
            'CompanyAddress' => $branchAddress,
            'CompanyLogo'    => $branchLogo,
        ];

        foreach ($signers as $i => $s) {
            $n = $i + 1;
            $roleName = (string) ($s['role_name'] ?? '');
            $ctx["Signer{$n}Role"] = $roleName;
            $ctx["Signer{$n}Name"] = $roleName !== ''
                ? \App\Support\SignerResolver::name($roleName, $emp)
                : (string) ($s['designation_name'] ?? '');
            $ctx["Signer{$n}Date"] = '';
            $ctx["Signer{$n}Designation"] = (string) ($s['designation_name'] ?? $s['role_name'] ?? '');
        }

        return $ctx;
    }

    public const RAW_HTML_TOKENS = ['CompanyLogo'];

    private function unfilledCustomFields(Request $request, string $resolvedHtml): array
    {
        if (!preg_match_all('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/', $resolvedHtml, $m)) return [];
        $left = array_unique(array_map('mb_strtolower', $m[1]));
        if (!$left) return [];

        $user = $request->user();
        $names = \App\Models\HrCustomField::query()
            ->when($user?->client_id, fn ($q) => $q->where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $user->client_id)))
            ->pluck('name');

        return $names->filter(fn ($n) => in_array(mb_strtolower((string) $n), $left, true))
            ->values()->all();
    }

    private function resolveTokens(
        string $html,
        array $ctx,
        bool $preserveSignerSlots = false,
        array $rawHtmlNames = self::RAW_HTML_TOKENS,
    ): string {
        $rawSet = array_flip($rawHtmlNames);

        return preg_replace_callback('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/', function ($m) use ($ctx, $preserveSignerSlots, $rawSet) {
            $key = $m[1];
            if ($preserveSignerSlots && preg_match('/^Signer\d+(Sign|Date)$/', $key)) {
                return $m[0];
            }
            if (!array_key_exists($key, $ctx)) {
                return $m[0];
            }
            if (isset($rawSet[$key])) {
                return (string) $ctx[$key];
            }
            return htmlspecialchars((string) $ctx[$key], ENT_QUOTES);
        }, $html);
    }

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

    private function localFile(?string $path, ?bool &$isTemp = null): ?string
    {
        $isTemp = false;
        if (!$path) return null;
        $disk = Storage::disk('public');
        if (!$disk->exists($path)) return null;

        try {
            $local = $disk->path($path);
            if (is_string($local) && is_file($local)) return $local;
        } catch (\Throwable $e) { }

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

    private function localiseImagesForDocx(string $html, array &$temps): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*?)/?>#i',
            function (array $m) use (&$temps): string {
                [$full, $pre, $q, $src, $post] = $m;
                $src = trim($src);
                if ($src === '') return $full;

                $local = null;

                if (str_starts_with($src, 'data:')) {
                    $local = $this->tempFromDataUri($src);
                } elseif ($path = $this->previewDiskPath($src)) {
                    $local = $this->resolveDocxLogo($path);
                } elseif (preg_match('#^https?://#i', $src)) {
                    $local = $this->tempFromUrl($src);
                }

                if (!$local || !is_file($local)) return $full;

                if ($this->isTempPath($local)) {
                    $temps[] = $local;
                }

                $safe = htmlspecialchars(str_replace('\\', '/', $local), ENT_QUOTES);
                return '<img' . $pre . 'src=' . $q . $safe . $q . $post . '/>';
            },
            $html,
        ) ?? $html;
    }

    private function isTempPath(string $path): bool
    {
        $tmpDir = realpath(sys_get_temp_dir());
        $real   = realpath($path);
        if ($tmpDir === false || $real === false) return false;

        $norm = fn (string $p) => rtrim(str_replace('\\', '/', $p), '/') . '/';

        return str_starts_with($norm($real), $norm($tmpDir));
    }

    private function tempFromDataUri(string $src): ?string
    {
        if (!preg_match('#^data:image/([a-z0-9.+-]+);base64,(.*)$#i', $src, $m)) return null;
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || $bytes === '') return null;
        $ext = strtolower($m[1]) === 'jpeg' ? 'jpg' : strtolower($m[1]);
        $tmp = tempnam(sys_get_temp_dir(), 'docximg_') . '.' . $ext;
        return file_put_contents($tmp, $bytes) !== false ? $tmp : null;
    }

    private function tempFromUrl(string $src): ?string
    {
        try {
            $res = \Illuminate\Support\Facades\Http::timeout(10)->get($src);
            if (!$res->successful()) return null;
            $bytes = $res->body();
            if ($bytes === '') return null;

            $ext = strtolower(pathinfo(parse_url($src, PHP_URL_PATH) ?: '', PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'bmp'], true)) $ext = 'png';

            $tmp = tempnam(sys_get_temp_dir(), 'docximg_') . '.' . $ext;
            return file_put_contents($tmp, $bytes) !== false ? $tmp : null;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('DOCX body image could not be fetched; leaving it out', [
                'src'   => $src,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    private const DOCX_LOGO_MAX_W = 1000;

    private function shrinkLogoForDocx(string $abs, ?string $sourceKey = null): string
    {
        try {
            $dim = @getimagesize($abs);
            [$w, $h] = [(int) ($dim[0] ?? 0), (int) ($dim[1] ?? 0)];
            if ($w <= self::DOCX_LOGO_MAX_W || $w < 1 || $h < 1) return $abs;

            $disk  = Storage::disk('public');
            $ck    = $sourceKey
                ? 'docx-logo-cache/' . md5(ltrim($sourceKey, '/') . '|' . @filesize($abs) . '|' . self::DOCX_LOGO_MAX_W) . '.png'
                : null;
            if ($ck) {
                try {
                    if ($disk->exists($ck)) {
                        $hit = $this->localFile($ck);
                        if ($hit) return $hit;
                    }
                } catch (\Throwable $e) { }
            }

            $src = match (strtolower(pathinfo($abs, PATHINFO_EXTENSION))) {
                'png'         => @imagecreatefrompng($abs),
                'jpg', 'jpeg' => @imagecreatefromjpeg($abs),
                'gif'         => @imagecreatefromgif($abs),
                default       => null,
            };
            if (!$src) return $abs;

            $nw = self::DOCX_LOGO_MAX_W;
            $nh = max(1, (int) round($h * $nw / $w));
            $dst = imagecreatetruecolor($nw, $nh);
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
            imagedestroy($src);

            $tmp = tempnam(sys_get_temp_dir(), 'logo_') . '.png';
            $ok  = @imagepng($dst, $tmp);
            imagedestroy($dst);
            if (!$ok || !is_file($tmp) || filesize($tmp) < 1) return $abs;

            if ($ck) {
                try { $disk->put($ck, (string) file_get_contents($tmp)); }
                catch (\Throwable $e) { }
            }
            return $tmp;
        } catch (\Throwable $e) {
            return $abs;
        }
    }

    private function resolveDocxLogo(?string $logoPath): ?string
    {
        $abs = $this->localFile($logoPath);
        if (!$abs) return null;
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));

        if (in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'bmp'], true)) {
            return $this->shrinkLogoForDocx($abs, $logoPath);
        }

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
            } catch (\Throwable $e) {
            }
        }

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
            } catch (\Throwable $e) {
            }
        }

        return null;
    }

    public function buildDocxFile($row, bool $withHeaderFooter = true): string
    {
        $phpWord = new PhpWord();
        $section = $phpWord->addSection([
            'pageSizeW'    => 11906,
            'pageSizeH'    => 16838,
            'headerHeight' => 90 * 20,
            'footerHeight' => 50 * 20,
        ]);

        if ($withHeaderFooter) {
            $headerCfg = is_array($row->header_config) ? $row->header_config : [];
            $logoPath  = $headerCfg['logo_path'] ?: $this->latestClientLogo($row->client_id);
            $title     = (string) ($headerCfg['title'] ?? '');
            $subtitle  = (string) ($headerCfg['subtitle'] ?? '');
            $hAlign    = (string) ($headerCfg['align']    ?? 'right');
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
                    $maxW = 200;
                    $dim  = @getimagesize($absLogo);
                    $iw   = $dim[0] ?? 0;
                    $ih   = $dim[1] ?? 0;
                    $h    = $logoH;
                    $w    = ($ih > 0) ? (int) round($iw * $h / $ih) : 0;
                    if ($w > $maxW && $iw > 0) {
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
        }

        $html = (string) ($row->content_html ?: '<p>(empty template)</p>');
        $html = preg_replace(
            '#<(br|hr|col|input|area|base|embed|link|meta|param|source|track|wbr)\b([^>]*?)/?>#i',
            '<$1$2/>',
            $html
        );
        $imgTemps = [];
        $html = $this->localiseImagesForDocx($html, $imgTemps);
        $html = preg_replace('/<img([^>]*[^\/])>/i', '<img$1/>', $html);
        $wrapped = '<html><body>' . $html . '</body></html>';

        $before = count($section->getElements());
        $parsed = false;
        try {
            Html::addHtml($section, $wrapped, false, false);
            $parsed = count($section->getElements()) > $before;
        } catch (\Throwable $e) {
            $parsed = false;
        }
        if (!$parsed && trim(strip_tags($html)) !== '') {
            Log::warning('Template body could not be parsed as HTML; writing it as plain paragraphs', [
                'template_id' => $row->id ?? null,
            ]);
            $this->addHtmlAsPlainParagraphs($section, $html);
        }

        $writer = IOFactory::createWriter($phpWord, 'Word2007');
        $tmp = tempnam(sys_get_temp_dir(), 'tpl_') . '.docx';
        $writer->save($tmp);
        foreach ($imgTemps as $t) {
            if (is_file($t)) @unlink($t);
        }
        return $tmp;
    }

    private function addHtmlAsPlainParagraphs($section, string $html): void
    {
        $t = preg_replace('#</t[dh]\s*>#i', "\t", $html);
        $t = preg_replace('#<(?:br\s*/?|/p|/h[1-6]|/li|/tr|/div|/blockquote)\s*>#i', "\n", $t);
        $t = html_entity_decode(strip_tags($t), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $wrote = false;
        foreach (preg_split('/\n/', $t) ?: [] as $line) {
            $line = trim(preg_replace('/[ \x{00A0}]{2,}/u', ' ', $line));
            if ($line === '') continue;
            $section->addText($line);
            $wrote = true;
        }
        if (!$wrote) $section->addText(trim(strip_tags($html)));
    }

    public function renderDocx($row, string $filename, bool $withHeaderFooter = true)
    {
        $tmp = $this->buildDocxFile($row, $withHeaderFooter);
        return response()->download($tmp, $filename)->deleteFileAfterSend(true);
    }

    private function authorizeTemplateWrite(Request $request, $template): void
    {
        $user = $request->user();

        $isOwnDraft = $user
            && $template
            && (int) $template->created_by === (int) $user->id
            && strcasecmp((string) $template->status, 'Draft') === 0;

        if ($isOwnDraft && $this->hasPerm($user, 'can_add')) {
            return;
        }
        $this->authorize($request, 'can_edit');
    }

    private function hasPerm($user, string $perm): bool
    {
        if (!$user) return false;
        if ($user->isSuperAdmin()) return true;
        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            return in_array($user->user_type, ['client_admin', 'branch_user'], true);
        }
        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)->where($perm, true)->exists();
    }

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
        if (!$allowed) {
            abort(403, self::denialMessage($perm));
        }
    }

    private static function denialMessage(string $perm): string
    {
        $what = match ($perm) {
            'can_add'    => 'create document templates',
            'can_edit'   => 'edit document templates',
            'can_delete' => 'delete document templates',
            'can_view'   => 'view document templates',
            default      => 'perform this action on document templates',
        };
        $hint = $perm === 'can_edit'
            ? ' You can create a new template, but changing one — including '
              . 'completing a draft you just created — needs Edit as well.'
            : '';
        return "You don't have permission to {$what}.{$hint} Ask an administrator to grant it under Permissions → Document Templates.";
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

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $branchFilter));
    }

    private function resolveRow(Request $request, int $id): HrDocumentTemplate
    {
        $q = HrDocumentTemplate::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;
        $isDraft  = strtolower((string) $request->input('status')) === 'draft';
        $req = fn() => $isUpdate || $isDraft ? 'nullable' : 'required';

        return $request->validate([
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
            'name.max' => 'Template Name cannot exceed 100 characters.',
        ]);
    }

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

    private function snapshotVersion(HrDocumentTemplate $row, ?int $userId): void
    {
        try {
            HrDocumentTemplateVersion::create([
                'client_id'          => $row->client_id,
                'branch_id'          => $row->branch_id,
                'template_id'        => $row->id,
                'version'            => (string) ($row->version ?: 'v1'),
                'code'               => $row->code,
                'name'               => $row->name,
                'status'             => $row->status,
                'editor_mode'        => $row->editor_mode,
                'content_html'       => $row->content_html,
                'header_config'      => $row->header_config,
                'footer_config'      => $row->footer_config,
                'docx_path'          => $row->docx_path,
                'docx_original_name' => $row->docx_original_name,
                'created_by'         => $userId,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Document template version snapshot failed', [
                'template_id' => $row->id,
                'version'     => $row->version,
                'error'       => $e->getMessage(),
            ]);
        }
    }

    private function nextVersion(?string $current): string
    {
        $n = preg_match('/(\d+)\s*$/', (string) $current, $m) ? (int) $m[1] : 1;

        return 'v' . ($n + 1);
    }

    private function codePrefix(string $cat, string $role): string
    {
        $c = self::CAT_SHORT[$cat]  ?? 'GEN';
        $r = self::ROLE_SHORT[$role] ?? 'GEN';
        return "{$c}-{$r}-";
    }

    private function codeScope($clientId, $branchId, string $cat, string $role)
    {
        $q = HrDocumentTemplate::withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        return $q->where('employee_category', $cat)->where('role_type', $role);
    }

    private function allocateCode($clientId, $branchId, string $cat, string $role): string
    {
        $codes = $this->codeScope($clientId, $branchId, $cat, $role)->lockForUpdate()->pluck('code');

        return $this->buildNext($codes, $this->codePrefix($cat, $role));
    }

    private function peekNextCode($clientId, $branchId, string $cat, string $role): string
    {
        $codes = $this->codeScope($clientId, $branchId, $cat, $role)->pluck('code');

        return $this->buildNext($codes, $this->codePrefix($cat, $role));
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

    private function storeDocx($file, $clientId, $templateId): array
    {
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "doc_templates/{$clientSlug}/t{$templateId}";
        $ext = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename = Str::random(16) . '.' . $ext;
        $path = $file->storeAs($folder, $filename, 'public');
        return [$path, $file->getClientOriginalName()];
    }

    private function docxToHtml(string $absPath): string
    {
        $phpwordHtml = '';
        try {
            $phpWord = IOFactory::load($absPath);
            foreach ($phpWord->getSections() as $section) {
                foreach ($section->getElements() as $el) {
                    $phpwordHtml .= $this->elementToHtml($el);
                }
            }
        } catch (\Throwable $e) {
            $phpwordHtml = '';
        }
        $phpwordHtml = trim($phpwordHtml);

        $rawHtml = $this->rawDocxParagraphs($absPath);

        $phpwordLen = mb_strlen(trim(strip_tags($phpwordHtml)));
        $rawLen     = mb_strlen(trim(strip_tags($rawHtml)));
        $chosen = $rawLen > $phpwordLen ? $rawHtml : $phpwordHtml;

        return trim($chosen);
    }

    private function rawDocxParagraphs(string $absPath): string
    {
        if (!class_exists('ZipArchive') || !is_file($absPath)) return '';

        $zip = new \ZipArchive();
        if ($zip->open($absPath) !== true) return '';
        try {
            $xml = $zip->getFromName('word/document.xml');
        } finally {
            $zip->close();
        }
        if ($xml === false || $xml === '') return '';

        if (preg_match('#<w:body\b[^>]*>(.*)</w:body>#s', $xml, $m)) {
            $xml = $m[1];
        }

        $out = '';
        foreach (preg_split('#(?=<w:p[ >])#', $xml) as $chunk) {
            if (strncmp($chunk, '<w:p', 4) !== 0) continue;
            if (!preg_match_all('#<w:t\b[^>]*>(.*?)</w:t>#s', $chunk, $mm)) continue;

            $text = trim(html_entity_decode(implode('', $mm[1]), ENT_QUOTES | ENT_XML1, 'UTF-8'));
            if ($text === '') continue;

            $out .= '<p>' . htmlspecialchars($text, ENT_QUOTES) . '</p>';
        }
        return $out;
    }

    private function paragraphAlignAttr($el): string
    {
        if (!method_exists($el, 'getParagraphStyle')) return '';
        $p = $el->getParagraphStyle();
        $a = (is_object($p) && method_exists($p, 'getAlignment')) ? $p->getAlignment() : null;
        $map = [
            'center' => 'center',
            'end'    => 'right',
            'right'  => 'right',
            'both'   => 'justify',
            'justify' => 'justify',
        ];
        return isset($map[$a]) ? ' style="text-align:' . $map[$a] . '"' : '';
    }

    private function fontCss($f): string
    {
        $css = [];
        $size = method_exists($f, 'getSize') ? $f->getSize() : null;
        if (is_numeric($size) && $size > 0) $css[] = 'font-size:' . (float) $size . 'pt';
        $color = method_exists($f, 'getColor') ? $f->getColor() : null;
        if (is_string($color) && preg_match('/^[0-9a-fA-F]{6}$/', $color)) $css[] = 'color:#' . $color;
        return implode(';', $css);
    }

    private function elementToHtml($el, bool $inline = false): string
    {
        $cls = class_basename($el);

        if ($cls === 'TextRun') {
            $inner = '';
            foreach ($el->getElements() as $child) $inner .= $this->elementToHtml($child, true);
            return '<p' . $this->paragraphAlignAttr($el) . '>' . $inner . '</p>';
        }
        if ($cls === 'Text') {
            $text = htmlspecialchars($el->getText() ?? '', ENT_QUOTES);
            $f = $el->getFontStyle();
            if ($f) {
                if (method_exists($f, 'isBold')   && $f->isBold())   $text = "<b>{$text}</b>";
                if (method_exists($f, 'isItalic') && $f->isItalic()) $text = "<i>{$text}</i>";
                $u = method_exists($f, 'getUnderline') ? $f->getUnderline() : null;
                if ($u && $u !== 'none') $text = "<u>{$text}</u>";
                $css = $this->fontCss($f);
                if ($css !== '') $text = '<span style="' . $css . '">' . $text . '</span>';
            }
            return $inline ? $text : '<p' . $this->paragraphAlignAttr($el) . '>' . $text . '</p>';
        }

        if ($cls === 'Title') {
            return '<h2>' . htmlspecialchars((string) $el->getText(), ENT_QUOTES) . '</h2>';
        }
        if ($cls === 'ListItem') {
            return '<li>' . htmlspecialchars((string) $el->getText(), ENT_QUOTES) . '</li>';
        }
        if ($cls === 'TextBreak') {
            return $inline ? '<br/>' : '<p></p>';
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
