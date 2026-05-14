<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;
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
    public static function buildPath($row): string
    {
        $phpWord = new PhpWord();
        $section = $phpWord->addSection([
            'headerHeight' => 90 * 20,
            'footerHeight' => 50 * 20,
        ]);

        self::writeHeader($section, is_array($row->header_config) ? $row->header_config : []);
        self::writeFooter($section, is_array($row->footer_config) ? $row->footer_config : []);

        $html = (string) ($row->content_html ?: '<p>(empty template)</p>');
        $wrapped = '<html><body>' . $html . '</body></html>';
        try { Html::addHtml($section, $wrapped, false, false); }
        catch (\Throwable $e) { $section->addText(strip_tags($html)); }

        $writer = IOFactory::createWriter($phpWord, 'Word2007');
        $tmp = tempnam(sys_get_temp_dir(), 'tpl_') . '.docx';
        $writer->save($tmp);
        return $tmp;
    }

    /** Streams the freshly-built DOCX as a download response. */
    public static function render($row, string $filename): BinaryFileResponse
    {
        $tmp = self::buildPath($row);
        return response()->download($tmp, $filename)->deleteFileAfterSend(true);
    }

    private static function writeHeader($section, array $cfg): void
    {
        $logoPath = $cfg['logo_path'] ?? null;
        $title    = (string) ($cfg['title']    ?? '');
        $subtitle = (string) ($cfg['subtitle'] ?? '');
        $hAlign   = (string) ($cfg['align']    ?? 'right');

        $header = $section->addHeader();
        $table = $header->addTable([
            'borderSize' => 0, 'cellMargin' => 0,
            'unit'  => TblWidth::PERCENT,
            'width' => 100 * 50,
        ]);
        $row1 = $table->addRow();
        $logoCell  = $row1->addCell(2500, ['valign' => 'center']);
        $titleCell = $row1->addCell(7500, ['valign' => 'center']);

        $absLogo = $logoPath && Storage::disk('public')->exists($logoPath)
            ? Storage::disk('public')->path($logoPath) : null;
        if ($absLogo) {
            try { $logoCell->addImage($absLogo, ['height' => 60, 'width' => 120]); }
            catch (\Throwable $e) { $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']); }
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
            'unit'  => TblWidth::PERCENT,
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
                case 'N':            $run->addField('PAGE', [], [], '', false); break;
                case 'Page N':       $run->addText('Page ', $style); $run->addField('PAGE', [], [], '', false); break;
                case 'N / M':        $run->addField('PAGE', [], [], '', false); $run->addText(' / ', $style); $run->addField('NUMPAGES', [], [], '', false); break;
                case 'Page N of M':
                default:             $run->addText('Page ', $style); $run->addField('PAGE', [], [], '', false); $run->addText(' of ', $style); $run->addField('NUMPAGES', [], [], '', false);
            }
        }
    }
}
