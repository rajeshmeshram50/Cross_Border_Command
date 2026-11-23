<?php

namespace App\Support;

class PdfHtml
{
    private const PARTS = ['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup', 'col'];

    public static function repairTableMarkup(?string $html): string
    {
        $html = (string) $html;
        if ($html === '' || !preg_match('/<\s*(td|th|tr|tbody|thead|tfoot)\b/i', $html)) {
            return $html;
        }

        $tokens = preg_split('/(<\/?[a-zA-Z][^>]*>)/s', $html, -1, PREG_SPLIT_DELIM_CAPTURE);
        if ($tokens === false) return $html;

        $out        = '';
        $depth      = 0;
        $run        = '';
        $inRun      = false;

        $closeRun = function () use (&$out, &$run, &$inRun) {
            if ($inRun) {
                $out  .= '<table>' . rtrim($run) . '</table>';
                $run   = '';
                $inRun = false;
            }
        };

        foreach ($tokens as $tok) {
            if ($tok === '') continue;

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
                $closeRun();
                $depth = $closing ? max(0, $depth - 1) : $depth + 1;
                $out  .= $tok;
                continue;
            }

            $isPart = in_array($name, self::PARTS, true);

            if ($depth > 0) {
                $out .= $tok;
                continue;
            }

            if ($isPart) {
                $inRun = true;
                $run  .= $tok;
                continue;
            }

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
