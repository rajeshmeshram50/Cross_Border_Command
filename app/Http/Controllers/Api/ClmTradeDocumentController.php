<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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

    /**
     * Normalise the HTML the contentEditable toolbar produces so PhpWord's
     * Html reader sees shapes it can convert:
     *   - <font color="X"> / <font face="X"> → <span style="color:X / font-family:X">
     *   - <font size="N">  (1..7)             → <span style="font-size:Xpt">
     *   - <span style="font-weight:bold">    → <b>…</b>
     *   - <span style="font-style:italic">   → <i>…</i>
     *   - <span style="text-decoration:underline"> → <u>…</u>
     *   - <div style="text-align:X">         → <p style="text-align:X">
     */
    private function normaliseEditorHtml(string $html): string
    {
        // <font size="N"> → <span style="font-size:Xpt">. execCommand
        // produces 1..7; map to roughly Word equivalents.
        $sizeMap = [1 => 8, 2 => 10, 3 => 12, 4 => 14, 5 => 18, 6 => 24, 7 => 36];
        $html = preg_replace_callback(
            '/<font([^>]*)>/i',
            function ($m) use ($sizeMap) {
                $attrs  = $m[1];
                $styles = [];
                if (preg_match('/\bcolor\s*=\s*["\']?([^"\'\s>]+)/i', $attrs, $c)) {
                    $styles[] = 'color:' . trim($c[1]);
                }
                if (preg_match('/\bface\s*=\s*["\']?([^"\'>]+)/i', $attrs, $f)) {
                    $styles[] = 'font-family:' . trim($f[1]);
                }
                if (preg_match('/\bsize\s*=\s*["\']?([1-7])/i', $attrs, $s)) {
                    $pt = $sizeMap[(int) $s[1]] ?? 12;
                    $styles[] = "font-size:{$pt}pt";
                }
                return $styles ? '<span style="' . implode(';', $styles) . '">' : '<span>';
            },
            $html
        );
        $html = preg_replace('/<\/font>/i', '</span>', (string) $html);

        // span-based bold/italic/underline → semantic tags (PhpWord is
        // happier with these than with parsing arbitrary inline styles).
        $html = preg_replace_callback(
            '/<span\s+style\s*=\s*"([^"]*)"\s*>(.*?)<\/span>/is',
            function ($m) {
                $style = $m[1];
                $inner = $m[2];
                $open  = '';
                $close = '';
                if (preg_match('/font-weight\s*:\s*(bold|[6-9]\d{2})/i', $style))        { $open .= '<b>';  $close = '</b>'  . $close; }
                if (preg_match('/font-style\s*:\s*italic/i',              $style))        { $open .= '<i>';  $close = '</i>'  . $close; }
                if (preg_match('/text-decoration\s*:[^;"]*underline/i',   $style))        { $open .= '<u>';  $close = '</u>'  . $close; }
                // Keep the span (for color / size) if any other style survives,
                // otherwise drop the wrapper entirely.
                $residual = preg_replace('/(font-weight|font-style|text-decoration)\s*:[^;]+;?/i', '', $style);
                $residual = trim((string) $residual, " ;\t\n");
                $spanOpen = $residual !== '' ? '<span style="' . $residual . '">' : '';
                $spanClose = $residual !== '' ? '</span>'                          : '';
                return $open . $spanOpen . $inner . $spanClose . $close;
            },
            (string) $html
        );

        // <div style="text-align:…">…</div> → <p style="text-align:…">…</p>
        // so PhpWord treats it as a paragraph (alignment only applies at
        // block level in the DOCX schema).
        $html = preg_replace(
            '/<div(\s+[^>]*text-align\s*:[^>]*)>(.*?)<\/div>/is',
            '<p$1>$2</p>',
            (string) $html
        );

        return (string) $html;
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

    /**
     * Lightweight DOCX → HTML — walks PhpWord's parsed model and stitches
     * <p>/<b>/<i>/<u> tags. Mirrors the HRMS template helper so a Word
     * round-trip preserves text + basic formatting + paragraph breaks.
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
