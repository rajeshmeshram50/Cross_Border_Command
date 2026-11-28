<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Candidate;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\Recruitment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CandidateController extends Controller
{
    private const WITH = [
        'recruitment:id,code,job_title',
    ];

    private const MODULE_SLUG = 'hr.recruitment';

    private const STATUSES = [
        'Applied', 'Shortlisted', 'In Interview', 'Final Interview',
        'Selected', 'Offered', 'Rejected', 'On Hold',
    ];
    private const SOURCES = [
        'LinkedIn', 'Naukri', 'Indeed', 'Referral', 'Company Website',
        'Walk-in', 'Recruitment Agency', 'Internal', 'Other',
    ];
    private const NOTICE_PERIODS = [
        'Immediate', '15 Days', '30 Days', '45 Days', '60 Days', '90 Days',
    ];
    private const TRANSPORT_MODES = [
        'Walk', 'Bicycle', 'Two-wheeler', 'Four-wheeler', 'Public Transport', 'Other',
    ];

    private const EMAIL_RULES = [
        'nullable',
        'email:rfc',
        'max:191',
        'regex:/^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/',
        'not_regex:/\.\./',
    ];

    private const STATUS_GROUPS = [
        'all'      => ['Applied', 'Shortlisted', 'In Interview', 'Final Interview', 'On Hold'],
        'final'    => ['Final Interview'],
        'selected' => ['Selected', 'Offered'],
        'rejected' => ['Rejected'],
    ];

    private const CV_MAX_KB     = 2048;
    private const CV_MIME_TYPES = 'pdf,doc,docx';

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Candidate::query()->with(self::WITH);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($recId = $request->query('recruitment_id')) {
            $q->where('recruitment_id', $recId);
        }
        if ($status = $request->query('status')) {
            if (!in_array($status, self::STATUSES, true)) {
                return response()->json(['message' => 'Invalid status filter.'], 422);
            }
            $q->where('status', $status);
        }
        if ($source = $request->query('source')) {
            if (!in_array($source, self::SOURCES, true)) {
                return response()->json(['message' => 'Invalid source filter.'], 422);
            }
            $q->where('source', $source);
        }
        if ($group = $request->query('status_group')) {
            $bucket = self::STATUS_GROUPS[$group] ?? null;
            if ($bucket === null) {
                return response()->json(['message' => 'Invalid status_group filter.'], 422);
            }
            $q->whereIn('status', $bucket);
        }
        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                  ->orWhere('email', 'ilike', "%{$search}%")
                  ->orWhere('mobile', 'ilike', "%{$search}%");
            });
        }

        $q->orderByDesc('id');

        if ($request->filled('per_page')) {
            $perPage = max(1, min(200, (int) $request->query('per_page')));
            $pageNo  = max(1, (int) $request->query('page', 1));
            $page    = $q->paginate($perPage, ['*'], 'page', $pageNo);

            return response()->json([
                'data'         => collect($page->items())->map(fn ($c) => $this->serialize($c))->values(),
                'total'        => $page->total(),
                'per_page'     => $page->perPage(),
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
            ]);
        }

        return response()->json($q->get()->map(fn ($c) => $this->serialize($c)));
    }

    public function show(Request $request, $id)
    {
        $this->authorize($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($this->serialize($row));
    }

    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Candidate::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        if ($recId = $request->query('recruitment_id')) {
            $q->where('recruitment_id', $recId);
        }

        $rows = (clone $q)
            ->selectRaw('status, COUNT(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status');

        $get = fn (string $s) => (int) ($rows[$s] ?? 0);

        return response()->json([
            'total'           => (int) $rows->sum(),
            'applied'         => $get('Applied'),
            'shortlisted'     => $get('Shortlisted'),
            'in_interview'    => $get('In Interview'),
            'final_interview' => $get('Final Interview'),
            'selected'        => $get('Selected'),
            'offered'         => $get('Offered'),
            'rejected'        => $get('Rejected'),
            'on_hold'         => $get('On Hold'),
        ]);
    }

    public function recruitmentSummary(Request $request, $recruitmentId)
    {
        $this->authorize($request, 'can_view');

        $rec = Recruitment::with([
            'department:id,name',
            'designation:id,name',
            'hiringManager:id,emp_code,display_name,first_name,last_name',
            'assignedHr:id,emp_code,display_name,first_name,last_name',
        ]);
        $this->applyRecruitmentScope($rec, $request->user());
        $rec = $rec->findOrFail((int) $recruitmentId);

        $mgrName = $rec->hiringManager?->display_name
            ?: trim(($rec->hiringManager?->first_name ?? '') . ' ' . ($rec->hiringManager?->last_name ?? ''));
        $hrName  = $rec->assignedHr?->display_name
            ?: trim(($rec->assignedHr?->first_name ?? '') . ' ' . ($rec->assignedHr?->last_name ?? ''));

        return response()->json([
            'recruitment' => [
                'id'               => (string) $rec->id,
                'code'             => $rec->code,
                'jobTitle'         => $rec->job_title,
                'department'       => $rec->department?->name,
                'designation'      => $rec->designation?->name,
                'employmentType'   => $rec->employment_type,
                'openings'         => (int) $rec->openings,
                'experience'       => $rec->experience,
                'qualification'    => $rec->qualification,
                'workMode'         => $rec->work_mode,
                'priority'         => $rec->priority,
                'hiringManagerRaw' => $mgrName ?: null,
                'assignedHrName'   => $hrName ?: null,
                'startDate'        => optional($rec->start_date)->toDateString(),
                'deadline'         => optional($rec->deadline)->toDateString(),
                'status'           => $rec->status,
            ],
        ]);
    }

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);
        $this->normaliseReferral($data);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            $parent = $this->loadParentRecruitment($request, (int) $data['recruitment_id']);
            $this->guardRecruitmentOpen($parent);

            $this->guardDuplicate($data, (int) $data['recruitment_id'], null);
            // A brand-new candidate may be created straight as Selected — honour
            // the openings-full rule here too.
            $this->assertOpeningAvailable((int) $parent->id, $data['status'] ?? null);

            $payload = array_merge($data, [
                'client_id'  => $parent->client_id,
                'branch_id'  => $parent->branch_id,
                'created_by' => $auth?->id,
            ]);

            if ($request->hasFile('cv')) {
                [$path, $original] = $this->storeCv($request->file('cv'), $parent->client_id, $parent->id);
                $payload['cv_path']          = $path;
                $payload['cv_original_name'] = $original;
            }

            $row = Candidate::create($payload);
            $row->load(self::WITH);

            return response()->json($this->serialize($row), 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);
        $this->normaliseReferral($data);
        $this->guardDuplicate($data, $row->recruitment_id, $row->id);

        // Editing the candidate must honour the same openings-full rule as the
        // list-view "mark Selected" action — selecting here was bypassing it.
        $this->assertOpeningAvailable($row->recruitment_id, $data['status'] ?? null, $row->id, $row->status);

        $oldPath = $row->cv_path;
        if ($request->hasFile('cv')) {
            [$path, $original] = $this->storeCv($request->file('cv'), $row->client_id, $row->recruitment_id);
            $data['cv_path']          = $path;
            $data['cv_original_name'] = $original;
        }

        $row->update($data);

        if ($request->hasFile('cv') && $oldPath && $oldPath !== ($data['cv_path'] ?? null)) {
            Storage::disk('public')->delete($oldPath);
        }

        $row->load(self::WITH);
        return response()->json($this->serialize($row));
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        $row->delete();
        return response()->json(['message' => 'Candidate removed.']);
    }

    public function downloadCv(Request $request, $id)
    {
        $this->authenticateFromQueryToken($request);
        $this->authorize($request, 'can_view');

        $row = $this->resolveRow($request, (int) $id);
        if (empty($row->cv_path)) {
            abort(404, 'No CV uploaded for this candidate.');
        }

        $disk = Storage::disk('public');
        if (!$disk->exists($row->cv_path)) {
            abort(404, 'CV file is missing on the server.');
        }

        $filename = $row->cv_original_name ?: basename($row->cv_path);
        return $disk->download($row->cv_path, $filename);
    }

    private function authenticateFromQueryToken(Request $request): void
    {
        if (!$request->user() && $request->bearerToken()) {
            $token = \Laravel\Sanctum\PersonalAccessToken::findToken($request->bearerToken());
            if ($token) {
                $request->setUserResolver(fn () => $token->tokenable);
            }
        }
        if (!$request->user() && $request->query('token')) {
            $token = \Laravel\Sanctum\PersonalAccessToken::findToken($request->query('token'));
            if ($token) {
                $request->setUserResolver(fn () => $token->tokenable);
            } else {
                abort(401, 'Invalid token');
            }
        }
        if (!$request->user()) {
            abort(401, 'Unauthorized');
        }
    }

    /**
     * Block putting a candidate into an opening-occupying status (Selected /
     * Offered) once every opening on the recruitment is already filled.
     * Shared by store(), update() and updateStatus() so no path can bypass it.
     * $excludeId / $currentStatus are null when creating a brand-new candidate.
     */
    private function assertOpeningAvailable(int $recruitmentId, ?string $newStatus, ?int $excludeId = null, ?string $currentStatus = null): void
    {
        $occupying = ['Selected', 'Offered'];
        // Only guards a transition INTO an occupying status; re-saving a
        // candidate that is already Selected/Offered is fine.
        if (!$newStatus || !in_array($newStatus, $occupying, true) || in_array($currentStatus, $occupying, true)) {
            return;
        }
        $rec = Recruitment::find($recruitmentId);
        if (!$rec) {
            return;
        }
        $query = Candidate::query()
            ->where('recruitment_id', $recruitmentId)
            ->whereIn('status', $occupying);
        if ($excludeId) {
            $query->where('id', '!=', $excludeId);
        }
        $filled = $query->count();
        if ($filled >= (int) $rec->openings) {
            throw ValidationException::withMessages([
                'status' => [sprintf(
                    'All %d opening(s) for %s are already filled — cannot select more candidates. Reject one of the existing selections first.',
                    (int) $rec->openings,
                    $rec->code ?: ('#' . $rec->id),
                )],
            ]);
        }
    }

    public function updateStatus(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $request->validate([
            'status'           => ['required', Rule::in(self::STATUSES)],
            'rejection_reason' => 'nullable|string|max:100',
            'status_notes'     => 'nullable|string',
        ]);

        $this->assertOpeningAvailable($row->recruitment_id, $data['status'], $row->id, $row->status);

        $previousStatus = $row->status;
        $row->update($data);

        if ($data['status'] === 'Selected' && $previousStatus !== 'Selected') {
            $this->notifyCandidateDecision($row->fresh(), 'selected', $data['status_notes'] ?? null);
        } elseif ($data['status'] === 'Rejected' && $previousStatus !== 'Rejected') {
            $this->notifyCandidateDecision($row->fresh(), 'rejected', $data['status_notes'] ?? null, $data['rejection_reason'] ?? null);
        }

        $row->load(self::WITH);
        return response()->json($this->serialize($row));
    }

    private function notifyCandidateDecision(Candidate $candidate, string $decision, ?string $notes = null, ?string $reason = null): void
    {
        if (!\App\Support\Settings::shouldSendMail()) return;
        $email = trim((string) ($candidate->email ?? ''));
        if ($email === '') return;

        try {
            $candidate->loadMissing('recruitment:id,code,job_title');
            $orgName = \App\Models\Client::find($candidate->client_id)?->org_name
                ?? config('mail.from.name', 'Cross Border Command');
            $jobTitle = $candidate->recruitment?->job_title;

            $mailable = $decision === 'selected'
                ? new \App\Mail\CandidateSelectedMail($candidate, $orgName, $jobTitle, $notes)
                : new \App\Mail\CandidateRejectedMail($candidate, $orgName, $jobTitle, $reason, $notes);

            \Illuminate\Support\Facades\Mail::to($email)->send($mailable);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Candidate decision mail failed', [
                'candidate_id' => $candidate->id,
                'decision'     => $decision,
                'error'        => $e->getMessage(),
            ]);
        }
    }

    private function normaliseReferral(array &$data): void
    {
        if (!array_key_exists('source', $data)) return;
        if (($data['source'] ?? null) !== 'Referral') {
            $data['referred_by_id']   = null;
            $data['referred_by_name'] = null;
        }
    }

    private const CSV_COLUMNS = [
        'Name', 'Email', 'Mobile', 'Experience', 'Qualification',
        'Current Salary', 'Expected Salary',
        'Notice Period', 'Source', 'Status',
    ];

    private const IMPORT_STATUS_MAP = [
        'final round selected' => 'Final Interview',
        'final interview'      => 'Final Interview',
        'selected'             => 'Selected',
    ];

    public function sample(Request $request)
    {
        $this->authorize($request, 'can_view');

        $sampleRow = [
            'Priya Sharma', 'priya.s@example.com', '+91 9812345678', '5', 'B.Tech',
            '15', '22', '30 Days', 'LinkedIn', 'Final Round Selected',
        ];

        return $this->csvResponse('candidates_sample.csv', [
            self::CSV_COLUMNS,
            $sampleRow,
        ]);
    }

    public function import(Request $request)
    {
        $this->authorize($request, 'can_add');

        $request->validate([
            'recruitment_id' => 'required|integer|exists:recruitments,id',
            'file'           => 'required|file|mimes:csv,txt,xlsx,xls|max:10240',
        ]);

        $parent = $this->loadParentRecruitment($request, (int) $request->input('recruitment_id'));
        $this->guardRecruitmentOpen($parent);

        $rows = $this->parseUpload($request->file('file'));
        if ($rows === null) {
            throw ValidationException::withMessages([
                'file' => ['Could not read the file. Please upload a CSV or .xlsx exported from the Sample template.'],
            ]);
        }
        if (count($rows) <= 1) {
            throw ValidationException::withMessages([
                'file' => ['The file is empty — only a header row was found.'],
            ]);
        }

        $header = array_map(fn ($v) => $this->normaliseHeader($v), $rows[0]);
        $dataRows = array_slice($rows, 1);

        $colIdx = [];
        foreach (self::CSV_COLUMNS as $expected) {
            $key = $this->normaliseHeader($expected);
            $idx = array_search($key, $header, true);
            if ($idx !== false) $colIdx[$expected] = $idx;
        }
        if (!isset($colIdx['Name'])) {
            throw ValidationException::withMessages([
                'file' => ['Required column "Name" was not found in the file.'],
            ]);
        }

        $created = 0;
        $skipped = 0;
        $errors  = [];
        $auth    = $request->user();

        $openings      = (int) $parent->openings;
        $selectedCount = Candidate::query()
            ->where('recruitment_id', $parent->id)
            ->whereIn('status', ['Selected', 'Offered'])
            ->count();

        $existingEmails = Candidate::query()
            ->where('recruitment_id', $parent->id)
            ->whereNotNull('email')
            ->pluck('email')
            ->map(fn ($e) => mb_strtolower(trim((string) $e)))
            ->filter()
            ->flip();

        DB::beginTransaction();
        try {
        foreach ($dataRows as $i => $row) {
            $rowNum = $i + 2;
            $isEmpty = true;
            foreach ($row as $cell) { if (trim((string) $cell) !== '') { $isEmpty = false; break; } }
            if ($isEmpty) continue;

            $payload = $this->mapImportRow($row, $colIdx);

            $validator = \Illuminate\Support\Facades\Validator::make($payload, [
                'name'                => ['required', 'string', 'max:150', "regex:/^[A-Za-z][A-Za-z .'\\-]*$/"],
                'email'               => self::EMAIL_RULES,
                'mobile'              => 'nullable|string|max:30',
                'experience_years'    => 'nullable|numeric|min:0|max:99.99',
                'qualification'       => 'nullable|string|max:191',
                'current_salary_lpa'  => 'nullable|numeric|min:0|max:9999.99',
                'expected_salary_lpa' => 'nullable|numeric|min:0|max:9999.99',
                'notice_period'       => ['nullable', Rule::in(self::NOTICE_PERIODS)],
                'source'              => ['nullable', Rule::in(self::SOURCES)],
            ], [
                'name.required' => 'Name is required.',
                'name.regex'    => "Name may only contain letters, spaces and . ' - (no special characters or blank names).",
            ]);
            if ($validator->fails()) {
                $skipped++;
                $errors[] = ['row' => $rowNum, 'message' => $validator->errors()->first()];
                continue;
            }

            $rawStatus = mb_strtolower(trim((string) ($payload['status'] ?? '')));
            $mappedStatus = self::IMPORT_STATUS_MAP[$rawStatus] ?? null;
            if ($mappedStatus === null) {
                $skipped++;
                $errors[] = ['row' => $rowNum, 'message' => 'Status must be "Final Round Selected" or "Selected" — this row was not imported.'];
                continue;
            }
            $payload['status'] = $mappedStatus;

            if (!empty($payload['email'])) {
                $emailKey = mb_strtolower(trim((string) $payload['email']));
                $exists   = isset($existingEmails[$emailKey]);
                if ($exists) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => "Duplicate email — already linked to this recruitment."];
                    continue;
                }
            }

            if ($mappedStatus === 'Selected' && $selectedCount >= $openings) {
                $skipped++;
                $errors[] = ['row' => $rowNum, 'message' => sprintf(
                    'All %d opening(s) are already filled — this Selected candidate was not imported.',
                    $openings,
                )];
                continue;
            }

            Candidate::create(array_merge($payload, [
                'client_id'      => $parent->client_id,
                'branch_id'      => $parent->branch_id,
                'created_by'     => $auth?->id,
                'recruitment_id' => $parent->id,
            ]));
            $created++;
            if (!empty($payload['email'])) {
                $existingEmails[mb_strtolower(trim((string) $payload['email']))] = true;
            }
            if ($mappedStatus === 'Selected') $selectedCount++;
        }

        DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return response()->json([
            'created' => $created,
            'skipped' => $skipped,
            'errors'  => $errors,
        ]);
    }

    public function export(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Candidate::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($recId = $request->query('recruitment_id'))    $q->where('recruitment_id', $recId);
        if ($status = $request->query('status'))           $q->where('status', $status);
        if ($source = $request->query('source'))           $q->where('source', $source);
        if ($group = $request->query('status_group')) {
            $bucket = self::STATUS_GROUPS[$group] ?? null;
            if ($bucket === null) {
                return response()->json(['message' => 'Invalid status_group filter.'], 422);
            }
            $q->whereIn('status', $bucket);
        }
        if ($ids = $request->query('ids')) {
            $idList = array_filter(array_map('intval', explode(',', $ids)));
            if (!empty($idList)) $q->whereIn('id', $idList);
        }
        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                  ->orWhere('email', 'ilike', "%{$search}%")
                  ->orWhere('mobile', 'ilike', "%{$search}%");
            });
        }

        $rows = $q->with('recruitment:id,code')->orderByDesc('id')->get();

        $exportHeader = [
            'Name', 'Email', 'Mobile', 'Experience', 'Qualification',
            'Current Salary', 'Expected Salary', 'Notice Period',
            'Source', 'Status', 'Recruitment ID',
        ];
        $data = $rows->map(function (Candidate $c) {
            return [
                $c->name,
                $c->email ?? '',
                $c->mobile ?? '',
                $c->experience_years !== null ? (string) (float) $c->experience_years : '',
                $c->qualification ?? '',
                $c->current_salary_lpa  !== null ? (string) (float) $c->current_salary_lpa  : '',
                $c->expected_salary_lpa !== null ? (string) (float) $c->expected_salary_lpa : '',
                $c->notice_period ?? '',
                $c->source ?? '',
                $c->status,
                $c->recruitment?->code ?? '',
            ];
        })->all();

        return $this->csvResponse('candidates_export.csv', array_merge([$exportHeader], $data));
    }

    private function csvResponse(string $filename, array $rows): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            foreach ($rows as $row) {
                fputcsv($out, $row);
            }
            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    private function parseUpload($uploaded): ?array
    {
        $path = $uploaded?->getRealPath();
        if (!$path || !is_readable($path)) return null;

        $sig = (string) file_get_contents($path, false, null, 0, 8);

        if (str_starts_with($sig, "PK\x03\x04")) {
            return $this->parseXlsx($uploaded);
        }
        if (str_starts_with($sig, "\xD0\xCF\x11\xE0")) {
            throw ValidationException::withMessages([
                'file' => ['Legacy .xls files aren\'t supported — open the file and "Save As" .xlsx or .csv, then re-upload.'],
            ]);
        }
        return $this->parseCsv($uploaded);
    }

    private function parseXlsx($uploaded): ?array
    {
        $path = $uploaded?->getRealPath();
        if (!$path || !is_readable($path)) return null;

        $zip = new \ZipArchive();
        if ($zip->open($path) !== true) return null;

        try {
            $shared = [];
            $ssXml = $zip->getFromName('xl/sharedStrings.xml');
            if ($ssXml !== false) {
                $sst = $this->loadXlsxXml($ssXml);
                if ($sst !== null) {
                    foreach ($sst->si as $si) {
                        $text = '';
                        foreach ($si->xpath('.//t') as $t) { $text .= (string) $t; }
                        $shared[] = $text;
                    }
                }
            }

            $sheetEntry = null;
            if ($zip->locateName('xl/worksheets/sheet1.xml') !== false) {
                $sheetEntry = 'xl/worksheets/sheet1.xml';
            } else {
                for ($i = 0; $i < $zip->numFiles; $i++) {
                    $name = $zip->getNameIndex($i);
                    if ($name !== false && preg_match('#^xl/worksheets/sheet\d+\.xml$#', $name)) {
                        if ($sheetEntry === null || strcmp($name, $sheetEntry) < 0) $sheetEntry = $name;
                    }
                }
            }
            if ($sheetEntry === null) return null;

            $sheetXml = $zip->getFromName($sheetEntry);
            if ($sheetXml === false) return null;
            $sheet = $this->loadXlsxXml($sheetXml);
            if ($sheet === null || !isset($sheet->sheetData)) return [];

            $rows = [];
            foreach ($sheet->sheetData->row as $row) {
                $cells = [];
                $maxIdx = -1;
                foreach ($row->c as $c) {
                    $colIdx = $this->xlsxColumnIndex((string) $c['r']);
                    $type   = (string) $c['t'];
                    if ($type === 's') {
                        $val = $shared[(int) $c->v] ?? '';
                    } elseif ($type === 'inlineStr') {
                        $val = '';
                        foreach ($c->is->xpath('.//t') as $t) { $val .= (string) $t; }
                    } elseif ($type === 'b') {
                        $val = ((string) $c->v === '1') ? 'TRUE' : 'FALSE';
                    } else {
                        $val = (string) $c->v;
                    }
                    $cells[$colIdx] = $val;
                    if ($colIdx > $maxIdx) $maxIdx = $colIdx;
                }
                $rowArr = [];
                for ($k = 0; $k <= $maxIdx; $k++) {
                    $rowArr[] = $cells[$k] ?? '';
                }
                $rows[] = $rowArr;
            }
            return $rows;
        } finally {
            $zip->close();
        }
    }

    private function loadXlsxXml(string $xml): ?\SimpleXMLElement
    {
        $xml = preg_replace('/\sxmlns="[^"]*"/', '', $xml, 1);
        $prev = libxml_use_internal_errors(true);
        $node = simplexml_load_string($xml);
        libxml_use_internal_errors($prev);
        return $node === false ? null : $node;
    }

    private function xlsxColumnIndex(string $ref): int
    {
        if (!preg_match('/^([A-Za-z]+)/', $ref, $m)) return 0;
        $letters = strtoupper($m[1]);
        $idx = 0;
        for ($i = 0, $len = strlen($letters); $i < $len; $i++) {
            $idx = $idx * 26 + (ord($letters[$i]) - 64);
        }
        return $idx - 1;
    }

    private function parseCsv($uploaded): ?array
    {
        $path = $uploaded->getRealPath();
        if (!$path || !is_readable($path)) return null;

        $contents = file_get_contents($path);
        if ($contents === false) return null;

        if (str_starts_with($contents, "\xEF\xBB\xBF")) {
            $contents = substr($contents, 3);
        }

        $delimiter = $this->detectDelimiter($contents);

        $rows = [];
        $fh = fopen('php://memory', 'r+');
        if ($fh === false) return null;
        fwrite($fh, $contents);
        rewind($fh);
        while (($row = fgetcsv($fh, 0, $delimiter)) !== false) {
            $rows[] = $row;
        }
        fclose($fh);
        return $rows;
    }

    private function detectDelimiter(string $contents): string
    {
        $firstLine = strtok($contents, "\r\n");
        if ($firstLine === false) return ',';

        $best = ',';
        $bestCount = 0;
        foreach ([',', ';', "\t"] as $candidate) {
            $count = count(str_getcsv($firstLine, $candidate));
            if ($count > $bestCount) {
                $bestCount = $count;
                $best = $candidate;
            }
        }
        return $best;
    }

    private function normaliseHeader($v): string
    {
        $v = strtolower(trim((string) $v));
        $v = trim($v, "\xEF\xBB\xBF\"' ");
        return preg_replace('/\s+/', ' ', $v);
    }

    private function mapImportRow(array $row, array $colIdx): array
    {
        $val = function (string $col) use ($row, $colIdx) {
            $i = $colIdx[$col] ?? null;
            if ($i === null || !array_key_exists($i, $row)) return null;
            $v = trim((string) $row[$i]);
            return $v === '' ? null : $v;
        };

        return [
            'name'                => $val('Name'),
            'email'               => $val('Email'),
            'mobile'              => $val('Mobile'),
            'experience_years'    => $val('Experience'),
            'qualification'       => $val('Qualification'),
            'current_salary_lpa'  => $val('Current Salary'),
            'expected_salary_lpa' => $val('Expected Salary'),
            'notice_period'       => $val('Notice Period'),
            'source'              => $val('Source'),
            'status'              => $val('Status'),
        ];
    }

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Recruitment module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
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
        $q->where('branch_id', $branchFilter);
    }

    private function applyRecruitmentScope($q, $user, ?int $branchFilter = null): void
    {
        $this->applyScope($q, $user, $branchFilter);
    }

    private function resolveRow(Request $request, int $id): Candidate
    {
        $q = Candidate::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function loadParentRecruitment(Request $request, int $recruitmentId): Recruitment
    {
        $q = Recruitment::query();
        $this->applyRecruitmentScope($q, $request->user());
        return $q->findOrFail($recruitmentId);
    }

    private function guardRecruitmentOpen(Recruitment $parent): void
    {
        $overdue = $parent->deadline && $parent->deadline->lt(today());
        $closed  = in_array($parent->status, ['Completed', 'Cancelled', 'Expired'], true);

        if ($closed || ($parent->status === 'In Progress' && $overdue)) {
            throw ValidationException::withMessages([
                'recruitment_id' => [
                    'This recruitment is closed or past its deadline — reopen it (extend the deadline) before adding candidates.',
                ],
            ]);
        }
    }

    private function guardHierarchicalAction($user, Candidate $row, string $verb): void
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
            abort(403, "You cannot {$verb} this candidate — created by a higher-privileged user.");
        }
    }

    private function guardDuplicate(array $data, int $recruitmentId, ?int $excludeId): void
    {
        $email = trim((string) ($data['email'] ?? ''));
        if ($email !== '') {
            $q = Candidate::query()
                ->where('recruitment_id', $recruitmentId)
                ->whereRaw('LOWER(email) = ?', [mb_strtolower($email)]);
            if ($excludeId !== null) $q->where('id', '!=', $excludeId);

            $existing = $q->first(['id', 'name']);
            if ($existing) {
                throw ValidationException::withMessages([
                    'email' => [sprintf(
                        'A candidate with this email is already linked to this recruitment (%s).',
                        $existing->name,
                    )],
                ]);
            }

            // The email must not already belong to an employee in this tenant —
            // that person is on the roster, not a candidate.
            $clientId = Recruitment::where('id', $recruitmentId)->value('client_id');
            if ($clientId) {
                $lc    = mb_strtolower($email);
                $taken = Employee::query()
                    ->where('client_id', $clientId)
                    ->where(function ($w) use ($lc) {
                        $w->whereRaw('LOWER(email) = ?', [$lc])
                          ->orWhereRaw('LOWER(official_email) = ?', [$lc]);
                    })
                    ->exists();
                if ($taken) {
                    throw ValidationException::withMessages([
                        'email' => ['This email is already taken.'],
                    ]);
                }
            }
        }

        $mobileDigits = preg_replace('/\D/', '', (string) ($data['mobile'] ?? ''));
        if ($mobileDigits !== '') {
            $q = Candidate::query()
                ->where('recruitment_id', $recruitmentId)
                ->whereRaw("regexp_replace(COALESCE(mobile, ''), '\\D', '', 'g') = ?", [$mobileDigits]);
            if ($excludeId !== null) $q->where('id', '!=', $excludeId);

            $existing = $q->first(['id', 'name']);
            if ($existing) {
                throw ValidationException::withMessages([
                    'mobile' => [sprintf(
                        'A candidate with this mobile number is already linked to this recruitment (%s).',
                        $existing->name,
                    )],
                ]);
            }
        }
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $isUpdate = $id !== null;

        return $request->validate([
            'recruitment_id'      => [$isUpdate ? 'sometimes' : 'required', 'integer', 'exists:recruitments,id'],

            'name'                => [$isUpdate ? 'sometimes' : 'required', 'string', 'max:150', "regex:/^[A-Za-z][A-Za-z .'\\-]*$/"],
            'email'               => self::EMAIL_RULES,
            'mobile'              => ['nullable', 'string', 'max:20', 'regex:/^\+?[\d\s\-]*$/', function ($attr, $val, $fail) {
                $digits = preg_replace('/\D/', '', (string) $val);
                if ($digits === '') return;
                $len = strlen($digits);
                if ($len < 7 || $len > 15) $fail('Mobile must be 7–15 digits.');
            }],
            'current_address'     => 'nullable|string|max:500',
            'qualification'       => ['nullable', 'string', 'max:191', 'regex:/^[A-Za-z0-9 .,\/&()+\-]*$/', 'regex:/[A-Za-z]/'],
            'experience_years'    => 'nullable|numeric|min:0|max:99.99',
            'mode_of_transport'   => ['nullable', Rule::in(self::TRANSPORT_MODES)],
            'distance_km'         => 'nullable|numeric|min:0|max:99999.99',

            'current_salary_lpa'  => 'nullable|numeric|min:0|max:9999.99',
            'expected_salary_lpa' => 'nullable|numeric|min:0|max:9999.99',
            'notice_period'       => ['nullable', Rule::in(self::NOTICE_PERIODS)],

            'source'              => ['nullable', Rule::in(self::SOURCES)],
            'referred_by_id'      => 'nullable|integer|exists:employees,id',
            'referred_by_name'    => 'nullable|string|max:150',

            'cv'                  => 'nullable|file|mimes:' . self::CV_MIME_TYPES . '|max:' . self::CV_MAX_KB,

            'status'              => ['nullable', Rule::in(self::STATUSES)],
            'rejection_reason'    => 'nullable|string|max:100',
            'status_notes'        => 'nullable|string',
        ]);
    }

    private function storeCv($file, $clientId, $recruitmentId): array
    {
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "candidates/{$clientSlug}/r{$recruitmentId}";

        $ext = strtolower($file->getClientOriginalExtension() ?: 'pdf');
        $filename = Str::random(16) . '.' . $ext;

        $path = $file->storeAs($folder, $filename, 'public');
        return [$path, $file->getClientOriginalName()];
    }

    private function serialize(Candidate $row): array
    {
        $arr = $row->toArray();
        $arr['recruitment_code']  = $row->recruitment?->code;
        $arr['recruitment_title'] = $row->recruitment?->job_title;
        $arr['experience_years'] = $row->experience_years !== null ? (float) $row->experience_years : 0;
        return $arr;
    }
}
