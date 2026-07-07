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
        // The contentEditable editor writes font sizes in px (e.g. the toolbar's
        // applyFontSize sets `font-size:16px`), but Word/PhpWord expects points.
        // Convert px→pt (1px ≈ 0.75pt) up front so the DOCX text keeps the same
        // sizes the user saw in the editor instead of being scaled wrong.
        $html = preg_replace_callback(
            '/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/i',
            fn ($m) => 'font-size:' . round(((float) $m[1]) * 0.75, 1) . 'pt',
            $html
        );

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
        // 1) Parse word/document.xml DIRECTLY. This is the only lossless path:
        //    PhpWord's reader silently drops soft line breaks (<w:br/>), so its
        //    HTML writer and the element walker both flatten things like a
        //    Seller block ("Seller:" / "Name:" / "Address:" on separate lines)
        //    into one run-on line. Direct parsing keeps paragraph breaks, soft
        //    breaks, bold/italic/underline, headings, alignment and tables.
        $direct = $this->docxBodyToHtml($absPath);
        if ($direct !== null) return $direct;

        // 2) Fallback: PhpWord's HTML writer (good structure, loses <br>).
        try {
            $phpWord = IOFactory::load($absPath);
        } catch (\Throwable $e) {
            return '<p></p>';
        }
        try {
            $writer = IOFactory::createWriter($phpWord, 'HTML');
            ob_start();
            $writer->save('php://output');
            $full = (string) ob_get_clean();
            if (preg_match('#<body[^>]*>(.*)</body>#is', $full, $m)) {
                $body = trim($m[1]);
                if ($body !== '') return $body;
            }
        } catch (\Throwable $e) {
            if (ob_get_level() > 0) { @ob_end_clean(); }
        }

        // 3) Last resort: the element walker.
        $html = '';
        foreach ($phpWord->getSections() as $section) {
            foreach ($section->getElements() as $el) {
                $html .= $this->elementToHtml($el);
            }
        }
        return trim($html) ?: '<p></p>';
    }

    /** OOXML wordprocessing namespace. */
    private const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    /**
     * Parse a DOCX's word/document.xml straight into HTML, preserving soft line
     * breaks (<w:br/>), paragraph breaks, headings (pStyle), alignment, basic
     * run formatting (bold/italic/underline) and tables. Returns null when the
     * file can't be opened/parsed so the caller can fall back to PhpWord.
     */
    protected function docxBodyToHtml(string $absPath): ?string
    {
        if (!class_exists('ZipArchive')) return null;
        $zip = new \ZipArchive();
        if ($zip->open($absPath) !== true) return null;
        $xml = $zip->getFromName('word/document.xml');
        $zip->close();
        if ($xml === false || $xml === '') return null;

        $prev = libxml_use_internal_errors(true);
        try {
            $dom = new \DOMDocument();
            if (!$dom->loadXML($xml)) return null;
            $xp = new \DOMXPath($dom);
            $xp->registerNamespace('w', self::W_NS);
            $body = $xp->query('//w:body')->item(0);
            if (!$body) return null;
            $html = '';
            foreach ($body->childNodes as $node) {
                if ($node->localName === 'p')        $html .= $this->xmlParaToHtml($node, $xp);
                elseif ($node->localName === 'tbl')  $html .= $this->xmlTableToHtml($node, $xp);
            }
            $html = trim($html);
            return $html !== '' ? $html : null;
        } catch (\Throwable $e) {
            return null;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
        }
    }

    /** Convert a single <w:r> run to HTML (text + <br>/<tab>, with b/i/u). */
    private function xmlRunToHtml(\DOMElement $r, \DOMXPath $xp): string
    {
        $b  = $xp->query('w:rPr/w:b', $r)->length > 0;
        $i  = $xp->query('w:rPr/w:i', $r)->length > 0;
        $uN = $xp->query('w:rPr/w:u', $r);
        $u  = $uN->length > 0 && $uN->item(0)->getAttributeNS(self::W_NS, 'val') !== 'none';

        $out = '';
        foreach ($r->childNodes as $c) {
            if ($c->localName === 't')        $out .= htmlspecialchars($c->textContent, ENT_QUOTES);
            elseif ($c->localName === 'br')   $out .= '<br>';
            elseif ($c->localName === 'tab')  $out .= ' &nbsp;&nbsp; ';
        }
        if ($out === '') return '';
        if ($b) $out = "<b>{$out}</b>";
        if ($i) $out = "<i>{$out}</i>";
        if ($u) $out = "<u>{$out}</u>";
        return $out;
    }

    /** Convert a <w:p> paragraph to <p>/<hN>, honouring style, alignment, breaks. */
    private function xmlParaToHtml(\DOMElement $p, \DOMXPath $xp): string
    {
        $style = '';
        $sN = $xp->query('w:pPr/w:pStyle', $p);
        if ($sN->length) $style = strtolower($sN->item(0)->getAttributeNS(self::W_NS, 'val'));

        $align = '';
        $jN = $xp->query('w:pPr/w:jc', $p);
        if ($jN->length) {
            $j = $jN->item(0)->getAttributeNS(self::W_NS, 'val');
            if (in_array($j, ['center', 'right', 'both'], true)) $align = $j === 'both' ? 'justify' : $j;
        }

        $inner = '';
        foreach ($p->childNodes as $c) {
            // PhpWord-written docs put <w:br/> / <w:t> directly under <w:p>;
            // real Word docs wrap them in <w:r>. Handle both.
            if ($c->localName === 'r')             $inner .= $this->xmlRunToHtml($c, $xp);
            elseif ($c->localName === 'br')        $inner .= '<br>';
            elseif ($c->localName === 't')         $inner .= htmlspecialchars($c->textContent, ENT_QUOTES);
            elseif ($c->localName === 'hyperlink') {
                foreach ($c->childNodes as $hc) {
                    if ($hc->localName === 'r') $inner .= $this->xmlRunToHtml($hc, $xp);
                }
            }
        }
        if (trim(strip_tags($inner)) === '' && strpos($inner, '<br') === false) return '';

        $styleAttr = $align !== '' ? ' style="text-align:' . $align . '"' : '';
        if (strpos($style, 'heading1') !== false || strpos($style, 'title') !== false) return "<h1{$styleAttr}>{$inner}</h1>";
        if (strpos($style, 'heading2') !== false) return "<h2{$styleAttr}>{$inner}</h2>";
        if (strpos($style, 'heading')  !== false) return "<h3{$styleAttr}>{$inner}</h3>";
        return "<p{$styleAttr}>{$inner}</p>";
    }

    /** Convert a <w:tbl> to an HTML <table>. */
    private function xmlTableToHtml(\DOMElement $t, \DOMXPath $xp): string
    {
        $rows = '';
        foreach ($xp->query('w:tr', $t) as $tr) {
            $cells = '';
            foreach ($xp->query('w:tc', $tr) as $tc) {
                $ci = '';
                foreach ($xp->query('w:p', $tc) as $p) $ci .= $this->xmlParaToHtml($p, $xp);
                $cells .= '<td>' . $ci . '</td>';
            }
            $rows .= '<tr>' . $cells . '</tr>';
        }
        return '<table border="1">' . $rows . '</table>';
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

    /**
     * Make the editor HTML well-formed XHTML so PhpWord's Html::addHtml (which
     * uses a strict loadXML internally) doesn't choke on unclosed tags and
     * throw — which would otherwise drop us into a strip_tags() fallback that
     * flattens the whole document into one run-on paragraph (no headings,
     * tables or line breaks). Uses the lenient DOMDocument::loadHTML parser to
     * repair the markup, then re-serialises as XML.
     */
    /**
     * Render the saved page-shell header_config / footer_config into a PhpWord
     * section as a real Word header + footer (logo image, title, subtitle,
     * footer text + page number). DOCX headers flow rather than absolute-
     * position, so the logo/title use the config's `align` (left/center/right)
     * — the closest practical mapping of the editor's x/y placement.
     *
     * $logoAbsPath is the resolved on-disk path of the header logo (or null);
     * the caller resolves it because storage/client lookup is app-specific.
     */
    protected function applyDocxHeaderFooter($section, array $headerCfg, array $footerCfg, ?string $logoAbsPath): void
    {
        $align = static function ($a, string $fallback): string {
            return in_array($a, ['left', 'center', 'right', 'both'], true) ? $a : $fallback;
        };
        $hex = static function ($c, string $fallback): string {
            $c = ltrim((string) $c, '#');
            return preg_match('/^[0-9a-fA-F]{6}$/', $c) ? strtoupper($c) : $fallback;
        };

        // ── Header ──
        $showLogo  = $headerCfg['show_logo']  ?? true;
        $showTitle = $headerCfg['show_title'] ?? true;
        if ($showLogo || $showTitle) {
            $header = $section->addHeader();
            $hAlign = $align($headerCfg['align'] ?? 'right', 'right');
            if ($showLogo && $logoAbsPath && is_file($logoAbsPath)) {
                try {
                    $header->addImage($logoAbsPath, [
                        'height'    => (int) ($headerCfg['logo_height'] ?? 62),
                        'alignment' => $hAlign,
                    ]);
                } catch (\Throwable $e) { /* skip an unreadable image rather than fail the export */ }
            }
            if ($showTitle) {
                $title = trim((string) ($headerCfg['title'] ?? ''));
                $sub   = trim((string) ($headerCfg['subtitle'] ?? ''));
                $color = $hex($headerCfg['text_color'] ?? null, '111827');
                if ($title !== '') {
                    $header->addText(htmlspecialchars($title, ENT_QUOTES), ['bold' => true, 'size' => 12, 'color' => $color], ['alignment' => $hAlign]);
                }
                if ($sub !== '') {
                    $header->addText(htmlspecialchars($sub, ENT_QUOTES), ['size' => 9, 'color' => '888888'], ['alignment' => $hAlign]);
                }
            }
        }

        // ── Footer ──
        $footerText = trim((string) ($footerCfg['text'] ?? ''));
        $showPage   = $footerCfg['show_page_number'] ?? true;
        if ($footerText !== '' || $showPage) {
            $footer = $section->addFooter();
            $fColor = $hex($footerCfg['text_color'] ?? null, '6B7280');
            if ($footerText !== '') {
                $footer->addText(htmlspecialchars($footerText, ENT_QUOTES), ['size' => 9, 'color' => $fColor], ['alignment' => $align($footerCfg['align'] ?? 'center', 'center')]);
            }
            if ($showPage) {
                // {PAGE}/{NUMPAGES} are Word field codes — addPreserveText keeps
                // them live so the page count updates as the document grows.
                $footer->addPreserveText('Page {PAGE} of {NUMPAGES}', ['size' => 9, 'color' => $fColor], ['alignment' => $align($footerCfg['page_number_align'] ?? 'right', 'right')]);
            }
        }
    }

    protected function toWellFormedHtml(string $html): string
    {
        if (trim($html) === '') return $html;
        $prev = libxml_use_internal_errors(true);
        try {
            $doc = new \DOMDocument('1.0', 'UTF-8');
            // Wrap in a single root + declare UTF-8 so loadHTML keeps the
            // encoding and we have a known node to read children back from.
            $doc->loadHTML(
                '<?xml encoding="UTF-8"?><div data-root="1">' . $html . '</div>',
                LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
            );
            $root = null;
            foreach ($doc->childNodes as $node) {
                if ($node->nodeType === XML_ELEMENT_NODE && $node->nodeName === 'div') { $root = $node; break; }
            }
            if (!$root) return $html;
            $out = '';
            foreach ($root->childNodes as $child) {
                $out .= $doc->saveXML($child);
            }
            return $out !== '' ? $out : $html;
        } catch (\Throwable $e) {
            return $html;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
        }
    }
}
