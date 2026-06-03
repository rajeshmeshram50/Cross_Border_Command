<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeDocName;
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
 *   - /clm/trade-docs/library  (rich library: TD-NNN + title, type, purpose, party, file)
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
        $rows = $user->client_id
            ? ClmTradeDocName::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function namesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        $data = $request->validate(['name' => 'required|string|max:255']);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('TDN-%03d', ClmTradeDocName::where('client_id', $user->client_id)->count() + 1);
            return ClmTradeDocName::create([
                'client_id'  => $user->client_id,
                'code'       => $code,
                'name'       => trim($data['name']),
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function namesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocName::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['name' => 'required|string|max:255']);
        $row->update(['name' => trim($data['name']), 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function namesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocName::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY TAB ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmTradeDocLibrary::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

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
            $code = sprintf('TD-%03d', ClmTradeDocLibrary::where('client_id', $user->client_id)->count() + 1);
            return ClmTradeDocLibrary::create($data + [
                'client_id'  => $user->client_id,
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
        $row  = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($id);

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
            'file_path' => 'nullable|string|max:500',
            'content'   => 'nullable|string',
            // Same Stage 2 page-shell config as libraryStore. Re-validated
            // independently so PUT-only callers (Stage 2 auto-save) can
            // patch just the header/footer without re-sending the form.
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($id);

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
    private const DOCX_MAX_KB = 20 * 1024;

    public function downloadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($id);

        // Prefer the user-uploaded DOCX (it's the source of truth after a
        // Word round-trip — preserves header/footer/styling we can't fully
        // reproduce from HTML alone).
        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $abs  = Storage::disk('public')->path($row->docx_path);
            $name = $row->docx_original_name ?: ($row->code ?: 'trade-document') . '.docx';
            return response()->download($abs, $name);
        }

        // Generate a fresh DOCX from the row's HTML content. Title goes on
        // top so the user opening the file recognises which trade doc it
        // belongs to before they start editing.
        $phpWord = new PhpWord();
        $phpWord->setDefaultFontName('Calibri');
        $phpWord->setDefaultFontSize(11);
        $section = $phpWord->addSection();

        $title = trim((string) $row->title) ?: ($row->name ?: 'Trade Document');
        $section->addTitle(htmlspecialchars($title, ENT_QUOTES), 1);
        $section->addTextBreak(1);

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        // PhpWord's HTML reader is finicky with the artefacts the browser's
        // execCommand toolbar leaves behind (<font> tags, span-based bold/
        // italic, alignment-via-div). Normalising them into the inline-tag
        // and CSS shapes PhpWord recognises makes Bold/Italic/Underline/
        // alignment/font-size/color all survive the round trip.
        $html = $this->normaliseEditorHtml($html);

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

    public function uploadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($id);

        $request->validate(['docx' => 'required|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB]);

        $file       = $request->file('docx');
        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder     = "trade_doc_library/{$clientSlug}/t{$row->id}";
        $ext        = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename   = Str::random(16) . '.' . $ext;
        $path       = $file->storeAs($folder, $filename, 'public');

        // Best-effort DOCX → HTML so the web editor reflects the upload.
        $html = $row->content;
        try {
            $html = $this->docxToHtml(Storage::disk('public')->path($path)) ?: $row->content;
        } catch (\Throwable $e) {
            // ignore — keep the previous HTML if parsing failed
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
    public function docxToHtmlPreview(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $request->validate(['docx' => 'required|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB]);

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
