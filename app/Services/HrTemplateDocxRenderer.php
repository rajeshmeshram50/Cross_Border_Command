<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Settings;
use PhpOffice\PhpWord\Shared\Html;
use PhpOffice\PhpWord\Style\Table;
use PhpOffice\PhpWord\SimpleType\TblWidth;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Builds a DOCX from an HrDocumentTemplate-shaped row + streams it back as
 * a download response. Shared by the template editor's "Download DOCX"
 * button and the generated-document download in the Generate Document
 * wizard, so both produce identical output: header strip (logo + title +
 * subtitle), the body HTML, and footer strip (text + page number).
 *
 * Why a service: the renderer needs the full template's header_config /
 * footer_config to lay out the page, but the generated-document download
 * needs to substitute the BODY (rendered_html, with custom values already
 * filled in). The shared method takes a HrDocumentTemplate — for generated
 * docs, the caller passes a non-persisted clone with content_html swapped
 * for the resolved HTML. Same renderer, two callers, zero duplication.
 */
class HrTemplateDocxRenderer
{
    /**
     * Build the DOCX and return the absolute path to the generated tmp file.
     * Callers that need to attach the file to email (and unlink afterwards)
     * use this; callers that just want a download response use `render`.
     *
     * The row is duck-typed (no explicit class hint) so this works equally
     * for HrDocumentTemplate, HrGeneratedDocument clones, and the signature
     * runtime's HrDocumentSignature snapshots — they all carry the same
     * `header_config` / `footer_config` / `content_html` triple.
     */
    /** A4 width (11906 twips) minus PhpWord's default 1440-twip side margins. */
    private const HEADER_WIDTH_TWIPS = 11906 - (2 * 1440);

    public static function buildPath($row): string
    {
        /* PhpWord leaves output escaping OFF by default, so a company name
         * containing & < > was written raw into header1.xml and produced a
         * document Word refuses to open ("unreadable content").
         *
         * Settings is GLOBAL STATIC state, and php-fpm reuses a worker across
         * requests -- so leaving this flipped on would silently change every
         * later PhpWord export in the same process. HandlesDocxHtmlRoundtrip
         * (the CLM agreement / trade-doc writer) escapes its own header text
         * with htmlspecialchars(), and would then double-escape into a literal
         * "&amp;amp;". The previous value is restored in the finally below so
         * this renderer's requirement cannot leak out of it. */
        $prevEscaping = Settings::isOutputEscapingEnabled();
        Settings::setOutputEscapingEnabled(true);
        try {
            return self::build($row);
        } finally {
            Settings::setOutputEscapingEnabled($prevEscaping);
        }
    }

    /** The actual builder; wrapped by buildPath() so the global PhpWord
     *  escaping setting is always restored, on the error path too. */
    private static function build($row): string
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

        self::writeHeader($section, is_array($row->header_config) ? $row->header_config : []);
        self::writeFooter($section, is_array($row->footer_config) ? $row->footer_config : []);

        $html = (string) ($row->content_html ?: '<p>(empty template)</p>');
        // PhpWord's Html::addHtml uses loadXML (not loadHTML) so the body
        // must be valid XML. Bare void tags from rich-text editors (<br>,
        // <hr>, <img ...>) abort parsing silently and drop everything that
        // follows. Self-close them before handing off.
        $html = preg_replace('/<br\s*>/i',  '<br/>',  $html);
        $html = preg_replace('/<hr\s*>/i',  '<hr/>',  $html);
        $html = preg_replace('/<img([^>]*[^\/])>/i', '<img$1/>', $html);
        $html = self::pageBreaksToWord($html);
        $html = self::localiseImageSources($html);
        $wrapped = '<html><body>' . $html . '</body></html>';

        /* Parse into a THROWAWAY document first, and only re-run it on the real
         * section once it survives.
         *
         * The old shape was `try { addHtml($section) } catch { addText(...) }`,
         * and addHtml writes as it walks: a failure part-way left the paragraphs
         * it had already added AND then appended a flattened dump of the entire
         * body, so the reader got the text twice — the second time as one
         * run-on line with the raw {{tokens}} in it. Nothing can un-write those
         * paragraphs, so the check has to happen somewhere disposable. */
        $parsedCleanly = true;
        try {
            $probe = new PhpWord();
            Html::addHtml($probe->addSection(), $wrapped, false, false);
        } catch (\Throwable $e) {
            $parsedCleanly = false;
            Log::warning('DOCX body HTML did not parse; falling back to plain text', [
                'error' => $e->getMessage(),
            ]);
        }

