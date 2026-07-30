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
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;

/**
 * Trade Documents master — covers both tabs:
 *
 *   - /clm/trade-docs/names    (lightweight catalog: TDN-NNN + name)
 *   - /clm/trade-docs/library  (rich library: TDL-NNN + title, type, purpose, party, file)
 *
 * Combined into a single controller because the two tabs render on the
 * same page and share validation patterns.
 */
class ClmTradeDocumentController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    /* ── NAMES TAB ── */

    public function namesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read: branch users see globals + client-level rows +
        // their own branch's rows; sibling branches stay hidden.
        $branchFilter = $request->integer('branch_id') ?: null;
        // Newest first — the latest-added type surfaces at the top of the list.
        $nameQuery = ClmTradeDocName::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($nameQuery, $user, $branchFilter);
        $rows = $nameQuery->get();

        /* Usage map: how many Library drafts reference each name (by name string,
         * case-insensitive — the library links to it by name, not an FK). Drives
         * the "can't edit an in-use type" guard on the client. Scope the count the
         * same way so a branch only counts library rows it can actually see. */
        $usageQuery = ClmTradeDocLibrary::query();
        MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
        $usage = $usageQuery
            ->selectRaw('LOWER(TRIM(name)) as t, COUNT(*) as c')
            ->groupBy(DB::raw('LOWER(TRIM(name))'))
            ->pluck('c', 't');
        $rows->each(function ($row) use ($usage) {
            $row->in_use = (int) ($usage[mb_strtolower(trim((string) $row->name))] ?? 0);
        });

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function namesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        $data = $request->validate(['name' => 'required|string|max:255']);
        $name = trim($data['name']);

        // Reject a duplicate type name (case-insensitive, whitespace-trimmed).
        // The dedupe + insert both run under the per-client lock so two
        // concurrent "Add" requests can't slip a duplicate past the check.
        // Scoped to the caller's visibility (globals + client-level + own
        // branch) so a sibling branch that can't see this row may still reuse
        // the name — consistent with the branch-scoped master rule.
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
                'branch_id'  => $user->branch_id,   // branch-owned; null for client-level users → shared
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
        // A branch user can VIEW shared client-level types but not manage them.
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        // Block edit while library drafts reference this name — the library links
        // to it by the name STRING, so renaming would orphan those drafts. Only
        // unused (fresh) types can be renamed. Mirrors namesDestroy's guard.
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

        // Reject a rename that collides with another visible type
        // (case-insensitive, excluding this row itself).
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

        // Block delete if this trade document name is in use. Library drafts
        // store the chosen name string in clm_trade_doc_library.name (the draft
        // form picks it from this catalog), so a name referenced by any draft
        // can't be removed without orphaning those drafts. Mirrors the Segment
        // master's "in use" guard — reassign/remove the drafts first.
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

    /* ── LIBRARY TAB ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read (globals + client-level + own branch; siblings hidden).
        $branchFilter = $request->integer('branch_id') ?: null;
        // Newest first — the latest-drafted document surfaces at the top.
        $libQuery = ClmTradeDocLibrary::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($libQuery, $user, $branchFilter);
        $rows = $libQuery->get();

        // Flag rows that have a signed (completed) signature request so the
        // frontend can lock Edit / Delete on them. Batch lookup avoids an
        // N+1 of per-row existence checks.
        $signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, ClmSignatureRequest::DOC_TRADE);
        $rows->each(fn ($r) => $r->setAttribute('is_signed', in_array((int) $r->id, $signedIds, true)));

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
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
            // Regulatory tier + segment scope — mirrors clm_agreement_library.
            // Segment is mandatory (at least one) — the frontend enforces the
            // same rule in validateStep1.
            'regulatory' => 'nullable|string|in:highly,less',
            'segment'    => 'required|string|max:500',
            'file_path' => 'nullable|string|max:500',
            'content'   => 'nullable|string',
            // Stage 2 page-shell config — same JSON shape as
            // hr_document_templates. Frontend layers it on top of
            // DEFAULT_HEADER / DEFAULT_FOOTER so missing keys stay safe.
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            // Library codes use the TDL- prefix (matching the create-popup
            // preview + the Trade Document Library list). Legacy TD- rows were
            // renamed to TDL- by migration so this sequence stays continuous.
            $code = $this->nextCode(ClmTradeDocLibrary::class, $user->client_id, $user->branch_id, 'TDL-');
            return ClmTradeDocLibrary::create($data + [
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,   // branch-owned; null for client-level users → shared
                'code'       => $code,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        // Branch users may view shared client-level trade documents but not edit them.
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        // Lock once the draft has been sent and signed. A trade document that
        // has come back signed via Zoho (a `completed` signature request) is
        // a legal record — editing it would silently diverge the master from
        // the copy the customer/consignee actually signed.
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
            // Same Stage 2 page-shell config as libraryStore. Re-validated
            // independently so PUT-only callers (Stage 2 auto-save) can
            // patch just the header/footer without re-sending the form.
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);
        $data['updated_by'] = $user->id;
        // If the editor content was edited and saved, the previously-uploaded
        // Word file no longer matches it. downloadDocx() prefers that stored
        // file, so it would keep serving the OLD document. Drop the docx_path
        // here (only when the content actually changed) so the download
        // regenerates from the edited HTML the user sees in the editor.
        if (array_key_exists('content', $data) && $data['content'] !== null && $data['content'] !== $row->content) {
            if ($row->docx_path) {
                try { Storage::disk('public')->delete($row->docx_path); } catch (\Throwable $e) { /* ignore */ }
            }
            $data['docx_path'] = null;
            $data['docx_original_name'] = null;
        }
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
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

        // Same lock as libraryUpdate — a signed trade document must stay on
        // record, so block the delete once a `completed` signature request
        // references this draft.
        if (ClmSignatureRequest::hasSignedDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_TRADE)) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document has already been signed by the customer/consignee and can no longer be deleted.',
            ], 422);
        }

        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── DOCX ROUND-TRIP ──
     * Mirrors the HRMS Document Template upload/download flow:
     *   GET  /clm/trade-doc-library/{id}/download    → streams the saved
     *        DOCX if one was uploaded, otherwise generates a fresh DOCX
     *        from the row's `content` HTML.
     *   POST /clm/trade-doc-library/{id}/upload-docx → stores the user's
     *        revised Word doc and refreshes `content` from its HTML so
     *        the web editor stays in sync.
     */
    /**
     * Allocate the next per-tenant code (TDN-NNN / TD-NNN). Uses
     * MAX(numeric suffix) + 1 rather than count()+1 so a deleted row in the
     * middle of the sequence doesn't make the next allocation reuse a code
     * that still exists — which throws a unique-constraint violation on save.
     * Caller must already hold the client row lock; the composite UNIQUE
     * (client_id, code) is the final guard.
     *
     * @param class-string<\Illuminate\Database\Eloquent\Model> $modelClass
     */
    private function nextCode(string $modelClass, int $clientId, ?int $branchId, string $prefix): string
    {
        // Branch-scoped so each branch restarts its own sequence from 001
        // (TD-001 / TDN-001) rather than continuing another branch's tally —
        // the trade-document master is branch-isolated via MasterVisibility.
        // A client-level creator ($branchId null) sequences the shared rows.
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

    /**
     * Max editor-HTML size we'll render synchronously to PDF/Word. dompdf and
     * PhpWord are near-quadratic on long content, so past this a single web
     * request exhausts memory/time and crashes with a 500. Above it we return a
     * clean "too large" message instead of letting the process die.
     */
    private const RENDER_MAX_CHARS = 1000000;   // 1,000,000 chars (~1 MB of HTML)

    public function downloadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        // DOCX generation (PhpWord HTML reader + Word2007 writer) is memory-
        // and time-heavy for table-rich documents. The web SAPI's default
        // limits can be lower than CLI, producing intermittent OOM 500s that
        // surface to the user as a generic "Download failed". Raise both
        // defensively for this request only.
        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        // Prefer the user-uploaded DOCX (it's the source of truth after a
        // Word round-trip — preserves header/footer/styling we can't fully
        // reproduce from HTML alone).
        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $name = $row->docx_original_name ?: ($row->code ?: 'trade-document') . '.docx';
            try {
                // Stream via the Storage disk — works for both local and cloud
                // disks (Azure Blob). response()->download() needs a real local
                // path and 500s with "The file does not exist" (leaking the path)
                // when the file lives on a cloud disk. On any read failure we fall
                // through and regenerate the DOCX from the row's content below.
                return Storage::disk('public')->download($row->docx_path, $name);
            } catch (\Throwable $e) {
                // fall through to regeneration
            }
        }

        // Guard oversized content: past this, PhpWord crashes the request (500).
        // Return a clean message the UI can show instead.
        if (($len = mb_strlen((string) $row->content)) > self::RENDER_MAX_CHARS) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document is too large to generate as a Word file — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters (~1 MB). Please shorten or split it.',
            ], 422);
        }

        // Generate a fresh DOCX from the row's HTML content. Title goes on
        // top so the user opening the file recognises which trade doc it
        // belongs to before they start editing.
        $phpWord = new PhpWord();
        $phpWord->setDefaultFontName('Calibri');
        $phpWord->setDefaultFontSize(11);
        $section = $phpWord->addSection();

        // Page-shell header + footer (logo, title, "Confidential", footer text,
        // page number) from the saved config so the DOCX matches the preview.
        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $client    = Client::find($row->client_id);
        $urlPath   = (isset($headerCfg['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerCfg['logo_url'], $lm)) ? $lm[1] : null;
        $logoAbs   = null;
        foreach (array_filter([$headerCfg['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) { $logoAbs = Storage::disk('public')->path($path); break; }
            } catch (\Throwable $e) { /* try next candidate */ }
        }
        $this->applyDocxHeaderFooter($section, $headerCfg, $footerCfg, $logoAbs);

        // NB: the document title is NOT prepended to the body — the page-shell
        // header already identifies the document, and prepending it here made
        // the title appear as a duplicate heading above the actual content in
        // the downloaded Word file. The DOCX now mirrors the editor exactly.

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        // PhpWord's HTML reader is finicky with the artefacts the browser's
        // execCommand toolbar leaves behind (<font> tags, span-based bold/
        // italic, alignment-via-div). Normalising them into the inline-tag
        // and CSS shapes PhpWord recognises makes Bold/Italic/Underline/
        // alignment/font-size/color all survive the round trip.
        $html = $this->normaliseEditorHtml($html);

        // The browser's contentEditable emits HTML, not XHTML — unclosed <p>,
        // bare <br>, unescaped &, etc. PhpWord parses with strict loadXML
        // ("Premature end of data in tag p"), which silently mangled the
        // tables into run-on text. Round-trip through the lenient HTML parser
        // first so PhpWord receives well-formed markup and the tables render
        // as real Word tables.
        $html = $this->toWellFormedHtml($html);

        // Wrap as a full document so PhpWord parses it as one — fragment
        // mode (false) sometimes drops block-level styling like text-align.
        $wrapped = '<!DOCTYPE html><html><body>' . $html . '</body></html>';

        try {
            Html::addHtml($section, $wrapped, true, false);
        } catch (\Throwable $e) {
            // Last-resort fallback so the download still produces something
            // even when the markup is too far gone for PhpWord.
            $section->addText(strip_tags($html));
        }

        $filename = ($row->code ?: 'trade-document') . '.docx';
        $tmp      = tempnam(sys_get_temp_dir(), 'tdocx_');
        IOFactory::createWriter($phpWord, 'Word2007')->save($tmp);

        return response()->download($tmp, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ])->deleteFileAfterSend(true);
    }

    /**
     * Download the trade document as a PDF rendered with its FULL page-shell
     * (branded header + body content + footer / page numbers), reusing the
     * same blade the Send-for-Signature flow renders. Placeholders are left
     * as-is (they auto-fill only at generation time, when a party is bound).
     */
    public function downloadPdf(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTradeDocLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        // Guard oversized content: past this, dompdf crashes the request (500).
        if (($len = mb_strlen((string) $row->content)) > self::RENDER_MAX_CHARS) {
            return response()->json([
                'status'  => false,
                'message' => 'This trade document is too large to generate as a PDF — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters (~1 MB). Please shorten or split it.',
            ], 422);
        }

        $client       = Client::find($row->client_id);
        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];

        // Resolve the header logo to a base64 data URL — dompdf can't fetch
        // /storage URLs at render time. Prefer the uploaded logo_path, then
        // the seeded logo_url (strip the /storage/ prefix), then client brand.
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
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

        return $pdf->download(($row->code ?: 'trade-document') . '.pdf');
    }

    /**
     * Walk candidate public-disk paths and return the first that resolves to
     * a file, base64-encoded for inline embedding in the PDF header. Returns
     * '' when none resolve so the blade falls back to a text-only header.
     */
    // toWellFormedHtml() now lives in the shared HandlesDocxHtmlRoundtrip
    // trait so the Agreement DOCX export gets the same table/structure repair.

    private function resolveLogoBase64(?string ...$candidates): string
    {
        $disk = Storage::disk('public');
        foreach ($candidates as $path) {
            if (!$path) continue;
            try {
                // RAW base64 only — the blade wraps it in
                // `data:image/png;base64,{{ ... }}` itself, so a data-URI
                // prefix here would double up and break the <img>.
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

        // Converting a Word file to editor HTML is memory/time-heavy for a big
        // file; without this the web SAPI runs out and the conversion silently
        // fails, leaving the editor blank. Raise both for this request only.
        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $file       = $request->file('docx');
        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder     = "trade_doc_library/{$clientSlug}/t{$row->id}";
        $ext        = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename   = Str::random(16) . '.' . $ext;
        $path       = $file->storeAs($folder, $filename, 'public');

        // Best-effort DOCX → HTML so the web editor reflects the upload.
        // Read the stored BYTES into a temp LOCAL file before converting: on a
        // cloud disk (Azure Blob, used on the server) Storage::path() returns an
        // unreadable path, so ZipArchive/PhpWord silently fail and the editor
        // goes blank. ->get() works on both local and cloud disks.
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

        // If nothing readable came out, DON'T silently keep the old content —
        // tell the user so they know the upload didn't take. The usual cause is
        // an older .doc (binary) file, which the converter can't read.
        if ($convFailed || trim(strip_tags((string) $html)) === '') {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => $ext === 'doc'
                    ? 'This looks like an older .doc file, which can\'t be read. Open it in Word and use "Save As → Word Document (.docx)", then upload the .docx.'
                    : 'We couldn\'t read any content from this Word file. Make sure it\'s a valid .docx that contains text, then try again.',
            ], 422);
        }

        // Reject a document whose text is over the render cap: it could never be
        // downloaded as PDF/Word afterwards. Drop the stored file and tell the user.
        if (($len = mb_strlen((string) $html)) > self::RENDER_MAX_CHARS) {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => 'This document is too large — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters (~1 MB). Please upload a smaller file or split it.',
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

    /**
     * Standalone DOCX → HTML conversion (no library row / no persistence).
     * Used by editors that aren't backed by a saved library record — e.g.
     * the CTC (Case-to-Case) agreement draft editor — so "Upload Doc" can
     * load a .docx straight into the contentEditable. The uploaded file is
     * read from its temp path and converted via the shared roundtrip trait.
     */
    /**
     * Validate an uploaded Word document. We deliberately do NOT use Laravel's
     * `mimes:doc,docx` rule: a .docx is a ZIP container, and php-fileinfo on
     * many servers reports it as `application/zip` (or `application/octet-stream`),
     * so `mimes:docx` rejects perfectly valid Word files with a 422 ("Import
     * failed / Could not convert this document"). Instead we check file + size +
     * the client extension. Genuinely broken/other content still fails safely
     * later, when PhpWord tries to read it (caught → friendly 422).
     */
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
            $html = $this->docxToHtml($request->file('docx')->getRealPath());
        } catch (\Throwable $e) {
            return response()->json(['status' => false, 'message' => 'Could not read this document.'], 422);
        }

        return response()->json(['status' => true, 'html' => $html ?: '']);
    }

    /**
     * Stage 2 page-shell logo upload. Stores the file under the tenant's
     * own folder and returns { path, url } in the exact shape
     * [[HeaderFooterPanel.tsx]] expects, so the same component works for
     * both HR document templates and Trade Document drafts.
     *
     * Mirrors HrDocumentTemplateController::uploadHeaderLogo. We don't
     * attach the path to a specific library row here — that linkage
     * happens later when the user saves the form and the path lands in
     * the row's header_config JSON. This keeps the endpoint usable for
     * brand-new (not-yet-saved) drafts too.
     */
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

    /* ── PARTY FILTER ──
     * Returns library rows whose `party` CSV mentions the given party key.
     * Supports three logical buckets used by the customer/consignee/vendor
     * forms:
     *   buyer / customer → matches "Buyer"
     *   consignee        → matches "Consignee"
     *   supplier         → matches ANY "Supplier-*" sub-type (Material,
     *                       Logistic, Tech, Advisory, Strategic Risk).
     * Anything else falls through to a literal substring match so a caller
     * can request a specific Supplier-* sub-type if needed.
     */
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
            $q->where('party', 'like', '%Supplier-%');
        } else {
            $q->where('party', 'like', '%' . $party . '%');
        }

        $rows = $q->orderBy('id')->get();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }
}
