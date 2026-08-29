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

        // PhpWord fills a table cell from `background-color` and IGNORES the
        // `background` shorthand — but the editor writes cell fills as
        // `background: rgb(r,g,b)`. Without this the teal header row came out
        // with no fill, so its white text was invisible (white-on-white).
        // Promote a solid-colour `background:` to `background-color:` (PhpWord
        // accepts the rgb() value as-is and emits <w:shd>).
        $html = preg_replace(
            '/\bbackground\s*:\s*(rgb\([^)]*\)|#[0-9a-fA-F]{3,6})/i',
            'background-color:$1',
            (string) $html
        );

        // Repair links whose href is empty or protocol-only (e.g. href="https://")
        // but whose visible TEXT is a real URL — an old editor bug saved these
        // when the user link-wrapped a pasted URL and accepted the bare "https://"
        // prompt default. Use the link text as the href so the DOCX (and PDF)
        // link actually opens instead of going nowhere.
        $html = preg_replace_callback(
            '/<a\b([^>]*)>(.*?)<\/a>/is',
            function ($m) {
                $attrs = $m[1];
                $inner = $m[2];
                $href  = '';
                if (preg_match('/\bhref\s*=\s*"([^"]*)"/i', $attrs, $hm)) $href = trim($hm[1]);
                $broken = $href === '' || $href === '#' || (bool) preg_match('#^(https?://|mailto:|tel:)$#i', $href);
                if (!$broken) return $m[0];
                $text = trim(html_entity_decode(strip_tags($inner), ENT_QUOTES | ENT_HTML5));
                if ($text === '' || !preg_match('#^(https?://|mailto:|tel:|www\.|[\w-]+(\.[\w-]+)+)#i', $text)) return $m[0];
                $newHref = preg_match('#^(https?://|mailto:|tel:)#i', $text) ? $text : 'https://' . $text;
                $newHref = htmlspecialchars($newHref, ENT_QUOTES);
                $attrs = preg_match('/\bhref\s*=/i', $attrs)
                    ? preg_replace('/\bhref\s*=\s*"[^"]*"/i', 'href="' . $newHref . '"', $attrs)
                    : $attrs . ' href="' . $newHref . '"';
                return '<a' . $attrs . '>' . $inner . '</a>';
            },
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
    /** Largest document the editors and the PDF renderer stay usable on. */
    protected const DOCX_MAX_PAGES = 70;

    /**
     * Page count for an uploaded .docx, or null when it cannot be determined.
     *
     * Word caches the count in docProps/app.xml every time it saves, so for a
     * file that came out of Word this is the real number rather than a guess
     * from bytes or characters — a 60-page text document and a 6-page one full
     * of images can weigh the same, which is why a size cap alone never
     * expressed this rule.
     *
     * Returns null for files written by tools that omit the element (or that
     * leave it at 1 without recalculating), so callers must treat null as
     * "unknown" and fall back to something else rather than as "fine".
     */
    protected function docxPageCount(string $absPath): ?int
    {
        if (!class_exists('ZipArchive')) return null;
        $zip = new \ZipArchive();
        if ($zip->open($absPath) !== true) return null;
        $xml = $zip->getFromName('docProps/app.xml');
        $zip->close();
        if (!is_string($xml) || $xml === '') return null;
        if (!preg_match('/<Pages>(\d+)<\/Pages>/i', $xml, $m)) return null;
        $n = (int) $m[1];
        // 0 is meaningless and 1 is what a non-Word writer leaves behind, so
        // neither is trusted as a real measurement.
        return $n > 1 ? $n : null;
    }

    /**
     * Null when the upload is within the page limit, else the message to show.
     *
     * `$html` is the converted body, used only when the page count is unknown:
     * at this template's metrics a page holds roughly 3,000 characters, so it
     * stands in for the count rather than leaving unmeasurable files unchecked.
     */
    protected function docxPageLimitError(string $absPath, ?string $html = null): ?string
    {
        $max = self::DOCX_MAX_PAGES;
        $pages = $this->docxPageCount($absPath);
        if ($pages !== null) {
            return $pages > $max
                ? "This document is {$pages} pages. The limit is {$max} pages — please split it into smaller documents."
                : null;
        }
        $chars = $html === null ? 0 : mb_strlen($html);
        $approx = (int) ceil($chars / 3000);
        return $approx > $max
            ? "This document is about {$approx} pages ({$chars} characters). The limit is {$max} pages — please split it into smaller documents."
            : null;
    }

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

    /** Convert a single <w:r> run to HTML (text + <br>/<tab>, with b/i/u + colour). */
    private function xmlRunToHtml(\DOMElement $r, \DOMXPath $xp): string
    {
        $b  = $xp->query('w:rPr/w:b', $r)->length > 0;
        $i  = $xp->query('w:rPr/w:i', $r)->length > 0;
        $uN = $xp->query('w:rPr/w:u', $r);
        $u  = $uN->length > 0 && $uN->item(0)->getAttributeNS(self::W_NS, 'val') !== 'none';
        // Text colour — needed so a white header run survives the round trip
        // (it sits on a coloured cell fill; without this it comes back black).
        $colorN = $xp->query('w:rPr/w:color', $r);
        $color  = $colorN->length ? $colorN->item(0)->getAttributeNS(self::W_NS, 'val') : '';

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
        if ($color !== '' && $color !== 'auto' && preg_match('/^[0-9A-Fa-f]{6}$/', $color)) {
            $out = '<span style="color:#' . $color . '">' . $out . '</span>';
        }
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

        // Does the table carry borders? PhpWord writes them at TABLE level
        // (w:tblBorders), not per-cell, so detect once here and stamp an inline
        // border on every cell (that's what the editor renders) plus the table's
        // own border attribute — the grid lines were vanishing on re-upload.
        $tblBordered = false;
        $tblB = $xp->query('w:tblPr/w:tblBorders', $t)->item(0);
        if ($tblB) {
            foreach (['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as $side) {
                $b = $xp->query('w:' . $side, $tblB)->item(0);
                if ($b) {
                    $v = $b->getAttributeNS(self::W_NS, 'val');
                    if ($v !== '' && $v !== 'none' && $v !== 'nil') { $tblBordered = true; break; }
                }
            }
        }

        $rowsHtml    = [];
        $rowIsHeader = [];
        foreach ($xp->query('w:tr', $t) as $tr) {
            $cells      = '';
            $colIdx     = 0;
            $cellCount  = 0;
            $shadedCount = 0;
            foreach ($xp->query('w:tc', $tr) as $tc) {
                // Horizontal merge → colspan (and its width spans those columns).
                $span = 1;
                $gs = $xp->query('w:tcPr/w:gridSpan', $tc);
                if ($gs->length) $span = max(1, (int) $gs->item(0)->getAttributeNS(self::W_NS, 'val'));
                $wPct = 0.0;
                for ($k = 0; $k < $span; $k++) $wPct += $pcts[$colIdx + $k] ?? 0;
                $colIdx += $span;

                // Cell fill (w:shd/@fill) → background-color, so a coloured header
                // row (e.g. the teal header) survives a download → re-upload round
                // trip instead of coming back plain white.
                $bg = '';
                $shd = $xp->query('w:tcPr/w:shd', $tc);
                if ($shd->length) {
                    $fill = $shd->item(0)->getAttributeNS(self::W_NS, 'fill');
                    if ($fill && $fill !== 'auto' && preg_match('/^[0-9A-Fa-f]{6}$/', $fill)) {
                        $bg = 'background-color:#' . $fill;
                    }
                }

                $spanAttr = $span > 1 ? ' colspan="' . $span . '"' : '';
                $styleBits = [];
                if ($wPct > 0) $styleBits[] = 'width:' . round($wPct, 2) . '%';
                if ($bg !== '') $styleBits[] = $bg;
                // Bordered table → inline slate border on every cell (the exact
                // colour is lost in the DOCX, so match the editor's default).
                if ($tblBordered) $styleBits[] = 'border:1px solid #cbd5e1';
                $styleBits[] = 'padding:6px 8px';   // match the editor's cell padding
                $styleBits[] = 'vertical-align:top';
                $styleAttr = $styleBits ? ' style="' . implode(';', $styleBits) . '"' : '';
                $ci = '';
                foreach ($xp->query('w:p', $tc) as $p) $ci .= $this->xmlParaToHtml($p, $xp);
                $cells .= '<td' . $spanAttr . $styleAttr . '>' . $ci . '</td>';
                $cellCount++;
                if ($bg !== '') $shadedCount++;
            }
            $rowsHtml[]    = '<tr>' . $cells . '</tr>';
            $rowIsHeader[] = $cellCount > 0 && $shadedCount === $cellCount;
        }

        // If the first row is a fully-shaded header (the teal Insert-Table header),
        // emit it as a real <thead>. With the PDF's `thead{display:table-header-group}`
        // that keeps the header WITH its body across a page break (no orphaned
        // header stranded at the bottom of a page) and repeats it on each page.
        $thead = '';
        $bodyRows = $rowsHtml;
        if (!empty($rowIsHeader) && $rowIsHeader[0] && count($rowsHtml) > 1) {
            $thead    = '<thead>' . array_shift($bodyRows) . '</thead>';
        }
        $tbody = '<tbody>' . implode('', $bodyRows) . '</tbody>';

        // border-collapse + fixed layout so the re-imported table renders its
        // cell borders as a clean grid. Keep the `border` attribute on a bordered
        // table so a later DOWNLOAD re-emits PhpWord table borders (PhpWord only
        // honours the attribute, never the CSS border).
        $borderAttr = $tblBordered ? ' border="1"' : '';
        return '<table' . $borderAttr . ' style="width:100%;table-layout:fixed;border-collapse:collapse">'
            . $colgroup . $thead . $tbody . '</table>';
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
     * PhpWord section page-size style from the request's ?size / ?orient params.
     * Lets a wide, many-column table be exported to a larger page (A3) or
     * landscape so it isn't cramped onto A4. Dimensions are in twips (1/20 pt):
     * A4 = 210×297mm, A3 = 297×420mm (portrait).
     */
    /** Section side margin (twips) — PhpWord's default; set explicitly so the
     *  usable text width used for table sizing is deterministic. */
    protected const DOCX_SIDE_MARGIN = 1440;

    protected function docxPageStyle(\Illuminate\Http\Request $request): array
    {
        $size   = strtolower((string) $request->query('size', 'a4'));
        $orient = strtolower((string) $request->query('orient', 'portrait'));
        [$w, $h] = $size === 'a3' ? [16838, 23811] : [11906, 16838];
        if ($orient === 'landscape') { [$w, $h] = [$h, $w]; }
        return [
            'pageSizeW'    => $w,
            'pageSizeH'    => $h,
            'orientation'  => $orient === 'landscape' ? 'landscape' : 'portrait',
            'marginLeft'   => self::DOCX_SIDE_MARGIN,
            'marginRight'  => self::DOCX_SIDE_MARGIN,
            'marginTop'    => self::DOCX_SIDE_MARGIN,
            'marginBottom' => self::DOCX_SIDE_MARGIN,
        ];
    }

    /** Usable text width (twips) for the chosen page = page width − side margins.
     *  Tables are stretched to exactly this so they fill the page without the
     *  user having to drag columns in Word. */
    protected function docxUsableWidthTwips(\Illuminate\Http\Request $request): int
    {
        $s = $this->docxPageStyle($request);
        return max(2000, (int) $s['pageSizeW'] - 2 * self::DOCX_SIDE_MARGIN);
    }

    /**
     * Make every <table> that lacks explicit column widths render as an
     * EQUAL-column, full-width grid that fits the page — matching the editor's
     * `table-layout:fixed; width:100%`.
     *
     * The subtlety: PhpWord's HTML reader IGNORES <colgroup>/<col> widths and
     * sizes columns from the CELLS. When cells have no width it defaults every
     * grid column to a fixed 5000-twip width, so an N-column table becomes
     * N×5000 twips wide and overflows the page in portrait (a 3-col table is
     * 15000 twips ≈ 10.4" — wider than A4's ~6.3" text area). Stamping an equal
     * `width:%` on each cell makes PhpWord emit PROPORTIONAL grid columns that,
     * with the table at width:100%, scale to the page in any size/orientation.
     *
     * Tables that already carry real column widths (e.g. an uploaded Word grid)
     * are left untouched so their proportions survive.
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
            // A real width, as opposed to the editor's harmless `min-width:25px`.
            $hasRealWidth = static function (string $style): bool {
                return (bool) preg_match('/(?<!-)\bwidth\s*:/i', $style);
            };

            $xp = new \DOMXPath($doc);
            foreach ($xp->query('//table') as $table) {
                // Widest row (respecting colspans) = the column count.
                $maxCols = 0;
                foreach ($xp->query('.//tr', $table) as $tr) {
                    $cols = 0;
                    foreach ($xp->query('td|th', $tr) as $cell) {
                        $cols += max(1, (int) ($cell->getAttribute('colspan') ?: 1));
                    }
                    $maxCols = max($maxCols, $cols);
                }
                if ($maxCols < 1) continue;

                // PhpWord IGNORES CSS cell borders — it only draws table borders
                // from the `border` ATTRIBUTE. So if the cells carry a visible CSS
                // border (every Insert-Table table does), mirror it onto the
                // table's border attribute or the downloaded DOCX shows no grid
                // lines. Done before the width check so ALL bordered tables get it.
                if (!$table->hasAttribute('border')) {
                    foreach ($xp->query('.//td|.//th', $table) as $cell) {
                        $cs = $cell->getAttribute('style');
                        if (preg_match('/\bborder(-top|-right|-bottom|-left)?\s*:\s*(?!\s*(none|0|hidden))[^;]*\b(1px|2px|solid|thin|medium|double)\b/i', $cs)) {
                            $table->setAttribute('border', '1');
                            break;
                        }
                    }
                }

                // If the author already set explicit column widths (on <col> or
                // on any cell), respect them and leave the table alone.
                $explicit = false;
                foreach ($xp->query('.//col', $table) as $col) {
                    if ($hasRealWidth($col->getAttribute('style'))) { $explicit = true; break; }
                }
                if (!$explicit) {
                    foreach ($xp->query('.//td|.//th', $table) as $cell) {
                        if ($hasRealWidth($cell->getAttribute('style'))) { $explicit = true; break; }
                    }
                }
                if ($explicit) continue;

                // Table itself: full width + fixed layout.
                $tStyle = $table->getAttribute('style');
                if (!$hasRealWidth($tStyle)) $tStyle = trim($tStyle . ';width:100%', '; ');
                if (stripos($tStyle, 'table-layout') === false) $tStyle = trim($tStyle . ';table-layout:fixed', '; ');
                $table->setAttribute('style', $tStyle);

                // Stamp an equal width on every cell (× colspan). This is what
                // PhpWord actually reads to size the columns. The width MUST be a
                // whole-number percent — PhpWord's percent parser mangles decimals
                // (33.3333% → 3333%, 33.0% → 0%), so use an integer share. Exact
                // sum-to-100 is irrelevant: the widths only set the column RATIO
                // and the table itself is pinned to 100% of the page.
                $perCol = max(1, (int) round(100 / $maxCols));
                foreach ($xp->query('.//tr', $table) as $tr) {
                    foreach ($xp->query('td|th', $tr) as $cell) {
                        $span = max(1, (int) ($cell->getAttribute('colspan') ?: 1));
                        $w    = $perCol * $span;
                        $cs   = preg_replace('/(?<!-)\bwidth\s*:[^;]*;?/i', '', $cell->getAttribute('style'));
                        $cell->setAttribute('style', trim('width:' . $w . '%;' . $cs, '; '));
                    }
                }

                // Also normalise the <colgroup> (cosmetic — PhpWord ignores it,
                // but keeps the markup self-consistent for other consumers).
                foreach ($xp->query('colgroup', $table) as $cg) {
                    $cols = $xp->query('col', $cg);
                    if ($cols->length) {
                        $per = max(1, (int) round(100 / $cols->length));
                        foreach ($cols as $col) $col->setAttribute('style', 'width:' . $per . '%');
                    }
                }
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

    /**
     * Repair schema-INVALID OOXML that PhpWord's Word2007 writer can emit from
     * editor HTML, which makes the .docx corrupt — Word opens it as a single
     * recovered line and Google Docs rejects it ("unexpected error"). Rewrites
     * document.xml + any header/footer parts in-place inside the .docx zip:
     *
     *   0. Control characters XML forbids outright, and invalid UTF-8. Neither
     *      can be escaped into legality; they have to go. They come in with
     *      content pasted from PDFs and legacy Word files.
     *   1. Bare `&` (PhpWord leaves ampersands decoded from HTML entities
     *      unescaped) → `&amp;`. This is the fatal one: it makes the XML
     *      non-well-formed, so the whole document fails to parse.
     *   2. Fractional `w:sz` / `w:szCs` (from a px→pt font-size conversion,
     *      e.g. 19.6) → nearest integer. Half-points must be whole numbers.
     *   3. Border `w:color` that isn't 6-hex or `auto` (PhpWord maps a CSS
     *      `solid` border keyword into the colour slot) → `auto`.
     */
    protected function sanitizeDocxXml(string $docxPath, ?int $usableTwips = null): void
    {
        if (!class_exists('ZipArchive')) return;
        $zip = new \ZipArchive();
        if ($zip->open($docxPath) !== true) return;
        $parts = [
            'word/document.xml',
            'word/header1.xml', 'word/header2.xml', 'word/header3.xml',
            'word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml',
        ];
        foreach ($parts as $name) {
            $xml = $zip->getFromName($name);
            if ($xml === false || $xml === '') continue;
            $fixed = $this->sanitizeOoxmlString($xml);
            // Stretch body tables to the page width (document.xml only — leave
            // header/footer layout tables alone). Runs after the & escape so the
            // XML is well-formed enough to parse.
            if ($name === 'word/document.xml' && $usableTwips) {
                $fixed = $this->fitTablesToWidthDom($fixed, $usableTwips);
            }
            if ($fixed !== $xml) $zip->addFromString($name, $fixed);
        }
        $zip->close();
    }

    /**
     * Force every table in document.xml to fill the page's usable width, so the
     * user never has to hand-drag columns in Word.
     *
     * PhpWord emits `tblLayout=autofit` with a narrow grid, so Word shrinks the
     * table to its content instead of the page. We switch to a FIXED layout and
     * rewrite the grid + each cell width to equal, absolute (dxa) columns that
     * sum to the usable width — a fixed-layout table with a full-width grid
     * renders edge-to-edge, empty cells included, in any page size/orientation.
     * Cell colspans (w:gridSpan) get a proportionally wider width.
     */
    protected function fitTablesToWidthDom(string $xml, int $usableTwips): string
    {
        if (stripos($xml, '<w:tbl>') === false && stripos($xml, '<w:tbl ') === false) return $xml;
        $prev = libxml_use_internal_errors(true);
        try {
            $dom = new \DOMDocument();
            if (!$dom->loadXML($xml)) return $xml;
            $xp = new \DOMXPath($dom);
            $xp->registerNamespace('w', self::W_NS);

            foreach ($xp->query('//w:tbl') as $tbl) {
                $grid = $xp->query('w:tblGrid', $tbl)->item(0);
                if (!$grid) continue;
                $cols = $xp->query('w:gridCol', $grid);
                $n = $cols->length;
                if ($n < 1) continue;
                // Leave a small buffer under the usable width: a table pinned to
                // EXACTLY the text width draws its right-hand border on the margin,
                // which the page then clips ("last column border cut"). ~160 twips
                // (~0.11") keeps the whole grid + borders inside the margin.
                $fitTwips = max(2000, $usableTwips - 160);
                $colW  = max(1, intdiv($fitTwips, $n));
                $total = $colW * $n;

                // Equal grid columns (absolute).
                foreach ($cols as $gc) $gc->setAttributeNS(self::W_NS, 'w:w', (string) $colW);

                // Table preferred width = full usable, and FIXED layout so Word
                // honours the grid rather than shrinking to content.
                $tblPr = $xp->query('w:tblPr', $tbl)->item(0);
                if ($tblPr) {
                    $tw = $xp->query('w:tblW', $tblPr)->item(0);
                    if (!$tw) { $tw = $dom->createElementNS(self::W_NS, 'w:tblW'); $tblPr->appendChild($tw); }
                    $tw->setAttributeNS(self::W_NS, 'w:w', (string) $total);
                    $tw->setAttributeNS(self::W_NS, 'w:type', 'dxa');

                    $tl = $xp->query('w:tblLayout', $tblPr)->item(0);
                    if (!$tl) { $tl = $dom->createElementNS(self::W_NS, 'w:tblLayout'); $tblPr->appendChild($tl); }
                    $tl->setAttributeNS(self::W_NS, 'w:type', 'fixed');
                }

                // Each cell width = span × column width (absolute), overriding the
                // relative pct widths PhpWord wrote.
                foreach ($xp->query('.//w:tc', $tbl) as $tc) {
                    $tcPr = $xp->query('w:tcPr', $tc)->item(0);
                    if (!$tcPr) continue;
                    $span = 1;
                    $gs = $xp->query('w:gridSpan', $tcPr)->item(0);
                    if ($gs) $span = max(1, (int) $gs->getAttributeNS(self::W_NS, 'val'));
                    $tcW = $xp->query('w:tcW', $tcPr)->item(0);
                    if (!$tcW) { $tcW = $dom->createElementNS(self::W_NS, 'w:tcW'); $tcPr->insertBefore($tcW, $tcPr->firstChild); }
                    $tcW->setAttributeNS(self::W_NS, 'w:w', (string) ($colW * $span));
                    $tcW->setAttributeNS(self::W_NS, 'w:type', 'dxa');
                }
            }
            $out = $dom->saveXML();
            return $out !== false ? $out : $xml;
        } catch (\Throwable $e) {
            return $xml;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
        }
    }

    /** Apply the three OOXML repairs (see sanitizeDocxXml) to one XML part. */
    protected function sanitizeOoxmlString(string $xml): string
    {
        /* 0) Characters XML 1.0 does not allow AT ALL.
              Control codes below 0x20 (except tab, LF, CR) are illegal in XML,
              full stop — no escaping makes them legal. One of them anywhere in
              the file and every reader, Word included, refuses the document
              with a generic "there is a problem with its contents".
              They arrive from content pasted out of PDFs and legacy Word files,
              which is exactly the "upload a doc, then download it" path this
              was reported on, and they survive every step because nothing else
              looks at them.
              Invalid UTF-8 is dropped for the same reason: a broken byte
              sequence is not a character, and the parser stops at it. */
        $xml = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string) $xml) ?? $xml;
        if (!mb_check_encoding($xml, 'UTF-8')) {
            $xml = mb_convert_encoding($xml, 'UTF-8', 'UTF-8');
        }

        // 1) Escape bare ampersands (anything not already a valid entity).
        $xml = preg_replace('/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/', '&amp;', (string) $xml);

        /* 2) Numeric attributes that are not whole numbers, or that still carry
              a CSS unit.
              OOXML measurements are integers -- twips, half-points, eighths of
              a point -- and Word rejects the WHOLE file on a single bad value
              with "we found a problem with its contents", naming nothing. They
              get in because PhpWord converts CSS to OOXML by arithmetic: a
              line-height of 1.5, a row height in px, a percentage column width
              each divide into a fraction, and a unit PhpWord does not
              recognise is passed through as written.
              This used to round only w:sz / w:szCs, the one case that had been
              hit. Every numeric w:* attribute is covered now, because the next
              style added to the editor produces the next one.
              A non-numeric value is left alone: w:val also carries keywords
              (w:jc w:val="center") that must not be touched. */
        $xml = preg_replace_callback(
            '/\b(w:[a-zA-Z]+)="(-?\d+(?:\.\d+)?)(px|pt|pc|in|cm|mm|em|rem|%)?"/',
            function ($m) {
                $attr = $m[1];
                $num  = $m[2];
                $unit = $m[3] ?? '';
                if ($unit === '' && strpos($num, '.') === false) return $m[0];
                return $attr . '="' . (string) max(0, (int) round((float) $num)) . '"';
            },
            (string) $xml
        );

        // 3) Invalid border colours → auto (runs use <w:color w:val="…"> and
        //    are untouched; this only matches the w:color="…" attribute form).
        $xml = preg_replace_callback(
            '/\bw:color="([^"]*)"/',
            function ($m) {
                $v = $m[1];
                return ($v === 'auto' || preg_match('/^[0-9A-Fa-f]{6}$/', $v)) ? $m[0] : 'w:color="auto"';
            },
            (string) $xml
        );

        return (string) $xml;
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
