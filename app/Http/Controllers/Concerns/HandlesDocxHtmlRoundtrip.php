<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpWord\IOFactory;

trait HandlesDocxHtmlRoundtrip
{
    protected function normaliseEditorHtml(string $html): string
    {
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

        $html = preg_replace(
            '/\bbackground\s*:\s*(rgb\([^)]*\)|#[0-9a-fA-F]{3,6})/i',
            'background-color:$1',
            (string) $html
        );

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

        $html = preg_replace_callback(
            '/<a\b([^>]*)>/i',
            function ($m) {
                $attrs = $m[1];
                if (preg_match('/\bstyle\s*=\s*"([^"]*)"/i', $attrs, $sm)) {
                    if (preg_match('/color\s*:/i', $sm[1])) return $m[0];
                    $newStyle = rtrim($sm[1], "; \t") . ';color:#0563C1;text-decoration:underline';
                    return '<a' . preg_replace('/\bstyle\s*=\s*"[^"]*"/i', 'style="' . $newStyle . '"', $attrs) . '>';
                }
                return '<a' . $attrs . ' style="color:#0563C1;text-decoration:underline">';
            },
            (string) $html
        );

        return (string) $html;
    }

    protected function renderLimitWithMargin(int $max): int
    {
        return (int) round($max * 1.02);
    }

    protected function htmlTextLength(?string $html): int
    {
        $html = (string) $html;
        if ($html === '') return 0;
        $spaced = preg_replace('#<br\s*/?>#i', "\n", $html);
        $spaced = preg_replace('#</(p|div|h[1-6]|li|tr|blockquote|pre)>#i', "\n", (string) $spaced);
        $text = html_entity_decode(strip_tags((string) $spaced), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        return mb_strlen(trim($text));
    }

    protected function docxToHtml(string $absPath): string
    {
        $direct = $this->docxBodyToHtml($absPath);
        if ($direct !== null) return $direct;

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

        $html = '';
        foreach ($phpWord->getSections() as $section) {
            foreach ($section->getElements() as $el) {
                $html .= $this->elementToHtml($el);
            }
        }
        return trim($html) ?: '<p></p>';
    }

    private const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    protected const DOCX_MAX_PAGES = 70;

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
        return $n > 1 ? $n : null;
    }

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

    private function xmlRunParts(\DOMElement $r, \DOMXPath $xp): ?array
    {
        $b  = $xp->query('w:rPr/w:b', $r)->length > 0;
        $i  = $xp->query('w:rPr/w:i', $r)->length > 0;
        $uN = $xp->query('w:rPr/w:u', $r);
        $u  = $uN->length > 0 && $uN->item(0)->getAttributeNS(self::W_NS, 'val') !== 'none';
        $colorN = $xp->query('w:rPr/w:color', $r);
        $color  = $colorN->length ? $colorN->item(0)->getAttributeNS(self::W_NS, 'val') : '';
        if ($color === 'auto' || !preg_match('/^[0-9A-Fa-f]{6}$/', (string) $color)) $color = '';

        $out = '';
        foreach ($r->childNodes as $c) {
            if ($c->localName === 't')        $out .= htmlspecialchars($c->textContent, ENT_QUOTES);
            elseif ($c->localName === 'br')   $out .= '<br>';
            elseif ($c->localName === 'tab')  $out .= ' &nbsp;&nbsp; ';
        }
        if ($out === '') return null;

        $fmt = ['b' => $b, 'i' => $i, 'u' => $u, 'color' => $color];
        return ['sig' => ($b ? 'b' : '') . ($i ? 'i' : '') . ($u ? 'u' : '') . '|' . $color, 'text' => $out, 'fmt' => $fmt];
    }

    private function wrapRunText(string $text, array $fmt): string
    {
        if ($text === '') return '';
        if ($fmt['b']) $text = "<b>{$text}</b>";
        if ($fmt['i']) $text = "<i>{$text}</i>";
        if ($fmt['u']) $text = "<u>{$text}</u>";
        if ($fmt['color'] !== '') $text = '<span style="color:#' . $fmt['color'] . '">' . $text . '</span>';
        return $text;
    }

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

