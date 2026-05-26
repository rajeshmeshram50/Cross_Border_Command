<?php

namespace App\Http\Controllers\Concerns;

use PhpOffice\PhpWord\IOFactory;

/**
 * Shared helpers for the HTML ↔ DOCX round-trip used by the CLM
 * Trade Document and Agreement editors.
 *
 * Both editors render with the same contentEditable + execCommand
 * toolbar, so the shape of HTML they emit is identical and so are the
 * normalisation rules PhpWord needs to ingest it.
 */
trait HandlesDocxHtmlRoundtrip
{
    /**
     * Normalise the HTML the contentEditable toolbar produces so PhpWord's
     * Html reader sees shapes it can convert:
     *   - <font color="X"> / <font face="X"> → <span style="color:X / font-family:X">
     *   - <font size="N">  (1..7)            → <span style="font-size:Xpt">
     *   - <span style="font-weight:bold">    → <b>…</b>
     *   - <span style="font-style:italic">   → <i>…</i>
     *   - <span style="text-decoration:underline"> → <u>…</u>
     *   - <div style="text-align:X">         → <p style="text-align:X">
     */
    protected function normaliseEditorHtml(string $html): string
    {
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
                $residual = preg_replace('/(font-weight|font-style|text-decoration)\s*:[^;]+;?/i', '', $style);
                $residual = trim((string) $residual, " ;\t\n");
                $spanOpen  = $residual !== '' ? '<span style="' . $residual . '">' : '';
                $spanClose = $residual !== '' ? '</span>'                          : '';
                return $open . $spanOpen . $inner . $spanClose . $close;
            },
            (string) $html
        );

        $html = preg_replace(
            '/<div(\s+[^>]*text-align\s*:[^>]*)>(.*?)<\/div>/is',
            '<p$1>$2</p>',
            (string) $html
        );

        return (string) $html;
    }

    /**
     * Lightweight DOCX → HTML — walks PhpWord's parsed model and stitches
     * <p>/<b>/<i>/<u> tags. Mirrors the HRMS template helper so a Word
     * round-trip preserves text + basic formatting + paragraph breaks.
     */
    protected function docxToHtml(string $absPath): string
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

    protected function elementToHtml($el): string
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
}
