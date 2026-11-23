<?php

namespace App\Support;

class PdfHighlight
{
    private const INLINE = ['span', 'mark', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'sub', 'sup', 'code', 'font', 'small', 'big'];

    private const BG = '/background(?:-color)?\s*:\s*([^;]+)/i';

    public static function fix(?string $html): string
    {
        $html = (string) $html;
        if ($html === '' || stripos($html, 'background') === false) return $html;

        $doc = new \DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $ok = $doc->loadHTML(
            '<?xml encoding="UTF-8"?><div id="__pdfhl">' . $html . '</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
        );
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$ok) return $html;

        $xp = new \DOMXPath($doc);
        $root = $xp->query('//*[@id="__pdfhl"]')->item(0);
        if (!$root) return $html;

        $targets = [];
        foreach ($xp->query('.//*[@style]', $root) as $el) {
            if (in_array(strtolower($el->nodeName), self::INLINE, true) && self::colour($el) !== null) {
                $targets[] = $el;
            }
        }
        if (!$targets) return $html;

        foreach ($targets as $el) {
            $colour = self::colour($el);
            if ($colour === null) continue;

            $texts = [];
            foreach ($xp->query('.//text()', $el) as $t) {
                if (trim($t->nodeValue) === '') continue;
                if (self::nearestHighlight($t, $el) !== $el) continue;
                $texts[] = $t;
            }
            foreach ($texts as $t) {
                $wrap = $doc->createElement('span');
                $wrap->setAttribute('style', 'background-color: ' . $colour);
                $t->parentNode->replaceChild($wrap, $t);
                $wrap->appendChild($t);
            }
            $el->setAttribute('style', self::transparent((string) $el->getAttribute('style')));
        }

        $out = '';
        foreach ($root->childNodes as $child) $out .= $doc->saveHTML($child);
        return $out;
    }

    private static function colour(\DOMElement $el): ?string
    {
        if (!preg_match(self::BG, (string) $el->getAttribute('style'), $m)) return null;
        $v = trim($m[1]);
        if ($v === '' || preg_match('/^(transparent|none|initial|inherit|unset)$/i', $v)) return null;
        if (preg_match('/gradient|url\(/i', $v)) return null;
        return $v;
    }

    private static function nearestHighlight(\DOMNode $node, \DOMElement $limit): ?\DOMElement
    {
        for ($p = $node->parentNode; $p instanceof \DOMElement; $p = $p->parentNode) {
            if ($p === $limit) return $limit;
            if (in_array(strtolower($p->nodeName), self::INLINE, true) && self::colour($p) !== null) return $p;
        }
        return null;
    }

    private static function transparent(string $style): string
    {
        return rtrim(preg_replace(self::BG, 'background-color: transparent', $style), '; ') . ';';
    }
}
