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

        // Word renders a hyperlink as blue + underlined ONLY when the <a> run
        // carries that font style. The editor styles links via CSS (which
        // PhpWord ignores when building the DOCX), so links came out as plain
        // black text — clickable, but indistinguishable from normal text. Stamp
        // a blue underline inline (unless the <a> already sets its own colour)
        // so DOCX links look like — and are recognised as — links.
        $html = preg_replace_callback(
            '/<a\b([^>]*)>/i',
            function ($m) {
                $attrs = $m[1];
                if (preg_match('/\bstyle\s*=\s*"([^"]*)"/i', $attrs, $sm)) {
                    if (preg_match('/color\s*:/i', $sm[1])) return $m[0];   // keep an author colour
                    $newStyle = rtrim($sm[1], "; \t") . ';color:#0563C1;text-decoration:underline';
                    return '<a' . preg_replace('/\bstyle\s*=\s*"[^"]*"/i', 'style="' . $newStyle . '"', $attrs) . '>';
                }
                return '<a' . $attrs . ' style="color:#0563C1;text-decoration:underline">';
            },
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

    /** Convert a <w:tbl> to an HTML <table>, preserving the ORIGINAL column
     *  widths (from <w:tblGrid>) and merged cells (<w:gridSpan>) so a wide /
     *  multi-column Word table doesn't collapse into equal, cramped columns. */
    private function xmlTableToHtml(\DOMElement $t, \DOMXPath $xp): string
    {
        // ── Column widths (twips) from the table grid → percentages ──
        $colWidths = [];
        foreach ($xp->query('w:tblGrid/w:gridCol', $t) as $gc) {
            $w = (int) $gc->getAttributeNS(self::W_NS, 'w');
            $colWidths[] = $w > 0 ? $w : 1;
        }
        $totalW = array_sum($colWidths);
        $pcts   = [];
        if ($totalW > 0) foreach ($colWidths as $w) $pcts[] = round($w / $totalW * 100, 2);

        // A <colgroup> is honoured by dompdf (PDF) + PhpWord (DOCX); the editor
        // (TipTap) may drop it, so the width is ALSO stamped on each cell's
        // inline style, which the editor preserves — tables render with their
        // original proportions everywhere instead of collapsing to equal cols.
        $colgroup = '';
        if ($pcts) {
            $colgroup = '<colgroup>';
            foreach ($pcts as $pct) $colgroup .= '<col style="width:' . $pct . '%" />';
            $colgroup .= '</colgroup>';
        }

        $rows = '';
        foreach ($xp->query('w:tr', $t) as $tr) {
            $cells  = '';
            $colIdx = 0;
            foreach ($xp->query('w:tc', $tr) as $tc) {
                // Horizontal merge → colspan (and its width spans those columns).
                $span = 1;
                $gs = $xp->query('w:tcPr/w:gridSpan', $tc);
                if ($gs->length) $span = max(1, (int) $gs->item(0)->getAttributeNS(self::W_NS, 'val'));
                $wPct = 0.0;
                for ($k = 0; $k < $span; $k++) $wPct += $pcts[$colIdx + $k] ?? 0;
                $colIdx += $span;

                $spanAttr  = $span > 1 ? ' colspan="' . $span . '"' : '';
                $styleAttr = $wPct > 0 ? ' style="width:' . round($wPct, 2) . '%"' : '';
                $ci = '';
                foreach ($xp->query('w:p', $tc) as $p) $ci .= $this->xmlParaToHtml($p, $xp);
                $cells .= '<td' . $spanAttr . $styleAttr . '>' . $ci . '</td>';
            }
            $rows .= '<tr>' . $cells . '</tr>';
        }
        return '<table border="1">' . $colgroup . '<tbody>' . $rows . '</tbody></table>';
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

    /**
     * Give every <table> that lacks explicit column widths a full-width,
     * EQUAL-column layout (a <colgroup> + width:100%) so the DOCX renders it the
     * same way the editor does (table-layout:fixed; width:100%) instead of
     * PhpWord's default uneven auto-sizing. Tables that already carry widths
     * (e.g. from an uploaded Word grid) are left untouched.
     */
    protected function ensureTableColWidths(string $html): string
    {
        if (stripos($html, '<table') === false) return $html;
        $prev = libxml_use_internal_errors(true);
        try {
            $doc = new \DOMDocument('1.0', 'UTF-8');
            if (!$doc->loadHTML(
                '<?xml encoding="UTF-8"?><div data-root="1">' . $html . '</div>',
                LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
            )) {
                return $html;
            }
            $xp = new \DOMXPath($doc);
            foreach ($xp->query('//table') as $table) {
                if ($xp->query('colgroup', $table)->length) continue;   // already has widths
                $maxCols = 0;
                foreach ($xp->query('.//tr', $table) as $tr) {
                    $cols = 0;
                    foreach ($xp->query('td|th', $tr) as $cell) {
                        $cols += max(1, (int) ($cell->getAttribute('colspan') ?: 1));
                    }
                    $maxCols = max($maxCols, $cols);
                }
                if ($maxCols < 1) continue;
                $style = $table->getAttribute('style');
                if (stripos($style, 'width') === false) {
                    $table->setAttribute('style', trim($style . ';width:100%', '; '));
                }
                $cg  = $doc->createElement('colgroup');
                $pct = round(100 / $maxCols, 4);
                for ($i = 0; $i < $maxCols; $i++) {
                    $col = $doc->createElement('col');
                    $col->setAttribute('style', 'width:' . $pct . '%');
                    $cg->appendChild($col);
                }
                $table->insertBefore($cg, $table->firstChild);
            }
            $root = null;
            foreach ($doc->childNodes as $n) {
                if ($n->nodeType === XML_ELEMENT_NODE && $n->nodeName === 'div') { $root = $n; break; }
            }
            if (!$root) return $html;
            $out = '';
            foreach ($root->childNodes as $c) $out .= $doc->saveHTML($c);
            return $out !== '' ? $out : $html;
        } catch (\Throwable $e) {
            return $html;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
        }
    }

    /**
     * Add editor HTML to a PhpWord section RESILIENTLY. PhpWord's Html reader
     * throws on markup it can't handle, and the old catch degraded the WHOLE
     * document to strip_tags() — so one bad element wiped every table + all
     * formatting ("table broken / content missing"). Here we first try the whole
     * body; if that throws, we add each top-level block on its own so only the
     * single offending block degrades to plain text — everything else keeps its
     * tables, links and formatting.
     */
    protected function addHtmlResilient($section, string $bodyHtml): void
    {
        $whole = '<!DOCTYPE html><html><body>' . $bodyHtml . '</body></html>';
        try {
            \PhpOffice\PhpWord\Shared\Html::addHtml($section, $whole, true, false);
            return;
        } catch (\Throwable $e) {
            // fall through to per-block
        }

        foreach ($this->splitTopLevelBlocks($bodyHtml) as $block) {
            $wrapped = '<!DOCTYPE html><html><body>' . $block . '</body></html>';
            try {
                \PhpOffice\PhpWord\Shared\Html::addHtml($section, $wrapped, true, false);
            } catch (\Throwable $e2) {
                $txt = trim(html_entity_decode(strip_tags($block), ENT_QUOTES | ENT_HTML5));
                if ($txt !== '') $section->addText($txt);
            }
        }
    }

    /** Split body HTML into its top-level block elements (for the resilient add). */
    protected function splitTopLevelBlocks(string $html): array
    {
        $prev = libxml_use_internal_errors(true);
        try {
            $doc = new \DOMDocument('1.0', 'UTF-8');
            if (!$doc->loadHTML(
                '<?xml encoding="UTF-8"?><div data-root="1">' . $html . '</div>',
                LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
            )) {
                return [$html];
            }
            $root = null;
            foreach ($doc->childNodes as $n) {
                if ($n->nodeType === XML_ELEMENT_NODE && $n->nodeName === 'div') { $root = $n; break; }
            }
            if (!$root) return [$html];
            $blocks = [];
            foreach ($root->childNodes as $child) {
                $s = $doc->saveHTML($child);
                if ($s === false) continue;
                // Keep blocks with text, or structural elements (tables / rules).
                if (trim(strip_tags($s)) !== '' || preg_match('/<(table|hr|img)\b/i', $s)) {
                    $blocks[] = $s;
                }
            }
            return $blocks ?: [$html];
        } catch (\Throwable $e) {
            return [$html];
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
        }
    }
}
