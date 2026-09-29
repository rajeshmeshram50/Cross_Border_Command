<?php

namespace App\Support;

/**
 * Makes editor text highlights render where the text is in a dompdf PDF.
 *
 * dompdf paints an inline element's background from where the element started
 * BEFORE the line was aligned, whenever that element opens with another tag
 * rather than text. The editor writes a highlighted bold heading exactly that
 * way — <span style="background-color:…"><strong>Title</strong></span> — so in
 * a centred (or right-aligned) paragraph the colour sat at the left margin as
 * a bar of the text's width, with the text centred beside it. Measured on the
 * live agreement A-002: box at x=34pt, text at x=225pt.
 *
 * An inline element whose only child is its text is placed correctly, so the
 * colour is moved down onto each piece of text: every text node under a
 * highlighted element is wrapped in its own <span> carrying the colour, and
 * the element itself is made transparent (not merely unstyled — dompdf gives
 * <mark> a yellow default). The page looks the same; only where dompdf draws
 * the box changes.
 */
class PdfHighlight
{
    /** Inline tags the editor can put a highlight on. Block-level fills (table
     *  cells, paragraphs) are painted from the block's own box and are fine. */
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

        // Outermost first, so a highlight nested inside another keeps its own
        // colour: its text is skipped by the outer pass (see ownColour()).
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
                // Text inside a nested highlight belongs to that highlight.
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

    /** The highlight colour on an element, or null when it has none. */
    private static function colour(\DOMElement $el): ?string
    {
        if (!preg_match(self::BG, (string) $el->getAttribute('style'), $m)) return null;
        $v = trim($m[1]);
        if ($v === '' || preg_match('/^(transparent|none|initial|inherit|unset)$/i', $v)) return null;
        // Only a plain colour — a gradient or url() is left for dompdf as-is.
        if (preg_match('/gradient|url\(/i', $v)) return null;
        return $v;
    }

    /** Closest highlighted ancestor of $node, stopping at $limit. */
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
