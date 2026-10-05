<?php

namespace App\Support;

/**
 * Repairs for rich-text HTML on its way into dompdf.
 *
 * The CLM editors hand dompdf whatever the user's document body contains, and
 * dompdf is far stricter about table markup than a browser is. A `<td>`, `<tr>`
 * or `<tbody>` that is not inside a `<table>` makes it throw
 *
 *     Dompdf\Exception: Parent table not found for table cell
 *
 * from FrameReflower/TableCell, which surfaces as a bare 500 and the modal's
 * "Preview failed · Server Error" with nothing to act on. (QA #67 — Lead →
 * Stage 5 → Send TD for signature.)
 *
 * Orphans are easy to create and invisible in the editor, which renders them
 * exactly like a browser does: deleting the row around a cell, pasting a
 * fragment of a table out of Word or another document, or an undo that takes
 * the wrapper but leaves its contents.
 */
class PdfHtml
{
    /** Tags that may only live inside a table. */
    private const PARTS = ['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup', 'col'];

    /**
     * Wrap any run of table markup that is sitting outside a `<table>` in one.
     *
     * Wrapping, not stripping: the orphan is the user's content — a row of
     * figures they can see on screen — so it has to reach the PDF. Dropping it
     * would turn a crash into silently missing data, which is worse for a
     * document somebody is about to put a signature on.
     *
     * Only the orphans are touched. Well-formed tables, and table tags nested
     * inside a table that is itself inside another, are left exactly as they
     * are.
     */
    public static function repairTableMarkup(?string $html): string
    {
        $html = (string) $html;
        if ($html === '' || !preg_match('/<\s*(td|th|tr|tbody|thead|tfoot)\b/i', $html)) {
            return $html;
        }

        // Keep the tags as tokens so the text between them travels with the run
        // it belongs to.
        $tokens = preg_split('/(<\/?[a-zA-Z][^>]*>)/s', $html, -1, PREG_SPLIT_DELIM_CAPTURE);
        if ($tokens === false) return $html;

        $out        = '';
        $depth      = 0;      // how many <table> elements we are inside
        $run        = '';     // orphaned table markup collected at depth 0
        $inRun      = false;

        $closeRun = function () use (&$out, &$run, &$inRun) {
            if ($inRun) {
                // rtrim so trailing whitespace between the orphan and whatever
                // follows it stays outside the table we just invented.
                $out  .= '<table>' . rtrim($run) . '</table>';
                $run   = '';
                $inRun = false;
            }
        };

        foreach ($tokens as $tok) {
            if ($tok === '') continue;

            // Plain text — belongs to whichever side is currently collecting.
            if ($tok[0] !== '<') {
                if ($inRun) { $run .= $tok; } else { $out .= $tok; }
                continue;
            }

            if (!preg_match('/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/', $tok, $m)) {
                if ($inRun) { $run .= $tok; } else { $out .= $tok; }
                continue;
            }
            $closing = $m[1] === '/';
            $name    = strtolower($m[2]);

            if ($name === 'table') {
                // A real table starts here (or ends): never part of an orphan run.
                $closeRun();
                $depth = $closing ? max(0, $depth - 1) : $depth + 1;
                $out  .= $tok;
                continue;
            }

            $isPart = in_array($name, self::PARTS, true);

            if ($depth > 0) {
                // Inside a table everything is already legal.
                $out .= $tok;
                continue;
            }

            if ($isPart) {
                $inRun = true;
                $run  .= $tok;
                continue;
            }

            /* A non-table tag at top level ends the run — except for inline
               formatting, which routinely sits between cells (a <br> or a
               <span> the editor left behind) and would otherwise cut one
               orphan run into several tables. */
            if ($inRun && in_array($name, ['br', 'span', 'b', 'i', 'u', 'em', 'strong', 'a', 'img', 'font', 'sup', 'sub', 'small'], true)) {
                $run .= $tok;
                continue;
            }
            $closeRun();
            $out .= $tok;
        }
        $closeRun();

        return $out;
    }
}
