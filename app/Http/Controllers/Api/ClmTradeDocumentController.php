<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Models\Client;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeDocName;
use App\Support\MasterVisibility;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;

class ClmTradeDocumentController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    public function namesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        $branchFilter = $request->integer('branch_id') ?: null;
        $nameQuery = ClmTradeDocName::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($nameQuery, $user, $branchFilter);

        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $nameQuery->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)->orWhere('code', 'ilike', $like);
            });
        }

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = $perPage ? (clone $nameQuery)->count() : null;

        $rows = $perPage ? $nameQuery->forPage($page, $perPage)->get() : $nameQuery->get();

        $usageQuery = ClmTradeDocLibrary::query();
        MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
        $usage = $usageQuery
            ->selectRaw('LOWER(TRIM(name)) as t, COUNT(*) as c')
            ->groupBy(DB::raw('LOWER(TRIM(name))'))
            ->pluck('c', 't');
        $rows->each(function ($row) use ($usage) {
            $row->in_use = (int) ($usage[mb_strtolower(trim((string) $row->name))] ?? 0);
        });

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
        ]);
    }

    public function namesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        $data = $request->validate(['name' => 'required|string|max:255']);
        $name = trim($data['name']);

        $result = DB::transaction(function () use ($user, $name) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();

            $dupe = ClmTradeDocName::query()
                ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)]);
            MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
            if ($dupe->exists()) {
                return ['dupe' => true];
            }

            $code = $this->nextCode(ClmTradeDocName::class, $user->client_id, $user->branch_id, 'TDN-');
            return ['row' => ClmTradeDocName::create([
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,
                'code'       => $code,
                'name'       => $name,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ])];
        });

        if (!empty($result['dupe'])) {
            return response()->json([
                'status'  => false,
                'message' => "A trade document type named \"{$name}\" already exists. Pick a different name.",
            ], 422);
        }
        return response()->json(['status' => true, 'data' => $result['row']], 201);
    }

    public function namesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocName::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $usedBy = ClmTradeDocLibrary::where('client_id', $user->client_id)
            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim((string) $row->name))])
            ->count();
        if ($usedBy > 0) {
            $noun = $usedBy === 1 ? 'draft' : 'drafts';
            return response()->json([
                'status'  => false,
                'message' => "This trade document type is used by {$usedBy} {$noun} in the Trade Document Library, so it can't be edited. Remove or reassign " . ($usedBy === 1 ? 'it' : 'them') . " first.",
            ], 409);
        }

        $data = $request->validate(['name' => 'required|string|max:255']);
        $name = trim($data['name']);

        $dupe = ClmTradeDocName::query()
            ->whereKeyNot($row->id)
            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
        if ($dupe->exists()) {
            return response()->json([
                'status'  => false,
                'message' => "Another trade document type named \"{$name}\" already exists. Pick a different name.",
            ], 422);
        }

        $row->update(['name' => $name, 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function namesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocName::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $usedBy = ClmTradeDocLibrary::where('client_id', $user->client_id)
            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim((string) $row->name))])
            ->count();
        if ($usedBy > 0) {
            $noun = $usedBy === 1 ? 'draft' : 'drafts';
            return response()->json([
                'status'  => false,
                'message' => "This trade document is used by {$usedBy} {$noun} in the Trade Document Library. Remove or reassign " . ($usedBy === 1 ? 'it' : 'them') . " before deleting.",
            ], 409);
        }

        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        $branchFilter = $request->integer('branch_id') ?: null;
        $libQuery = ClmTradeDocLibrary::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($libQuery, $user, $branchFilter);

        if ($request->input('view') === 'list') {
            $libQuery->select([
                'id', 'client_id', 'branch_id', 'code', 'name', 'title',
                'doc_type', 'purpose', 'party', 'regulatory', 'segment',
                'file_path', 'docx_path', 'docx_original_name',
                'status', 'created_at', 'updated_at',
            ]);
        }

        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $libQuery->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)
                  ->orWhere('code', 'ilike', $like)
                  ->orWhere('title', 'ilike', $like)
                  ->orWhere('doc_type', 'ilike', $like);
            });
        }

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = $perPage ? (clone $libQuery)->count() : null;

        $rows = $perPage ? $libQuery->forPage($page, $perPage)->get() : $libQuery->get();

        $signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, ClmSignatureRequest::DOC_TRADE);
        $rows->each(fn ($r) => $r->setAttribute('is_signed', in_array((int) $r->id, $signedIds, true)));

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
        ]);
    }

    public function libraryShow(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $query = ClmTradeDocLibrary::query();
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
        $row = $query->findOrFail((int) $id);

        $signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, ClmSignatureRequest::DOC_TRADE);
        $row->setAttribute('is_signed', in_array((int) $row->id, $signedIds, true));

        return response()->json(['status' => true, 'data' => $row]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'name'      => 'required|string|max:255',
            'title'     => 'required|string|max:255',
            'doc_type'  => 'required|string|max:64',
            'purpose'   => 'required|string|max:500',
            'party'     => 'required|string|max:255',
            'regulatory' => 'nullable|string|in:highly,less',
            'segment'    => 'required|string|max:500',
            'file_path' => 'nullable|string|max:500',
            'content'   => 'nullable|string',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        if ($over = $this->contentOverLimit($data)) return $over;

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode(ClmTradeDocLibrary::class, $user->client_id, $user->branch_id, 'TDL-');
            return ClmTradeDocLibrary::create($data + [
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,
                'code'       => $code,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row->makeHidden('content')], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        if (ClmSignatureRequest::hasSignedDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_TRADE)) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document has already been signed by the customer/consignee and can no longer be edited.',
            ], 422);
        }

        $data = $request->validate([
            'name'      => 'sometimes|required|string|max:255',
            'title'     => 'sometimes|required|string|max:255',
            'doc_type'  => 'sometimes|required|string|max:64',
            'purpose'   => 'sometimes|required|string|max:500',
            'party'     => 'sometimes|required|string|max:255',
            'regulatory' => 'sometimes|nullable|string|in:highly,less',
            'segment'    => 'sometimes|required|string|max:500',
            'file_path' => 'nullable|string|max:500',
            'content'   => 'nullable|string',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        if ($over = $this->contentOverLimit($data, $this->htmlTextLength($row->content))) return $over;

        $isBlank = fn ($html) => trim(html_entity_decode(strip_tags((string) $html)), " \t\n\r\0\x0B\xC2\xA0") === '';
        if (array_key_exists('content', $data) && $isBlank($data['content']) && !$isBlank($row->content)
            && !$request->boolean('clear_content')) {
            return response()->json([
                'status'  => false,
                'message' => 'This save would erase the whole document content, so it was not saved. Reopen the document and try again.',
                'errors'  => ['content' => ['The document content cannot be emptied.']],
            ], 422);
        }

        $data['updated_by'] = $user->id;
        if (array_key_exists('content', $data) && $data['content'] !== null && $data['content'] !== $row->content) {
            if ($row->docx_path) {
                try { Storage::disk('public')->delete($row->docx_path); } catch (\Throwable $e) { }
            }
            $data['docx_path'] = null;
            $data['docx_original_name'] = null;
        }
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()->makeHidden('content')]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        if (ClmSignatureRequest::hasReferencingDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_TRADE)) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document is in use (used in a lead / sent for signature) and cannot be deleted.',
            ], 422);
        }

        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(string $modelClass, int $clientId, ?int $branchId, string $prefix): string
    {
        $query = $modelClass::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        $re    = '/^' . preg_quote($prefix, '/') . '(\d+)$/';
        foreach ($codes as $c) {
            if (preg_match($re, (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('%s%03d', $prefix, $n);
        } while (isset($taken[$code]));
        return $code;
    }

    private const DOCX_MAX_KB = 20 * 1024;

    private const RENDER_MAX_CHARS = 1000000;

    private function contentOverLimit(array $data, int $storedLen = 0): ?\Illuminate\Http\JsonResponse
    {
        if (!array_key_exists('content', $data) || $data['content'] === null) return null;

        $len = $this->htmlTextLength($data['content']);
        if ($len <= $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) return null;
        if ($len <= $storedLen) return null;

        return response()->json([
            'status'  => false,
            'message' => 'This document is ' . number_format($len) . ' characters. The limit is '
                . number_format(self::RENDER_MAX_CHARS) . ' characters — past it the PDF '
                . 'and Word exports stop working. Shorten it, or split it into smaller documents.',
            'errors'  => ['content' => ['Over the ' . number_format(self::RENDER_MAX_CHARS) . '-character limit.']],
        ], 422);
    }

    public function downloadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $sizeRequested = $request->filled('size') || $request->filled('orient');
        if (!$sizeRequested && $row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $name = $row->docx_original_name ?: ($row->code ?: 'trade-document') . '.docx';
            try {
                return Storage::disk('public')->download($row->docx_path, $name);
            } catch (\Throwable $e) {
            }
        }

        if (($len = $this->htmlTextLength($row->content)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document is too large to generate as a Word file — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters of text. Please shorten or split it.',
            ], 422);
        }

        $phpWord = new PhpWord();
        $phpWord->setDefaultFontName('Arial');
        $phpWord->setDefaultFontSize(11);
        $section = $phpWord->addSection($this->docxPageStyle($request));

        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $client    = Client::find($row->client_id);
        $urlPath = null;
        $rawLogoUrl = (string) ($headerCfg['logo_url'] ?? '');
        if ($rawLogoUrl !== '') {
            if (preg_match('#/storage/(.+)$#', $rawLogoUrl, $lm)) {
                $urlPath = $lm[1];
            } elseif (preg_match('#^https?://[^/]+/[^/]+/(.+)$#', $rawLogoUrl, $lm)) {
                $urlPath = $lm[1];
            }
        }
        $logoAbs   = null;
        foreach (array_filter([$headerCfg['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            $logoAbs = self::docxLogoFile($path);
            if ($logoAbs) break;
        }
        $this->applyDocxHeaderFooter($section, $headerCfg, $footerCfg, $logoAbs);

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        $html = $this->normaliseEditorHtml($html);

        $html = $this->ensureTableColWidths($html);
        $html = $this->toWellFormedHtml($html);

        $this->addHtmlResilient($section, $html);

        $filename = ($row->code ?: 'trade-document') . '.docx';
        $tmp      = tempnam(sys_get_temp_dir(), 'tdocx_');
        IOFactory::createWriter($phpWord, 'Word2007')->save($tmp);

        $this->sanitizeDocxXml($tmp, $this->docxUsableWidthTwips($request));

        return response()->download($tmp, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ])->deleteFileAfterSend(true);
    }

    public function downloadPdf(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        if (($len = $this->htmlTextLength($row->content)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document is too large to generate as a PDF — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters of text. Please shorten or split it.',
            ], 422);
        }

        $client       = Client::find($row->client_id);
        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];

        $logoUrlPath = null;
        $lu = $headerConfig['logo_url'] ?? null;
        if ($lu && str_contains($lu, '/storage/')) {
            $logoUrlPath = ltrim(substr($lu, strpos($lu, '/storage/') + strlen('/storage/')), '/');
        }
        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $logoUrlPath,
            $client?->logo,
        );

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        $pdf = Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $row,
            'modelName'        => 'Trade Document',
            'processedHtml'    => $html,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => (string) ($row->code ?? ''),
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper(
            strtolower((string) $request->query('size', 'a4')) === 'a3' ? 'a3' : 'a4',
            strtolower((string) $request->query('orient', 'portrait')) === 'landscape' ? 'landscape' : 'portrait'
        )->setOption('isPhpEnabled', true);

        return $pdf->download(($row->code ?: 'trade-document') . '.pdf');
    }

    public function previewLive(Request $request)
    {
        @ini_set('memory_limit', '1024M');
        @set_time_limit(120);

        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'id'            => 'nullable|integer',
            'content'       => 'nullable|string',
            'page_config'   => 'nullable|array',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        $row = null;
        if (!empty($data['id'])) {
            $row = ClmTradeDocLibrary::where('client_id', $user->client_id)->find($data['id']);
        }

        $html = trim((string) ($data['content'] ?? ($row->content ?? '')));
        if ($html === '') {
            $html = '<p><em>Nothing to preview yet — start typing in the editor.</em></p>';
        }

        if (($len = $this->htmlTextLength($html)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            return response()->json([
                'status'  => false,
                'message' => 'This draft is too large to preview — '
                    . number_format($len) . ' characters against a limit of '
                    . number_format(self::RENDER_MAX_CHARS) . '.',
            ], 422);
        }

        $processedHtml = preg_replace('/\{\{[^{}]*\}\}/', '', $html);

        $client       = Client::find($user->client_id);
        $headerConfig = $data['header_config'] ?? (is_array($row->header_config ?? null) ? $row->header_config : []);
        $footerConfig = $data['footer_config'] ?? (is_array($row->footer_config ?? null) ? $row->footer_config : []);
        $pageConfig   = $data['page_config']   ?? (is_array($row->page_config   ?? null) ? $row->page_config   : []);

        $logoUrlPath = null;
        $lu = $headerConfig['logo_url'] ?? null;
        if ($lu && str_contains($lu, '/storage/')) {
            $logoUrlPath = ltrim(substr($lu, strpos($lu, '/storage/') + strlen('/storage/')), '/');
        }
        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $logoUrlPath,
            $client?->logo,
        );

        $document = $row ?: new ClmTradeDocLibrary(['title' => 'Trade document (draft preview)']);

        $cacheKey = 'clm:tdpreview:' . sha1(implode('|', [
            (int) $user->client_id,
            (string) ($row->code ?? 'DRAFT'),
            (string) ($document->title ?? ''),
            md5($processedHtml),
            md5(json_encode($headerConfig)),
            md5(json_encode($footerConfig)),
            md5(json_encode($pageConfig)),
            md5((string) $headerLogoBase64),
            now()->format('Y-m-d'),
        ]));
        $headers = [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="trade-document-preview.pdf"',
        ];
        try {
            if ($hit = Cache::get($cacheKey)) {
                return response(base64_decode($hit), 200, $headers);
            }
        } catch (\Throwable $e) {
        }

        $pdf = Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $document,
            'party'            => null,
            'modelName'        => 'Trade Document',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => (string) ($row->code ?? 'DRAFT'),
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'pageConfig'       => $pageConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

        $bytes = $pdf->output();
        if (strlen($bytes) <= 5 * 1024 * 1024) {
            try {
                Cache::put($cacheKey, base64_encode($bytes), now()->addMinutes(10));
            } catch (\Throwable $e) {
            }
        }

        return response($bytes, 200, $headers);
    }

    private function resolveLogoBase64(?string ...$candidates): string
    {
        $disk = Storage::disk('public');
        foreach ($candidates as $path) {
            if (!$path) continue;
            try {
                if ($disk->exists($path)) return base64_encode($disk->get($path));
            } catch (\Throwable $e) { continue; }
        }
        return '';
    }

    public function uploadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $this->validateDocxUpload($request);

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $file       = $request->file('docx');
        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder     = "trade_doc_library/{$clientSlug}/t{$row->id}";
        $ext        = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename   = Str::random(16) . '.' . $ext;
        $path       = $file->storeAs($folder, $filename, 'public');

        $html = null;
        $convFailed = false;
        $tmpDocx = tempnam(sys_get_temp_dir(), 'docxconv_') . '.docx';
        try {
            file_put_contents($tmpDocx, Storage::disk('public')->get($path));
            $html = $this->docxToHtml($tmpDocx);
        } catch (\Throwable $e) {
            $convFailed = true;
        } finally {
            @unlink($tmpDocx);
        }

        if ($convFailed || trim(strip_tags((string) $html)) === '') {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => $ext === 'doc'
                    ? 'This looks like an older .doc file, which can\'t be read. Open it in Word and use "Save As → Word Document (.docx)", then upload the .docx.'
                    : 'We couldn\'t read any content from this Word file. Make sure it\'s a valid .docx that contains text, then try again.',
            ], 422);
        }

        if (($len = $this->htmlTextLength($html)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => 'This document is too large — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters of text. Please upload a smaller file or split it.',
            ], 422);
        }

        $row->update([
            'docx_path'          => $path,
            'docx_original_name' => $file->getClientOriginalName(),
            'content'            => $html,
            'updated_by'         => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    private function validateDocxUpload(Request $request): void
    {
        $request->validate(['docx' => ['required', 'file', 'max:' . self::DOCX_MAX_KB]]);
        $ext = strtolower((string) $request->file('docx')->getClientOriginalExtension());
        if (!in_array($ext, ['doc', 'docx'], true)) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'docx' => 'The file must be a Word document (.doc or .docx).',
            ]);
        }
    }

    public function docxToHtmlPreview(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $this->validateDocxUpload($request);

        try {
            $abs  = $request->file('docx')->getRealPath();
            $html = $this->docxToHtml($abs);
            if (($len = $this->htmlTextLength($html)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
                return response()->json(['status' => false, 'message' => 'This document converts to '
                    . number_format($len) . ' characters. The limit is ' . number_format(self::RENDER_MAX_CHARS)
                    . ' characters of text — past it the PDF and Word exports stop working. '
                    . 'Please shorten it, or split it into smaller documents.'], 422);
            }
        } catch (\Throwable $e) {
            return response()->json(['status' => false, 'message' => 'Could not read this document.'], 422);
        }

        return response()->json(['status' => true, 'html' => $html ?: '']);
    }

    public function uploadHeaderLogo(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $request->validate(['logo' => 'required|file|mimes:png,jpg,jpeg,svg,webp|max:5120']);

        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder = "trade_doc_library/{$clientSlug}/logos";
        $file   = $request->file('logo');
        $ext    = strtolower($file->getClientOriginalExtension() ?: 'png');
        $filename = Str::random(16) . '.' . $ext;
        $path = $file->storeAs($folder, $filename, 'public');

        return response()->json([
            'path' => $path,
            'url'  => file_url($path),
        ]);
    }

    public function libraryForParty(Request $request, $party)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }

        $q = ClmTradeDocLibrary::where('client_id', $user->client_id);
        $key = strtolower(trim((string) $party));

        if ($key === 'buyer' || $key === 'customer') {
            $q->where('party', 'like', '%Buyer%');
        } elseif ($key === 'consignee') {
            $q->where('party', 'like', '%Consignee%');
        } elseif ($key === 'supplier') {
            $token = \App\Support\SupplierPartyToken::forVendorTypeId(
                $request->integer('vendor_type_id') ?: null,
                (int) $user->client_id,
            ) ?: \App\Support\SupplierPartyToken::forVendorTypeName($request->query('vendor_type'));

            if ($token) {
                \App\Support\SupplierPartyToken::applyToQuery($q, $token);
            } else {
                $q->where('party', 'like', '%Supplier-%');
            }
        } else {
            $q->where('party', 'like', '%' . $party . '%');
        }

        if ($request->input('view') === 'list') {
            $q->select([
                'id', 'client_id', 'branch_id', 'code', 'name', 'title',
                'doc_type', 'purpose', 'party', 'regulatory', 'segment',
                'file_path', 'docx_path', 'docx_original_name',
                'status', 'created_at', 'updated_at',
            ]);
        }

        $rows = $q->orderBy('id')->get();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }
}
