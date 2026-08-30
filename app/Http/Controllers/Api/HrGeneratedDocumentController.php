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
        $html   = $this->renderTemplate((string) $tpl->content_html, $tokens, $boldNames, $this->rawHtmlTokenNames($customValues));

        return response()->json([
            'rendered_html' => $html,
            'tokens'        => $tokens,
            /* Resolved letterhead for the on-screen preview. (#126)
             *
             * The modal draws the header strip itself from the template's
             * stored header_config, which is why the preview showed the
             * placeholder words "Company Name" and no logo at all: the config
             * holds whatever was seeded when the template was written, and the
             * frontend had nothing to resolve it against. The PDF path already
             * resolves both — the branch logo via headerLogoDataUri() and the
             * name via the CompanyName token — so the preview was showing
             * something the finished document would never contain.
             *
             * Handed over as plain values rather than the {{CompanyLogo}} token,
             * which is an <img> element the client would have to parse. */
            'letterhead'    => [
                'company_name' => (string) ($tokens['CompanyName'] ?? ''),
                'logo_url'     => $emp->branch?->logo ? file_url($emp->branch->logo) : null,
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

    /**
     * Same document as downloadDocx, rendered to PDF.
     *
     * DOCX is the editable copy, but PhpWord can only write images in the
     * legacy VML form (<w:pict>) — Word, LibreOffice, Google Docs and Office
     * Online all render it, WordPad does not, so a letterhead could silently
     * go missing depending on what opened the file. A PDF looks the same in
     * every reader, which is what a document being sent OUT needs.
     *
     * Reuses the signed-document blade and DomPDF, so the header strip, the
     * footer and the page numbering match the signed copies exactly.
     */
    public function downloadPdf(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);

        $tpl = HrDocumentTemplate::find($row->template_id);
        if (!$tpl) abort(404, 'Source template missing.');

        $headerCfg = is_array($tpl->header_config) ? $tpl->header_config : [];
        $footerCfg = is_array($tpl->footer_config) ? $tpl->footer_config : [];

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.signed-document', [
            'row'         => $tpl,          // blade only reads ->template?->name
            'header'      => $headerCfg,
            'footer'      => $footerCfg,
            'logoDataUri' => $this->headerLogoDataUri($headerCfg, $row),
            /* Same resolution the {{CompanyName}} token uses, for letterheads
               that stored the placeholder words as plain text. (#113) */
            'companyName' => (string) (
                $row->employee?->legalEntity?->name
                ?: $row->employee?->branch?->client?->org_name
                ?: $row->employee?->branch?->name
                ?: ''
            ),
            // DomPDF runs headless and cannot fetch /storage over HTTP, so every
            // local <img> — the body's company logo included — is inlined first.
            'bodyHtml'    => $this->inlineLocalImagesAsDataUris(
                (string) ($row->rendered_html ?: '<p>(empty document)</p>')
            ),
        ])->setPaper('A4');

        $tplCode = $tpl->code ?: 'doc';
        $empCode = $row->employee?->emp_code ?: ('emp' . $row->employee_id);
        return $pdf->download("{$tplCode}-{$empCode}.pdf");
    }

    /**
     * Header-strip logo as a base64 data URI. Same candidate order as the
     * signed-PDF path: the config's saved path, the same config's URL resolved
     * back to a disk path, then the employee's branch logo.
     */
    private function headerLogoDataUri(array $headerCfg, HrGeneratedDocument $row): ?string
    {
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        $branchLogo = $row->employee?->branch?->logo;

        foreach ([
            (string) ($headerCfg['logo_path'] ?? ''),
            $this->diskPathFromUrl((string) ($headerCfg['logo_url'] ?? '')) ?? '',
            $this->diskPathFromUrl((string) ($branchLogo ?? '')) ?? '',
        ] as $candidate) {
            $candidate = ltrim($candidate, '/');
            if ($candidate === '' || !$disk->exists($candidate)) continue;

            return $this->imageDataUri($candidate);
        }
        return null;
    }

    /**
     * Read an image off the public disk as a base64 data URI, DOWNSCALED to a
     * sane print size first.
     *
     * Branch logos are uploaded at whatever the source file happened to be —
     * one in this tenant is 9653 × 3094 and 1.1 MB, for a mark that renders
     * about 64px tall. Base64 inflates that by a third, it went in twice (the
     * header strip and the body's {{CompanyLogo}}), and the result was a 2 MB
     * PDF for a one-page letter, slow to build and heavy to ship.
     *
     * The cap is generous — 900px still prints crisply at any letterhead size —
     * and anything already smaller is passed through untouched, so nothing is
     * re-encoded for no reason.
     */
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
        // "image/jpg" is not a valid type — some readers refuse to decode it.
        $mime = match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'svg'         => 'image/svg+xml',
            ''            => 'image/png',
            default       => 'image/' . $ext,
        };

        // SVG is already small and resolution-independent; GD can't read it anyway.
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
            // Keep transparency — a logo flattened onto black is worse than a
            // large one.
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

            // Only take the resized copy if it actually helped.
            if ($resized !== '' && strlen($resized) < strlen($bytes)) $bytes = $resized;
        } catch (\Throwable $e) {
            Log::warning('Logo downscale failed; embedding the original', [
                'path'  => $diskPath,
                'error' => $e->getMessage(),
            ]);
        }

        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    /** Resolve an image reference to a path on the public disk, or null. */
    private function diskPathFromUrl(string $src): ?string
    {
        $src = trim($src);
        if ($src === '' || str_starts_with($src, 'data:')) return null;

        $parsed = parse_url($src);
        $path = ltrim(str_replace('\\', '/', $parsed['path'] ?? $src), '/');

        if (preg_match('#(?:^|/)storage/(.+)$#', $path, $m)) return $m[1];
        if (isset($parsed['scheme'])) return null;              // remote host
        if (str_starts_with($path, 'public/')) $path = substr($path, strlen('public/'));
        // A bare basename with no folder is a stale row from a buggy save.
        return str_contains($path, '/') ? $path : null;
    }

    /**
     * Rewrite local <img src> values into base64 data URIs so DomPDF, which
     * runs headless, can embed them.
     */
    private function inlineLocalImagesAsDataUris(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*?)/?>#i',
            function (array $m) {
                [$full, $pre, $q, $src, $post] = $m;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;
                $path = $this->diskPathFromUrl($src);
                if (!$path) return $full;
                // Same downscaling as the header logo — the body carries the
                // very same file via {{CompanyLogo}}.
                $uri = $this->imageDataUri($path);
                return $uri ? '<img' . $pre . 'src=' . $q . $uri . $q . $post . '/>' : $full;
            },
            $html,
        ) ?? $html;
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
        // reportingManagerUser: a manager can be a Branch / login user rather
        // than an employee — {{ReportsTo}} has to resolve either kind.
        $emp->loadMissing([
            'department', 'designation', 'reportingManager', 'reportingManagerUser',
            'legalEntity', 'branch.client',
        ]);

        $first  = trim((string) ($emp->first_name ?? ''));
        $middle = trim((string) ($emp->middle_name ?? ''));
        $last   = trim((string) ($emp->last_name ?? ''));
        $full   = trim($first . ' ' . ($middle ? $middle . ' ' : '') . $last);

        // One format string for every date the template can print, so a letter
        // never mixes "14 Aug 2026" with another rendering of the same field.
        $dateFormat = 'd M Y';
        $joining = $emp->date_of_joining
            ? Carbon::parse($emp->date_of_joining)->format($dateFormat)
            : '';
        $today = now()->format($dateFormat);

        /* Token names a REGISTERED custom field has claimed. (#105)
         *
         * CurrentDate / Date / Today are built-ins filled with the generation
         * date, which is right for a template that just wants "today" printed
         * on it. But a tenant can also define a custom field of the same name,
         * and then the date is not the system's to decide — it is a value the
         * operator types on the Send-for-signature screen (a joining date, an
         * effective date, an agreed date). Filling it automatically meant the
         * field arrived pre-answered with today, and leaving it blank silently
         * printed today anyway.
         *
         * A registered custom field therefore OWNS its name: the built-in is
         * suppressed and the token starts blank, so it stays blank unless the
         * operator fills it in. Compared case-insensitively because
         * renderTemplate() matches tokens that way — {{Date}} and {{date}} are
         * the same token and must not disagree about who owns them. */
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
            // No registry (or it cannot be read) — behave exactly as before.
            $claimedByCustomField = [];
        }
        $ownedByOperator = fn (string $token): bool
            => isset($claimedByCustomField[mb_strtolower($token)]);

        /* Reports To resolves EITHER kind of manager.
         *
         * This read `reportingManager` only — the employee-manager relation —
         * so an employee whose manager is a Branch / login user
         * (reporting_manager_user_id) rendered a blank line in every letter,
         * which is half of "some placeholders are not fetching" (QA #39).
         * `display_name` is preferred over first+last for the same reason
         * MyTeamController::reportsToName() prefers it: it is the name HR
         * actually maintains, and first/last can be empty on a record that has
         * one. */
        $manager = $emp->reportingManager;
        $managerName = '';
        if ($manager) {
            $managerName = trim((string) ($manager->display_name ?? ''))
                ?: trim(((string) ($manager->first_name ?? '')) . ' ' . ((string) ($manager->last_name ?? '')));
        }
        if ($managerName === '' && $emp->reportingManagerUser) {
            $managerName = trim((string) ($emp->reportingManagerUser->name ?? ''));
        }

        // Legal entity = the employing branch. This previously read
        // `legal_entity_name`, a column that never existed on the old
        // master_legal_entities table either, so CompanyName always silently
        // fell through to the client org name.
        /* ...and finally the BRANCH's own name. Without a last resort this
           returned '', and a footer written as "{{CompanyName}} Confidential"
           then printed a bare "Confidential" on every page — read as the
           document's classification rather than as a name that failed to
           resolve (CBC #113). Every employee has a branch, so this always has
           something true to say. */
        $companyName = $emp->legalEntity?->name
            ?: $emp->branch?->client?->org_name
            ?: $emp->branch?->name
            ?: '';

        /* CompanyLogo and CompanyAddress were both hardcoded to '' — a template
         * that used them rendered a blank line where the letterhead belonged,
         * which is the "half the fields come through" report. Both come off the
         * employing BRANCH, the same entity CompanyName resolves to.
         * The logo is emitted as an <img>: file_url() gives a /storage URL,
         * which the on-screen preview loads directly and the PDF path rewrites
         * into a data URI (inlineLocalImagesAsDataUris) because DomPDF cannot
         * fetch over HTTP. */
        $branch = $emp->branch;
        $logoUrl = $branch ? file_url($branch->logo) : null;
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

        /* The compensation actually in force. Revisions supersede rather than
           overwrite (one `active` row per employee, Rule 19), so a letter must
           read the active one — ordered defensively in case data ever carries
           more than one. */
        $salaryStructure = \App\Models\SalaryStructure::where('employee_id', $emp->id)
            ->where('status', 'active')
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
        /* Blank, not "0.00", when a component genuinely isn't there — a zero in
           an offer letter is a statement, an empty line is an omission. */
        $money = fn (?float $v) => $v === null ? '' : number_format($v, 2);

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

            /* Salary. CTC is the headline figure on the employee row; the
               breakdown comes off the employee's ACTIVE salary structure.
               Both were hardcoded '' with a note deferring them to "Phase 2" —
               but the engine did get wired in, and the components have been
               sitting in salary_structures.earnings ever since, so every
               template using {{Basic}} or {{HRA}} printed a blank line
               (QA #39). These are MONTHLY amounts, as the structure stores
               them and as Salary Setup shows them. */
            'CTC'   => (string) ($emp->annual_salary ?? ''),
            'Basic' => $salaryStructure ? $money($salaryStructure->basicAmount()) : '',
            'HRA'   => $salaryStructure ? $money($salaryStructure->hraAmount()) : '',

            // Organization
            'CompanyName'    => $companyName,
            'CompanyAddress' => $companyAddress,
            'CompanyLogo'    => $companyLogo,

            /* Date of generation. Templates were already written against
             * {{Currentdate}} with no entry here, so an offer letter went out
             * with the literal braces printed where the date belonged. Unknown
             * tokens are deliberately left as-is — right for a typo, wrong for
             * a field the author had every reason to expect.
             * Only the canonical spellings are listed; renderTemplate() matches
             * case-insensitively, so {{Currentdate}} and {{currentdate}} both
             * resolve without an entry each. */
            /* Blank when a custom field of the same name exists — see
               $ownedByOperator above. Kept in the map (rather than dropped) so
               the token still resolves: an unknown token is printed with its
               braces intact, which would put a literal {{Date}} in the letter
               whenever the operator left the field empty. (#105) */
            'CurrentDate'    => $ownedByOperator('CurrentDate') ? '' : $today,
            'Date'           => $ownedByOperator('Date') ? '' : $today,
            'Today'          => $ownedByOperator('Today') ? '' : $today,
        ];

        /* Signer slot tokens. The NAME is the real person the role resolves to
         * for this employee, not the role label: {{Signer1Name}} on a template
         * whose first signer is "Employee" used to render the word "Employee"
         * where that employee's own name belonged, and "Reporting Manager"
         * instead of the manager's. Same resolver the send path uses
         * (App\Support\SignerResolver), so the preview names the same people
         * who will actually be asked to sign.
         * Sign/Date stay blank here — they are filled when each signer acts. */
        if ($tpl && is_array($tpl->signers)) {
            foreach ($tpl->signers as $i => $s) {
                $n = $i + 1;
                $roleName = (string) ($s['role_name'] ?? '');
                $tokens["Signer{$n}Role"]        = $roleName;
                $tokens["Signer{$n}Name"]        = $roleName !== ''
                    ? \App\Support\SignerResolver::name($roleName, $emp)
                    : '';
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
     * Tokens whose value is MARKUP this controller built, not text — they must
     * reach the document unescaped or the <img> prints as visible tag soup.
     *
     * Derived AFTER the operator overrides above and with anything the operator
     * supplied removed: a custom field named "CompanyLogo" would otherwise be a
     * route for arbitrary HTML into every generated document.
     *
     * @param  array<string,mixed> $customValues
     * @return array<int,string>
     */
    private function rawHtmlTokenNames(array $customValues): array
    {
        $raw = ['CompanyLogo'];
        return array_values(array_filter(
            $raw,
            fn (string $name) => !array_key_exists($name, $customValues),
        ));
    }

    /**
     * Substitute every {{Token}} in the template HTML with its resolved
     * value. Unknown tokens are left untouched so the operator notices them
     * in the preview. Placeholder-chip wrappers are stripped before
     * substitution so the rendered output isn't full of indigo pills.
     *
     * Token names are matched exactly first, then case-insensitively. Template
     * authors type {{JoiningDate}}, {{Joiningdate}} and {{joiningdate}}
     * interchangeably, and an exact-match-only lookup printed the raw braces
     * into a document going out to a new hire. A genuine typo still falls
     * through untouched — that is what makes it visible in the preview.
     *
     * @param  array<string,string> $tokens     token name => resolved value
     * @param  string[]             $boldNames  token names whose substituted
     *                              value should be wrapped in <strong> — used
     *                              for operator-supplied custom field values so
     *                              they pop visually.
     * @param  string[]             $rawHtmlNames  tokens whose value is markup
     *                              THIS controller built (the company logo's
     *                              <img>) and must not be escaped. Never pass
     *                              an operator-supplied name — see
     *                              rawHtmlTokenNames().
     */
    private function renderTemplate(string $html, array $tokens, array $boldNames = [], array $rawHtmlNames = []): string
    {
        // Strip Tiptap PlaceholderNode chip wrappers — keep only the inner
        // {{Name}} text so the regex below can substitute it.
        $html = preg_replace(
            '/<span[^>]*data-placeholder="([^"]+)"[^>]*>([^<]*)<\/span>/',
            '$2',
            $html
        );

        $boldSet = array_flip($boldNames);
        $rawSet  = array_flip($rawHtmlNames);

        /* Lowercased name => canonical name, built ONCE. Scanning the whole
         * token map inside the callback made the fallback O(tokens × matches)
         * on every render. First key wins, so the result does not depend on
         * hash order when two names differ only in case. */
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
                    if ($name === null) return $m[0];   // unknown — leave it visible
                }
                // Markup we generated ourselves goes through untouched; escaping
                // it would print the <img> tag as visible text.
                if (isset($rawSet[$name])) return (string) $tokens[$name];
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