        $inner   = '';
        $pending = null;
        $flush   = function () use (&$inner, &$pending) {
            if ($pending === null) return;
            $inner  .= $this->wrapRunText($pending['text'], $pending['fmt']);
            $pending = null;
        };
        $take = function (\DOMElement $r) use ($xp, &$pending, $flush) {
            $part = $this->xmlRunParts($r, $xp);
            if ($part === null) return;
            if ($pending !== null && $pending['sig'] === $part['sig']) {
                $pending['text'] .= $part['text'];
                return;
            }
            $flush();
            $pending = $part;
        };
        foreach ($p->childNodes as $c) {
            if ($c->localName === 'r')             $take($c);
            elseif ($c->localName === 'br')        { $flush(); $inner .= '<br>'; }
            elseif ($c->localName === 't')         { $flush(); $inner .= htmlspecialchars($c->textContent, ENT_QUOTES); }
            elseif ($c->localName === 'hyperlink') {
                foreach ($c->childNodes as $hc) {
                    if ($hc->localName === 'r') $take($hc);
                }
            }
        }
        $flush();
        if (trim(strip_tags($inner)) === '' && strpos($inner, '<br') === false) return '';

        $styleAttr = $align !== '' ? ' style="text-align:' . $align . '"' : '';
        if (strpos($style, 'heading1') !== false || strpos($style, 'title') !== false) return "<h1{$styleAttr}>{$inner}</h1>";
        if (strpos($style, 'heading2') !== false) return "<h2{$styleAttr}>{$inner}</h2>";
        if (strpos($style, 'heading')  !== false) return "<h3{$styleAttr}>{$inner}</h3>";
        return "<p{$styleAttr}>{$inner}</p>";
    }

    private function xmlTableToHtml(\DOMElement $t, \DOMXPath $xp): string
    {
        $colWidths = [];
        foreach ($xp->query('w:tblGrid/w:gridCol', $t) as $gc) {
            $w = (int) $gc->getAttributeNS(self::W_NS, 'w');
            $colWidths[] = $w > 0 ? $w : 1;
        }
        $totalW = array_sum($colWidths);
        $pcts   = [];
        if ($totalW > 0) foreach ($colWidths as $w) $pcts[] = round($w / $totalW * 100, 2);

        $colgroup = '';
        if ($pcts) {
            $colgroup = '<colgroup>';
            foreach ($pcts as $pct) $colgroup .= '<col style="width:' . $pct . '%" />';
            $colgroup .= '</colgroup>';
        }

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
                $span = 1;
                $gs = $xp->query('w:tcPr/w:gridSpan', $tc);
                if ($gs->length) $span = max(1, (int) $gs->item(0)->getAttributeNS(self::W_NS, 'val'));
                $wPct = 0.0;
                for ($k = 0; $k < $span; $k++) $wPct += $pcts[$colIdx + $k] ?? 0;
                $colIdx += $span;

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
                if ($tblBordered) $styleBits[] = 'border:1px solid #cbd5e1';
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

        $thead = '';
        $bodyRows = $rowsHtml;
        if (!empty($rowIsHeader) && $rowIsHeader[0] && count($rowsHtml) > 1) {
            $thead    = '<thead>' . array_shift($bodyRows) . '</thead>';
        }
        $tbody = '<tbody>' . implode('', $bodyRows) . '</tbody>';

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
                $u = method_exists($f, 'getUnderline') ? $f->getUnderline() : null;
                if ($u && $u !== 'none') $text = "<u>{$text}</u>";
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

    protected function applyDocxHeaderFooter($section, array $headerCfg, array $footerCfg, ?string $logoAbsPath): void
    {
        $align = static function ($a, string $fallback): string {
            return in_array($a, ['left', 'center', 'right', 'both'], true) ? $a : $fallback;
        };
        $hex = static function ($c, string $fallback): string {
            $c = ltrim((string) $c, '#');
            return preg_match('/^[0-9a-fA-F]{6}$/', $c) ? strtoupper($c) : $fallback;
        };

        $showLogo  = $headerCfg['show_logo']  ?? true;
        $showTitle = $headerCfg['show_title'] ?? true;
        if ($showLogo || $showTitle) {
            $header = $section->addHeader();
            $hAlign = $align($headerCfg['align'] ?? 'right', 'right');
            $logoX = $headerCfg['logo_pos']['x'] ?? null;
            if (is_numeric($logoX)) {
                $logoX = max(0, min(100, (float) $logoX));
                $logoAlign = $logoX < 34 ? 'left' : ($logoX > 66 ? 'right' : 'center');
            } else {
                $logoAlign = $align($headerCfg['logo_align'] ?? null, 'left');
            }

            $title = trim((string) ($headerCfg['title'] ?? ''));
            $sub   = trim((string) ($headerCfg['subtitle'] ?? ''));
            $color = $hex($headerCfg['text_color'] ?? null, '111827');
            $hasLogo = $showLogo && $logoAbsPath && is_file($logoAbsPath);
            $hasText = $showTitle && ($title !== '' || $sub !== '');

            if ($hasLogo && $hasText) {
                $usable = 11906 - (2 * 1440);
                $t = $header->addTable([
                    'borderSize' => 0, 'cellMargin' => 0,
                    'unit'   => \PhpOffice\PhpWord\SimpleType\TblWidth::TWIP,
                    'width'  => $usable,
                    'layout' => \PhpOffice\PhpWord\Style\Table::LAYOUT_FIXED,
                ]);
                $r = $t->addRow();
                $logoW     = (int) round($usable * 0.40);
                $logoCell  = $r->addCell($logoW, ['valign' => 'center', 'noWrap' => false]);
                $titleCell = $r->addCell($usable - $logoW, ['valign' => 'center', 'noWrap' => false]);
                try {
                    $logoCell->addImage($logoAbsPath, \App\Services\HrTemplateDocxRenderer::logoFitStyle(
                        $logoAbsPath,
                        (int) ($headerCfg['logo_height'] ?? 62),
                        $logoW,
                    ) + ['alignment' => $logoAlign]);
                } catch (\Throwable $e) { }
                if ($title !== '') {
                    $titleCell->addText(htmlspecialchars($title, ENT_QUOTES), ['bold' => true, 'size' => 12, 'color' => $color], ['alignment' => $hAlign]);
                }
                if ($sub !== '') {
                    $titleCell->addText(htmlspecialchars($sub, ENT_QUOTES), ['size' => 9, 'color' => '888888'], ['alignment' => $hAlign]);
                }
            } else {
                if ($hasLogo) {
                    try {
                        $header->addImage($logoAbsPath, [
                            'height'    => (int) ($headerCfg['logo_height'] ?? 62),
                            'alignment' => $logoAlign,
                        ]);
                    } catch (\Throwable $e) { }
                }
                if ($hasText) {
                    if ($title !== '') {
                        $header->addText(htmlspecialchars($title, ENT_QUOTES), ['bold' => true, 'size' => 12, 'color' => $color], ['alignment' => $hAlign]);
                    }
                    if ($sub !== '') {
                        $header->addText(htmlspecialchars($sub, ENT_QUOTES), ['size' => 9, 'color' => '888888'], ['alignment' => $hAlign]);
                    }
                }
            }
        }

        $footerText = trim((string) ($footerCfg['text'] ?? ''));
        $showPage   = $footerCfg['show_page_number'] ?? true;
        if ($footerText !== '' || $showPage) {
            $footer = $section->addFooter();
            $fColor = $hex($footerCfg['text_color'] ?? null, '6B7280');
            if ($footerText !== '') {
                $footer->addText(htmlspecialchars($footerText, ENT_QUOTES), ['size' => 9, 'color' => $fColor], ['alignment' => $align($footerCfg['align'] ?? 'center', 'center')]);
            }
            if ($showPage) {
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

    protected function docxUsableWidthTwips(\Illuminate\Http\Request $request): int
    {
        $s = $this->docxPageStyle($request);
        return max(2000, (int) $s['pageSizeW'] - 2 * self::DOCX_SIDE_MARGIN);
    }

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
            $hasRealWidth = static function (string $style): bool {
                return (bool) preg_match('/(?<!-)\bwidth\s*:/i', $style);
            };

            $xp = new \DOMXPath($doc);
            foreach ($xp->query('//table') as $table) {
                $maxCols = 0;
                foreach ($xp->query('.//tr', $table) as $tr) {
                    $cols = 0;
                    foreach ($xp->query('td|th', $tr) as $cell) {
                        $cols += max(1, (int) ($cell->getAttribute('colspan') ?: 1));
                    }
                    $maxCols = max($maxCols, $cols);
                }
                if ($maxCols < 1) continue;

                if (!$table->hasAttribute('border')) {
                    foreach ($xp->query('.//td|.//th', $table) as $cell) {
                        $cs = $cell->getAttribute('style');
                        if (preg_match('/\bborder(-top|-right|-bottom|-left)?\s*:\s*(?!\s*(none|0|hidden))[^;]*\b(1px|2px|solid|thin|medium|double)\b/i', $cs)) {
                            $table->setAttribute('border', '1');
                            break;
                        }
                    }
                }

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

                $tStyle = $table->getAttribute('style');
                if (!$hasRealWidth($tStyle)) $tStyle = trim($tStyle . ';width:100%', '; ');
                if (stripos($tStyle, 'table-layout') === false) $tStyle = trim($tStyle . ';table-layout:fixed', '; ');
                $table->setAttribute('style', $tStyle);

                $perCol = max(1, (int) round(100 / $maxCols));
                foreach ($xp->query('.//tr', $table) as $tr) {
                    foreach ($xp->query('td|th', $tr) as $cell) {
                        $span = max(1, (int) ($cell->getAttribute('colspan') ?: 1));
                        $w    = $perCol * $span;
                        $cs   = preg_replace('/(?<!-)\bwidth\s*:[^;]*;?/i', '', $cell->getAttribute('style'));
                        $cell->setAttribute('style', trim('width:' . $w . '%;' . $cs, '; '));
                    }
                }

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

    protected function addHtmlResilient($section, string $bodyHtml): void
    {
        $whole = '<!DOCTYPE html><html><body>' . $bodyHtml . '</body></html>';
        $before = count($section->getElements());
        try {
            \PhpOffice\PhpWord\Shared\Html::addHtml($section, $whole, true, false);
            if (count($section->getElements()) > $before) return;
        } catch (\Throwable $e) {
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
            if ($name === 'word/document.xml' && $usableTwips) {
                $fixed = $this->fitTablesToWidthDom($fixed, $usableTwips);
            }
            if ($fixed !== $xml) $zip->addFromString($name, $fixed);
        }
        $zip->close();
    }

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
                $fitTwips = max(2000, $usableTwips - 160);
                $colW  = max(1, intdiv($fitTwips, $n));
                $total = $colW * $n;

                foreach ($cols as $gc) $gc->setAttributeNS(self::W_NS, 'w:w', (string) $colW);

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

    protected function sanitizeOoxmlString(string $xml): string
    {
        $xml = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string) $xml) ?? $xml;
        if (!mb_check_encoding($xml, 'UTF-8')) {
            $xml = mb_convert_encoding($xml, 'UTF-8', 'UTF-8');
        }

        $xml = preg_replace('/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/', '&amp;', (string) $xml);

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

    protected static function docxLogoFile(?string $path): ?string
    {
        $path = trim((string) $path);
        if ($path === '') return null;

        foreach (array_unique([(string) config('filesystems.default'), 'public']) as $name) {
            try {
                $disk = Storage::disk($name);
                if (!$disk->exists($path)) continue;

                try {
                    $local = $disk->path($path);
                    if (is_string($local) && is_file($local)) return $local;
                } catch (\Throwable $e) { }

                $bytes = $disk->get($path);
                if ($bytes === null) continue;
                $ext = pathinfo($path, PATHINFO_EXTENSION) ?: 'png';
                $tmp = tempnam(sys_get_temp_dir(), 'clm_logo_') . '.' . $ext;
                file_put_contents($tmp, $bytes);
                return $tmp;
            } catch (\Throwable $e) { }
        }
        return null;
    }
}