        if ($parsedCleanly) {
            Html::addHtml($section, $wrapped, false, false);
        } else {
            $section->addText(strip_tags($html));
        }

        $writer = IOFactory::createWriter($phpWord, 'Word2007');
        $tmp = tempnam(sys_get_temp_dir(), 'tpl_') . '.docx';
        $writer->save($tmp);
        return $tmp;
    }

    /**
     * Turn the editor's page break into one Word understands.
     *
     * The editor emits `<div class="page-break" data-page-break="true"></div>`,
     * which the PDF stylesheet turns into `page-break-after: always`. PhpWord's
     * HTML reader has no `div` in its node map at all, so that element (and any
     * class-based CSS) is skipped outright — the break silently vanished from
     * the Word copy while the PDF broke correctly. PhpWord DOES honour
     * `page-break-after: always` as an INLINE style on a <p>, which it turns
     * into a real Word page break, so rewrite the div into exactly that.
     */
    private static function pageBreaksToWord(string $html): string
    {
        return preg_replace(
            '#<div[^>]*(?:class="[^"]*\bpage-break\b[^"]*"|data-page-break)[^>]*>\s*</div>#i',
            '<p style="page-break-after: always"></p>',
            $html
        ) ?? $html;
    }
    /** Streams the freshly-built DOCX as a download response. */
    public static function render($row, string $filename): BinaryFileResponse
    {
        $tmp = self::buildPath($row);
        return response()->download($tmp, $filename)->deleteFileAfterSend(true);
    }

    /**
     * Resolve a header logo into a path PhpWord can embed. PhpWord only accepts
     * JPG/PNG/GIF/BMP, so an uploaded SVG/WEBP logo (fine in the web preview)
     * silently fails addImage(). Convert WEBP via GD and SVG via Imagick (when
     * available) to a temp PNG. Returns null when missing/unconvertible.
     */
    /**
     * Guaranteed LOCAL path for a 'public'-disk file. On the server the public
     * disk is Azure Blob (no local path), so stream the bytes into a temp file
     * native libraries can open. On local disks return ->path() directly.
     */
    private static function localFile(?string $path): ?string
    {
        if (!$path) return null;

        /* Find the file on whichever disk it was actually written to.
         *
         * This hardcoded Storage::disk('public'), while FILESYSTEM_DISK is
         * 'azure' in production. A logo stored in Azure Blob failed the
         * exists() check on the public disk, localFile() returned null, and the
         * header logo was silently dropped from the generated DOCX — the
         * reported "company logo missing in downloaded doc". The format
         * conversion below never even ran; it failed one line earlier, which is
         * why a plain PNG went missing too.
         *
         * The configured disk is tried first, then 'public' for rows written
         * before the move to Azure. Note the exists() check was also what made
         * the remote-adapter fallback further down unreachable. */
        $disk = null;
        foreach (array_unique([(string) config('filesystems.default'), 'public']) as $name) {
            try {
                $candidate = Storage::disk($name);
                if ($candidate->exists($path)) { $disk = $candidate; break; }
            } catch (Throwable $e) { /* disk not configured — try the next */ }
        }
        if (!$disk) return null;

        try {
            $local = $disk->path($path);
            if (is_string($local) && is_file($local)) return $local;
        } catch (\Throwable $e) { /* non-local adapter → copy below */ }
        try {
            $bytes = $disk->get($path);
            if ($bytes === null) return null;
            $ext = pathinfo($path, PATHINFO_EXTENSION) ?: 'tmp';
            $tmp = tempnam(sys_get_temp_dir(), 'cbc_') . '.' . $ext;
            file_put_contents($tmp, $bytes);
            return $tmp;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Rewrite every <img src> in the body to an absolute LOCAL file path.
     *
     * The resolved HTML carries `/storage/...` URLs — right for the browser
     * preview and for DomPDF (which inlines them), but PhpWord reads the src as
     * a filesystem path and a leading-slash URL resolves to nothing. It then
     * threw mid-parse, and the catch below wrote the entire body a second time
     * as flattened text. An image we cannot resolve is DROPPED rather than left
     * to break the document.
     */
    private static function localiseImageSources(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*?)/?>#i',
            function (array $m) {
                [$full, $pre, $q, $src, $post] = $m;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;

                // /storage/x → disk-relative x; a bare relative path is already one.
                $path = parse_url($src, PHP_URL_PATH) ?: $src;
                $path = ltrim(str_replace('\\', '/', $path), '/');
                if (preg_match('#(?:^|/)storage/(.+)$#', $path, $sm)) $path = $sm[1];
                elseif (str_starts_with($src, 'http')) return '';   // remote — not ours to embed

                $abs = self::resolveDocxLogo($path);
                if (!$abs) return '';   // unreadable / unsupported format
                return '<img' . $pre . 'src=' . $q . $abs . $q . $post . '/>';
            },
            $html,
        ) ?? $html;
    }

    /**
     * Last resort: fetch the logo over HTTP into a temp file PhpWord can embed.
     *
     * Restricted to the app's own origin and the configured Azure Blob account.
     * The value comes from a tenant-editable header config, so an unrestricted
     * fetch here would let a tenant point the server at any internal address.
     */
    private static function logoFromUrl(?string $url): ?string
    {
        $url = trim((string) $url);
        if ($url === '' || !preg_match('~^https?://~i', $url)) return null;

        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $allowed = array_filter([
            strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST)),
            strtolower((string) parse_url((string) config('filesystems.disks.azure.url', env('AZURE_STORAGE_URL', '')), PHP_URL_HOST)),
        ]);
        if (!$host || !in_array($host, $allowed, true)) {
            Log::warning('DOCX header logo URL refused (host not allowed)', ['host' => $host]);
            return null;
        }

        try {
            $res = Http::timeout(8)->get($url);
            if (!$res->successful()) return null;
            $ext = strtolower(pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION)) ?: 'png';
            $tmp = tempnam(sys_get_temp_dir(), 'cbc_logo_') . '.' . $ext;
            file_put_contents($tmp, $res->body());
            // Route it back through the format guard: a fetched SVG/WEBP still
            // needs converting before PhpWord will take it.
            return self::resolveDocxLogo($tmp) ?: null;
        } catch (Throwable $e) {
            Log::warning('DOCX header logo fetch failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    private static function resolveDocxLogo(?string $logoPath): ?string
    {
        $abs = self::localFile($logoPath);
        if (!$abs) return null;
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));

        if (in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'bmp'], true)) return $abs;

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
            } catch (\Throwable $e) { /* fall through */ }
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
            } catch (\Throwable $e) { /* fall through */ }
        }

        return null;
    }

    private static function writeHeader($section, array $cfg): void
    {
        $logoPath = $cfg['logo_path'] ?? null;
        $title    = (string) ($cfg['title']    ?? '');
        $subtitle = (string) ($cfg['subtitle'] ?? '');
        $hAlign   = (string) ($cfg['align']    ?? 'right');
        // Honour the SPA's configured logo height (clamped 24-200) instead of a
        // fixed size, so the rendered Word logo matches the on-screen preview.
        $logoH    = (int) max(24, min(200, $cfg['logo_height'] ?? 60));

        /* Header table sized in TWIPS against the real printable width.
         * It used to declare a PERCENT width while handing addCell() raw
         * twips (2500 + 7500 = 10000), and PhpWord treats cell widths as
         * twips regardless of the table unit -- so the row was ~1000 twips
         * wider than A4's printable area (11906 - 2 * 1440 = 9026). Word
         * clipped the overflow at the right margin, which is why a long
         * company name came out cut off in the generated .docx. */
        $usable    = self::HEADER_WIDTH_TWIPS;
        $logoW     = (int) round($usable * 0.25);
        $titleW    = $usable - $logoW;

        $header = $section->addHeader();
        $table = $header->addTable([
            'borderSize' => 0, 'cellMargin' => 0,
            'unit'   => TblWidth::TWIP,
            'width'  => $usable,
            'layout' => Table::LAYOUT_FIXED,
        ]);
        $row1 = $table->addRow();
        /* noWrap => false is essential: PhpWord's Cell style defaults noWrap
         * to TRUE, which emits <w:noWrap/> and forbids the cell from wrapping.
         * A company name longer than the cell then runs off the right margin
         * and Word clips it -- the reported truncation. */
        $logoCell  = $row1->addCell($logoW,  ['valign' => 'center', 'noWrap' => false]);
        $titleCell = $row1->addCell($titleW, ['valign' => 'center', 'noWrap' => false]);

        /* logo_path first, then logo_url.
         *
         * The PDF renders <img src="{logo_url}"> and has always worked; the
         * DOCX read logo_path alone, and PhpWord needs a real local file. So
         * whenever logo_path was null, stale, or not resolvable on the current
         * disk, the Word file came out with NO logo while the PDF still showed
         * one -- and silently, because the block below only ran when a path
         * resolved. Falling back to the URL the PDF already trusts makes the
         * two exports agree. */
        $absLogo = self::resolveDocxLogo($logoPath) ?: self::logoFromUrl($cfg['logo_url'] ?? null);
        if ($absLogo) {
            try { $logoCell->addImage($absLogo, ['height' => $logoH]); }
            catch (Throwable $e) { $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']); }
        } elseif ($logoPath || !empty($cfg['logo_url'])) {
            /* A logo WAS configured but could not be resolved. Say so in the
               document and in the log rather than shipping a silent gap. */
            Log::warning('DOCX header logo unresolved', ['logo_path' => $logoPath, 'logo_url' => $cfg['logo_url'] ?? null]);
            $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']);
        }
        $align = $hAlign === 'left' ? 'left' : ($hAlign === 'center' ? 'center' : 'right');
        if ($title !== '')    $titleCell->addText($title,    ['bold' => true, 'size' => 14], ['alignment' => $align]);
        if ($subtitle !== '') $titleCell->addText($subtitle, ['size' => 10, 'color' => '6B7280'], ['alignment' => $align]);
    }

    private static function writeFooter($section, array $cfg): void
    {
        $footerText = (string) ($cfg['text']  ?? '');
        $fAlign     = (string) ($cfg['align'] ?? 'center');
        $showPage   = !empty($cfg['show_page_number']);
        $pnAlign    = (string) ($cfg['page_number_align']  ?? 'right');
        $pnFormat   = (string) ($cfg['page_number_format'] ?? 'Page N of M');

        $footer = $section->addFooter();
        $fTable = $footer->addTable([
            'borderSize' => 0, 'cellMargin' => 0,
            'unit'   => TblWidth::TWIP,
            'width'  => self::HEADER_WIDTH_TWIPS,
            'layout' => Table::LAYOUT_FIXED,
        ]);
        $fCellW = (int) floor(self::HEADER_WIDTH_TWIPS / 3);
        $fRow = $fTable->addRow();
        $cells = [
            'left'   => $fRow->addCell($fCellW, ['valign' => 'center', 'noWrap' => false]),
            'center' => $fRow->addCell($fCellW, ['valign' => 'center', 'noWrap' => false]),
            'right'  => $fRow->addCell(self::HEADER_WIDTH_TWIPS - (2 * $fCellW), ['valign' => 'center', 'noWrap' => false]),
        ];
        if ($footerText !== '' && isset($cells[$fAlign])) {
            $cells[$fAlign]->addText($footerText, ['size' => 9, 'color' => '6B7280'], ['alignment' => $fAlign]);
        }
        if ($showPage && isset($cells[$pnAlign])) {
            $run = $cells[$pnAlign]->addTextRun(['alignment' => $pnAlign]);
            $style = ['size' => 9, 'color' => '6B7280'];
            switch ($pnFormat) {
                case 'N':            $run->addField('PAGE', [], [], '', false); break;
                case 'Page N':       $run->addText('Page ', $style); $run->addField('PAGE', [], [], '', false); break;
                case 'N / M':        $run->addField('PAGE', [], [], '', false); $run->addText(' / ', $style); $run->addField('NUMPAGES', [], [], '', false); break;
                case 'Page N of M':
                default:             $run->addText('Page ', $style); $run->addField('PAGE', [], [], '', false); $run->addText(' of ', $style); $run->addField('NUMPAGES', [], [], '', false);
            }
        }
    }
}
