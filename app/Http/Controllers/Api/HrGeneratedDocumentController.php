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
use PhpOffice\PhpWord\PhpWord;

class HrGeneratedDocumentController extends Controller
{
    private const WITH = [
        'template:id,code,name,employee_category,role_type',
        'employee:id,emp_code,first_name,middle_name,last_name,display_name,email',
        'generator:id,name',
    ];

    private const MODULE_SLUG = 'hr.doc_templates';

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
        $boldNames = array_keys(array_filter($customValues, fn ($v) => $v !== '' && $v !== null));
        $html   = $this->renderTemplate((string) $tpl->content_html, $tokens, $boldNames, $this->rawHtmlTokenNames($customValues));

        return response()->json([
            'rendered_html' => $html,
            'tokens'        => $tokens,
            'letterhead'    => [
                'company_name' => (string) ($tokens['CompanyName'] ?? ''),
                'logo_url'     => $this->letterheadLogoUrl($emp),
            ],
            'template'      => [
                'id' => $tpl->id, 'code' => $tpl->code, 'name' => $tpl->name,
            ],
            'employee'      => [
                'id' => $emp->id, 'emp_code' => $emp->emp_code,
                'full_name' => trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')),
            ],
        ]);
    }

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
                    $boldNames = array_keys(array_filter($custom, fn ($v) => $v !== '' && $v !== null));
                    $html   = $this->renderTemplate((string) $tpl->content_html, $tokens, $boldNames, $this->rawHtmlTokenNames($custom));

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

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        return response()->json($this->resolveRow($request, (int) $id));
    }

    public function downloadDocx(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        if (!class_exists(PhpWord::class)) {
            abort(503, 'DOCX export is not available on this server — the phpoffice/phpword package is missing. Run "composer install" to enable downloads.');
        }

        $tpl = HrDocumentTemplate::find($row->template_id);
        if (!$tpl) abort(404, 'Source template missing.');

        $clone = $tpl->replicate();
        $clone->setRawAttributes($tpl->getAttributes(), true);
        $clone->id = $tpl->id;
        $clone->content_html = (string) ($row->rendered_html ?: '<p>(empty document)</p>');

        $tplCode  = $tpl->code ?: 'doc';
        $empCode  = $row->employee?->emp_code ?: ('emp' . $row->employee_id);
        $filename = "{$tplCode}-{$empCode}.docx";

        return \App\Services\HrTemplateDocxRenderer::render($clone, $filename);
    }

    public function downloadPdf(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        $tpl = HrDocumentTemplate::find($row->template_id);
        if (!$tpl) abort(404, 'Source template missing.');

        $headerCfg = is_array($tpl->header_config) ? $tpl->header_config : [];
        $footerCfg = is_array($tpl->footer_config) ? $tpl->footer_config : [];

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.signed-document', [
            'row'         => $tpl,
            'header'      => $headerCfg,
            'footer'      => $footerCfg,
            'logoDataUri' => $this->headerLogoDataUri($headerCfg, $row),
            'companyName' => (string) (
                $row->employee?->legalEntity?->name
                ?: $row->employee?->branch?->client?->org_name
                ?: $row->employee?->branch?->name
                ?: ''
            ),
            'bodyHtml'    => $this->inlineLocalImagesAsDataUris(
                (string) ($row->rendered_html ?: '<p>(empty document)</p>')
            ),
        ])->setPaper('A4');

        $tplCode = $tpl->code ?: 'doc';
        $empCode = $row->employee?->emp_code ?: ('emp' . $row->employee_id);
        return $pdf->download("{$tplCode}-{$empCode}.pdf");
    }

    private function headerLogoDataUri(array $headerCfg, HrGeneratedDocument $row): ?string
    {
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        $branchLogo = $row->employee?->branch?->logo;
        $clientLogo = $row->employee?->branch?->client?->logo ?: $row->employee?->client?->logo;

        foreach ([
            (string) ($headerCfg['logo_path'] ?? ''),
            $this->diskPathFromUrl((string) ($headerCfg['logo_url'] ?? '')) ?? '',
            $this->diskPathFromUrl((string) ($branchLogo ?? '')) ?? '',
            (string) ($branchLogo ?? ''),
            $this->diskPathFromUrl((string) ($clientLogo ?? '')) ?? '',
            (string) ($clientLogo ?? ''),
        ] as $candidate) {
            $candidate = ltrim($candidate, '/');
            if ($candidate === '' || !$disk->exists($candidate)) continue;

            return $this->imageDataUri($candidate);
        }
        return null;
    }

    private function imageDataUri(string $diskPath): ?string
    {
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        try {
            if (!$disk->exists($diskPath)) return null;
            $bytes = (string) $disk->get($diskPath);
        } catch (\Throwable $e) {
            return null;
        }

        $ext = strtolower((string) pathinfo($diskPath, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'svg'         => 'image/svg+xml',
            ''            => 'image/png',
            default       => 'image/' . $ext,
        };

        if ($mime === 'image/svg+xml' || !function_exists('imagecreatefromstring')) {
            return 'data:' . $mime . ';base64,' . base64_encode($bytes);
        }

        $maxWidth = 900;
        $info = @getimagesizefromstring($bytes);
        if (!$info || $info[0] <= $maxWidth) {
            return 'data:' . $mime . ';base64,' . base64_encode($bytes);
        }

        try {
            $src = @imagecreatefromstring($bytes);
            if (!$src) return 'data:' . $mime . ';base64,' . base64_encode($bytes);

            $w = imagesx($src);
            $h = imagesy($src);
            $newW = $maxWidth;
            $newH = (int) max(1, round($h * ($maxWidth / $w)));

            $dst = imagecreatetruecolor($newW, $newH);
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $w, $h);

            ob_start();
            if ($mime === 'image/jpeg') { imagejpeg($dst, null, 85); }
            else                        { imagepng($dst); $mime = 'image/png'; }
            $resized = (string) ob_get_clean();

            imagedestroy($src);
            imagedestroy($dst);

            if ($resized !== '' && strlen($resized) < strlen($bytes)) $bytes = $resized;
        } catch (\Throwable $e) {
            Log::warning('Logo downscale failed; embedding the original', [
                'path'  => $diskPath,
                'error' => $e->getMessage(),
            ]);
        }

        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    private function diskPathFromUrl(string $src): ?string
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

    private function inlineLocalImagesAsDataUris(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*?)/?>#i',
            function (array $m) {
                [$full, $pre, $q, $src, $post] = $m;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;
                $path = $this->diskPathFromUrl($src);
                if (!$path) return $full;
                $uri = $this->imageDataUri($path);
                return $uri ? '<img' . $pre . 'src=' . $q . $uri . $q . $post . '/>' : $full;
            },
            $html,
        ) ?? $html;
    }

    private function letterheadLogoUrl(\App\Models\Employee $emp): ?string
    {
        $path = $emp->branch?->logo ?: $emp->branch?->client?->logo ?: $emp->client?->logo;
        return $path ? file_url($path) : null;
    }

    private function resolveTokens(Employee $emp, array $customValues, ?HrDocumentTemplate $tpl): array
    {
        $emp->loadMissing([
            'department', 'designation', 'reportingManager', 'reportingManagerUser',
            'legalEntity', 'branch.client',
        ]);

        $first  = trim((string) ($emp->first_name ?? ''));
        $middle = trim((string) ($emp->middle_name ?? ''));
        $last   = trim((string) ($emp->last_name ?? ''));
        $full   = trim($first . ' ' . ($middle ? $middle . ' ' : '') . $last);

        $dateFormat = 'd M Y';
        $joining = $emp->date_of_joining
            ? Carbon::parse($emp->date_of_joining)->format($dateFormat)
            : '';
        $today = now()->format($dateFormat);

        $claimedByCustomField = [];
        try {
            $claimedByCustomField = \App\Models\HrCustomField::query()
                ->when($emp->client_id, fn ($q) => $q->where('client_id', $emp->client_id))
                ->pluck('name')
                ->filter()
                ->map(fn ($n) => mb_strtolower(trim((string) $n)))
                ->flip()
                ->all();
        } catch (\Throwable $e) {
            $claimedByCustomField = [];
        }
        $ownedByOperator = fn (string $token): bool
            => isset($claimedByCustomField[mb_strtolower($token)]);

        $manager = $emp->reportingManager;
        $managerName = '';
        if ($manager) {
            $managerName = trim((string) ($manager->display_name ?? ''))
                ?: trim(((string) ($manager->first_name ?? '')) . ' ' . ((string) ($manager->last_name ?? '')));
        }
        if ($managerName === '' && $emp->reportingManagerUser) {
            $managerName = trim((string) ($emp->reportingManagerUser->name ?? ''));
        }

        $companyName = $emp->legalEntity?->name
            ?: $emp->branch?->client?->org_name
            ?: $emp->branch?->name
            ?: '';

        $branch = $emp->branch;
        $logoPath = $branch?->logo ?: $emp->branch?->client?->logo ?: $emp->client?->logo;
        $logoUrl = $logoPath ? file_url($logoPath) : null;
        $companyLogo = $logoUrl
            ? sprintf(
                '<img src="%s" alt="%s" style="max-height:64px;max-width:220px;" />',
                htmlspecialchars($logoUrl, ENT_QUOTES),
                htmlspecialchars($companyName ?: 'Company logo', ENT_QUOTES),
            )
            : '';
        $companyAddress = $branch
            ? trim(implode(', ', array_filter([
                trim((string) ($branch->address ?? '')),
                trim((string) ($branch->city ?? '')),
                trim((string) ($branch->pincode ?? '')),
            ], fn ($v) => $v !== '')))
            : '';

        $salaryStructure = \App\Models\SalaryStructure::where('employee_id', $emp->id)
            ->where('status', 'active')
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
        $money = fn (?float $v) => $v === null ? '' : number_format($v, 2);

        $tokens = [
            'FirstName'      => $first,
            'MiddleName'     => $middle,
            'LastName'       => $last,
            'FullName'       => $full,
            'DisplayName'    => (string) ($emp->display_name ?: $full),
            'EmployeeNumber' => (string) ($emp->emp_code ?? ''),

            'Email'   => (string) ($emp->email ?? ''),
            'Mobile'  => (string) ($emp->mobile ?? ''),
            'Address' => trim(((string) ($emp->address_line1 ?? '')) . ' ' . ((string) ($emp->address_line2 ?? ''))),
            'City'    => (string) ($emp->city ?? ''),
            'State'   => '',

            'JobTitle'    => (string) ($emp->designation?->name ?? ''),
            'Department'  => (string) ($emp->department?->name ?? ''),
            'Designation' => (string) ($emp->designation?->name ?? ''),
            'JoiningDate' => $joining,
            'ReportsTo'   => $managerName,

            'CTC'   => (string) ($emp->annual_salary ?? ''),
            'Basic' => $salaryStructure ? $money($salaryStructure->basicAmount()) : '',
            'HRA'   => $salaryStructure ? $money($salaryStructure->hraAmount()) : '',

            'CompanyName'    => $companyName,
            'CompanyAddress' => $companyAddress,
            'CompanyLogo'    => $companyLogo,

            'CurrentDate'    => $ownedByOperator('CurrentDate') ? '' : $today,
            'Date'           => $ownedByOperator('Date') ? '' : $today,
            'Today'          => $ownedByOperator('Today') ? '' : $today,
        ];

        if ($tpl && is_array($tpl->signers)) {
            foreach ($tpl->signers as $i => $s) {
                $n = $i + 1;
                $roleName = (string) ($s['role_name'] ?? '');
                $tokens["Signer{$n}Role"]        = $roleName;
                $tokens["Signer{$n}Name"]        = $roleName !== ''
                    ? \App\Support\SignerResolver::name($roleName, $emp)
                    : '';
                $tokens["Signer{$n}Designation"] = (string) ($s['designation_name'] ?? '');
            }
        }

        foreach ($customValues as $name => $val) {
            if (!is_string($name) || $name === '') continue;
            $tokens[$name] = is_scalar($val)
                ? $this->normaliseDate((string) $val, $dateFormat)
                : '';
        }

        return $tokens;
    }

    private function normaliseDate(string $value, string $format): string
    {
        $v = trim($value);
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m)) return $value;
        if (!checkdate((int) $m[2], (int) $m[3], (int) $m[1]))     return $value;
        return Carbon::parse($v)->format($format);
    }

    private function rawHtmlTokenNames(array $customValues): array
    {
        $raw = ['CompanyLogo'];
        return array_values(array_filter(
            $raw,
            fn (string $name) => !array_key_exists($name, $customValues),
        ));
    }

    private function renderTemplate(string $html, array $tokens, array $boldNames = [], array $rawHtmlNames = []): string
    {
        $html = preg_replace(
            '/<span[^>]*data-placeholder="([^"]+)"[^>]*>([^<]*)<\/span>/',
            '$2',
            $html
        );

        $boldSet = array_flip($boldNames);
        $rawSet  = array_flip($rawHtmlNames);

        $canonicalByLowerName = [];
        foreach (array_keys($tokens) as $tokenName) {
            $canonicalByLowerName[strtolower($tokenName)] ??= $tokenName;
        }

        return preg_replace_callback(
            '/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/u',
            function (array $m) use ($tokens, $boldSet, $rawSet, $canonicalByLowerName): string {
                $name = $m[1];
                if (!array_key_exists($name, $tokens)) {
                    $name = $canonicalByLowerName[strtolower($name)] ?? null;
                    if ($name === null) return $m[0];
                }
                if (isset($rawSet[$name])) return (string) $tokens[$name];
                $val = htmlspecialchars((string) $tokens[$name], ENT_QUOTES, 'UTF-8');
                if (isset($boldSet[$name])) {
                    return '<strong>' . $val . '</strong>';
                }
                return $val;
            },
            (string) $html
        ) ?? $html;
    }

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
