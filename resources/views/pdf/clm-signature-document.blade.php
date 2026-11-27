@php

  $documentTitle = $document->title ?? $document->name ?? 'Document';
  $clientName = trim((string) ($client->org_name ?? 'Cross Border Command'));

  $hcfg = is_array($headerConfig ?? null) ? $headerConfig : [];
  $headerTitle = (string) ($hcfg['title'] ?? $clientName);
  $headerSubtitle = (string) ($hcfg['subtitle'] ?? '');
  $headerAlign = (string) ($hcfg['align'] ?? 'right');
  $headerBg = (string) ($hcfg['background'] ?? '#ffffff');
  $headerColor = (string) ($hcfg['text_color'] ?? '#111827');
  $headerShowLogo = array_key_exists('show_logo', $hcfg) ? (bool) $hcfg['show_logo'] : true;
  $headerShowTitle = array_key_exists('show_title', $hcfg) ? (bool) $hcfg['show_title'] : true;
  $headerLogoHeight = (int) ($hcfg['logo_height'] ?? 62);

  $pcfg = is_array($pageConfig ?? null) ? $pageConfig : [];
  $marginX = (int) max(10, min(60, $pcfg['margin_x'] ?? 25));
  $marginL = (int) max(10, min(60, $pcfg['margin_left'] ?? $marginX));
  $marginR = (int) max(10, min(60, $pcfg['margin_right'] ?? $marginX));
  $logoX  = isset($hcfg['logo_pos']['x'])  ? (float) $hcfg['logo_pos']['x']  : 10.0;
  $titleX = isset($hcfg['title_pos']['x']) ? (float) $hcfg['title_pos']['x'] : 88.0;
  $logoX  = max(0.0, min(100.0, $logoX));
  $titleX = max(0.0, min(100.0, $titleX));
  $logoOnLeft = $logoX <= $titleX;
  $firstX  = $logoOnLeft ? $logoX  : $titleX;
  $secondX = $logoOnLeft ? $titleX : $logoX;
  $splitPct = max(25.0, min(75.0, ($firstX + $secondX) / 2));
  $alignIn = function (float $x, float $start, float $end): string {
    $span = max(1.0, $end - $start);
    $rel  = ($x - $start) / $span * 100.0;
    if ($rel <= 33.34) return 'left';
    if ($rel >= 66.66) return 'right';
    return 'center';
  };
  $firstAlign  = $alignIn($firstX, 0.0, $splitPct);
  $secondAlign = $alignIn($secondX, $splitPct, 100.0);
  $logoAlign   = $logoOnLeft ? $firstAlign  : $secondAlign;
  $titleAlign  = $logoOnLeft ? $secondAlign : $firstAlign;
  $logoMargin  = $logoAlign === 'right' ? '0 0 0 auto' : ($logoAlign === 'center' ? '0 auto' : '0');
  if ($headerAlign === 'space-between')
    $headerAlign = 'right';

  $fcfg = is_array($footerConfig ?? null) ? $footerConfig : [];
  $footerText = (string) ($fcfg['text'] ?? $clientName);
  $footerAlign = (string) ($fcfg['align'] ?? 'center');
  $footerBg = (string) ($fcfg['background'] ?? '#ffffff');
  $footerColor = (string) ($fcfg['text_color'] ?? '#6b7280');
  $showPageNumber = array_key_exists('show_page_number', $fcfg) ? (bool) $fcfg['show_page_number'] : true;
  $pageNumberAlign = (string) ($fcfg['page_number_align'] ?? 'right');
  $pageNumberFormat = (string) ($fcfg['page_number_format'] ?? 'Page N of M');

  if (!empty($processedHtml) && preg_match('/[\x{2190}-\x{21FF}\x{2500}-\x{25FF}]/u', $processedHtml)) {
    $processedHtml = preg_replace_callback('/>([^<]+)</u', function ($m) {
      $text = preg_replace(
        '/([\x{2190}-\x{21FF}\x{2500}-\x{25FF}]+)/u',
        '<span style="font-family: \'DejaVu Sans\', sans-serif">$1</span>',
        $m[1]
      );
      return '>' . $text . '<';
    }, $processedHtml);
  }

  if (!empty($processedHtml) && stripos($processedHtml, '<colgroup') !== false) {
    $processedHtml = preg_replace_callback('/(<table\b[^>]*>)(.*?)(<\/table>)/is', function ($m) {
      $inner = $m[2];
      if (!preg_match('/<colgroup\b[^>]*>(.*?)<\/colgroup>/is', $inner, $cg))
        return $m[0];
      if (!preg_match_all('/<col\b[^>]*>/is', $cg[1], $cols) || !count($cols[0]))
        return $m[0];

      $widths = [];
      foreach ($cols[0] as $col) {
        if (preg_match('/width\s*:\s*([\d.]+)\s*px/i', $col, $w))      $widths[] = (float) $w[1];
        elseif (preg_match('/width\s*=\s*"([\d.]+)"/i', $col, $w))      $widths[] = (float) $w[1];
        else                                                            $widths[] = 0.0;
      }
      $total = array_sum($widths);
      if ($total <= 0)
        return $m[0];

      $done = false;
      $newInner = preg_replace_callback('/<tr\b[^>]*>.*?<\/tr>/is', function ($rm) use (&$done, $widths, $total) {
        if ($done) return $rm[0];
        $done = true;
        $i = 0;
        return preg_replace_callback('/<(td|th)\b([^>]*)>/i', function ($cm) use (&$i, $widths, $total) {
          $span = preg_match('/colspan\s*=\s*"?(\d+)"?/i', $cm[2], $sp) ? max(1, (int) $sp[1]) : 1;
          $px = 0.0;
          for ($k = 0; $k < $span; $k++) $px += $widths[$i + $k] ?? 0.0;
          $i += $span;
          if ($px <= 0) return $cm[0];

          $pct   = round($px / $total * 100, 2) . '%';
          $attrs = $cm[2];
          if (preg_match('/style\s*=\s*"([^"]*)"/i', $attrs, $sm2)) {
            $style = preg_replace('/(^|;)\s*width\s*:[^;]*/i', '', $sm2[1]);
            $style = trim($style, "; \t\n\r") . '; width: ' . $pct;
            $attrs = str_replace($sm2[0], 'style="' . trim($style, '; ') . '"', $attrs);
          } else {
            $attrs .= ' style="width: ' . $pct . '"';
          }
          return '<' . $cm[1] . $attrs . '>';
        }, $rm[0]);
      }, $inner);

      $newInner = preg_replace('/<colgroup\b[^>]*>.*?<\/colgroup>/is', '', $newInner, 1);

      return $m[1] . $newInner . $m[3];
    }, $processedHtml);
  }

if (!empty($processedHtml) && stripos($processedHtml, '<table') !== false) {
    $processedHtml = preg_replace_callback('/(<table\b[^>]*>)(.*?)(<\/table>)/is', function ($m) {
      if (stripos($m[2], '<thead') !== false)
        return $m[0];
      $inner = $m[2];

      $lead = '';
      if (preg_match('/^\s*(?:<caption\b.*?<\/caption>\s*)?(?:<colgroup\b.*?<\/colgroup>\s*)?/is', $inner, $lm)
          && trim($lm[0]) !== '') {
        $lead  = $lm[0];
        $inner = substr($inner, strlen($lm[0]));
      }

      if (!preg_match('/<tr\b[^>]*>.*?<\/tr>/is', $inner, $tr))
        return $m[0];
      $rest = preg_replace('/<tr\b[^>]*>.*?<\/tr>/is', '', $inner, 1);
      $rest = preg_replace('/<tbody\b[^>]*>\s*<\/tbody>/is', '', $rest);

      return $m[1] . $lead . '<thead>' . $tr[0] . '</thead>' . $rest . $m[3];
    }, $processedHtml);
  }
@endphp
<!DOCTYPE html>
<html>

<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta charset="utf-8" />
  <title>Document Archive - {{ $modelName }}</title>
  <style>
    @page {
      margin-bottom: 22px;
      margin-top: 25px;
      margin-left:
        {{ $marginL }}
        px;
      margin-right:
        {{ $marginR }}
        px;
    }

    .pdf-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100%;
      border-top: 1px solid #e5e7eb;
      padding: 8px 14px;
      background:
        {{ $footerBg }}
      ;
      color:
        {{ $footerColor }}
      ;
      z-index: 1000;
      font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif;
      font-size: 11px;
    }

    .pdf-footer table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
    }

    .pdf-footer td {
      vertical-align: middle;
    }

    body {
      margin: 0;
      font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif;
      font-size: 11px;
      line-height: 15px;
      color: #333;
    }

    .no-page-break {
      page-break-inside: avoid;
    }

    .document-content div.page-break,
    .document-content div[data-page-break] {
      page-break-after: always;
      height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      line-height: 0;
    }

    table {
      border-collapse: collapse;
      width: 100%;
    }

    .page-header {
      margin-bottom: 12px;
      padding: 10px 14px;
      background:
        {{ $headerBg }}
      ;
      color:
        {{ $headerColor }}
      ;
      page-break-after: avoid;
      page-break-inside: avoid;
    }

    .page-header table {
      border-collapse: collapse;
    }

    .page-header td {
      vertical-align: middle;
      padding: 0;
    }

    .brand-logo {
      display: block;
      height: {{ max(24, min(200, $headerLogoHeight)) }}px;
      width: auto;
      max-width: 260px;
      margin: 0;
    }

    .header-title {
      font-size: 16px;
      font-weight: 800;
      line-height: 1.25;
    }

    .header-subtitle {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 2px;
    }

    .document-section {
      padding: 0 5px;
      margin: 0 0 20px 0;
    }

    .document-content {
      font-family: 'Times New Roman', Times, serif;
      padding: 18px 20px;
      border-radius: 4px;
      word-wrap: break-word;
      page-break-inside: auto;
      line-height: 1.5;
    }

    .document-content p {
      margin: 0 0 8px 0;
      line-height: 1.5;
    }

    .document-content mark {
      display: inline;
      color: inherit;
    }

    .document-content li {
      line-height: 1.5;
    }

    .document-content ol          { list-style: decimal outside; }
    .document-content ol ol       { list-style: lower-alpha outside; }
    .document-content ol ol ol    { list-style: lower-roman outside; }
    .document-content ul          { list-style: disc outside; }
    .document-content ul ul       { list-style: circle outside; }
    .document-content ul ul ul    { list-style: square outside; }

    .document-content ol[data-legal],
    .document-content ol[data-legal] ol {
      counter-reset: legal;
      list-style: none;
      padding-left: 0;
      margin-left: 0;
    }

    .document-content ol[data-legal] ol {
      padding-left: 24px;
    }

    .document-content ol[data-legal] li {
      display: block;
      line-height: 1.5;
    }

    .document-content ol[data-legal] li:before {
      counter-increment: legal;
      content: counters(legal, ".") ". ";
      font-weight: bold;
    }

    .document-content ol[data-legal] li > p {
      display: inline;
      margin: 0;
    }

    .document-content ol[data-legal] li > ol {
      display: block;
    }

    .document-content div {
      margin: 0 0 8px 0;
      line-height: 1.5;
    }

    .document-content span,
    .document-content font {
      line-height: 1.5;
    }

    .document-content h1,
    .document-content h2,
    .document-content h3 {
      margin: 14px 0 8px;
      color: #0f172a;
      line-height: 1.3;
      font-family: 'Times New Roman', Times, serif;
    }

    .document-content td,
    .document-content th,
    .document-content li,
    .document-content strong,
    .document-content em {
      font-family: 'Times New Roman', Times, serif;
    }

    .document-content h1 {
      font-size: 20px;
    }

    .document-content h2 {
      font-size: 17px;
    }

    .document-content h3 {
      font-size: 15px;
    }

    .document-content table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .document-content table td,
    .document-content table th {
      padding: 6px 8px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .document-content table,
    .document-content tbody,
    .document-content tr,
    .document-content td,
    .document-content th {
      page-break-inside: auto;
    }

    .document-content thead {
      display: table-header-group;
    }

    .document-content thead tr {
      page-break-inside: avoid;
      page-break-after: avoid;
    }

    .document-content table>tbody>tr:first-child,
    .document-content table>tr:first-child {
      page-break-after: avoid;
    }

    .document-content img {
      max-width: 100%;
    }

    .document-content ul,
    .document-content ol {
      margin: 0 0 8px 0;
      padding-left: 1.6em;
    }

    .document-content pre,
    .document-content pre code {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
      line-height: 1.5;
      margin: 0 0 8px 0;
      max-width: 100%;
    }

    .document-content code {
      line-height: 1.5;
      word-wrap: break-word;
    }

    .document-content blockquote {
      margin: 0 0 8px 0;
      padding-left: 12px;
      border-left: 3px solid #cbd5e1;
      line-height: 1.5;
    }

    .content-wrapper {
      margin-bottom: 25px;
    }

    .content-wrapper td,
    .content-wrapper th {
      padding: 6px 8px;
      vertical-align: top;
    }

    .first-page-fix {
      page-break-before: avoid;
      page-break-after: avoid;
    }

    .sig-box {
      display: inline-block;
      width: 220px;
      height: 80px;
      border: 1.5px dashed #94a3b8;
      border-radius: 6px;
      background: #f8fafc;
      color: #94a3b8;
      font-size: 10px;
      font-style: italic;
      text-align: center;
      padding: 32px 0;
      vertical-align: middle;
      position: relative;
    }

    .sig-marker {
      font-size: 0.5pt;
      color: #fefefe;
      letter-spacing: 0;
      position: absolute;
      top: 0;
      left: 0;
      line-height: 1;
    }
  </style>
</head>

<body>

  <div class="content-wrapper main-content first-page-fix">
    <div class="page-header">
      <table>
        <tr>
          @if ($logoOnLeft)
            <td style="width: {{ round($splitPct, 2) }}%; text-align: {{ $logoAlign }};">
              @if ($headerShowLogo && !empty($headerLogoBase64))
                <img src="data:image/png;base64,{{ $headerLogoBase64 }}" class="brand-logo" alt="logo"
                  style="margin: {{ $logoMargin }};">
              @endif
            </td>
            <td style="width: {{ round(100 - $splitPct, 2) }}%; text-align: {{ $titleAlign }};">
              @if ($headerShowTitle)
                <div style="display: inline-block; text-align: {{ $headerAlign }};">
                  <div class="header-title">{!! nl2br(e($headerTitle)) !!}</div>
                  @if ($headerSubtitle !== '')
                    <div class="header-subtitle">{!! nl2br(e($headerSubtitle)) !!}</div>
                  @endif
                </div>
              @endif
            </td>
          @else
            <td style="width: {{ round($splitPct, 2) }}%; text-align: {{ $titleAlign }};">
              @if ($headerShowTitle)
                <div style="display: inline-block; text-align: {{ $headerAlign }};">
                  <div class="header-title">{!! nl2br(e($headerTitle)) !!}</div>
                  @if ($headerSubtitle !== '')
                    <div class="header-subtitle">{!! nl2br(e($headerSubtitle)) !!}</div>
                  @endif
                </div>
              @endif
            </td>
            <td style="width: {{ round(100 - $splitPct, 2) }}%; text-align: {{ $logoAlign }};">
              @if ($headerShowLogo && !empty($headerLogoBase64))
                <img src="data:image/png;base64,{{ $headerLogoBase64 }}" class="brand-logo" alt="logo"
                  style="margin: {{ $logoMargin }};">
              @endif
            </td>
          @endif
        </tr>
      </table>
    </div>

    <div class="document-section">
      <div class="document-content">
        {!! \App\Support\PdfHighlight::fix($processedHtml) !!}
      </div>
    </div>
  </div>

    <script type="text/php">
      if (isset($pdf)) {
        $font  = $fontMetrics->get_font("helvetica", "normal");
        $size  = 9;
        $color = array(0.42, 0.45, 0.5);

        $pageWidth   = $pdf->get_width();
        $pageHeight  = $pdf->get_height();
        $sideMargin  = 28;

        $fb = ltrim("{{ $footerBg }}", "#");
        if (strlen($fb) === 3) { $fb = $fb[0].$fb[0].$fb[1].$fb[1].$fb[2].$fb[2]; }
        if (strlen($fb) !== 6) { $fb = "ffffff"; }
        $bandR = round(hexdec(substr($fb,0,2))/255, 4);
        $bandG = round(hexdec(substr($fb,2,2))/255, 4);
        $bandB = round(hexdec(substr($fb,4,2))/255, 4);
        $pdf->page_script(
          '$bandH = 48; $w = $pdf->get_width(); $h = $pdf->get_height();'
          . '$pdf->filled_rectangle(0, $h - $bandH, $w, $bandH, array(' . $bandR . ', ' . $bandG . ', ' . $bandB . '));'
          . '$pdf->line(0, $h - $bandH, $w, $h - $bandH, array(0.90, 0.91, 0.93), 0.75);'
        );
        $y           = $pdf->get_height() - 28;

        $footerText  = "{!! addslashes($footerText) !!}";
        $footerAlign = "{{ $footerAlign }}";
        if ($footerText !== "") {
          $tw = $fontMetrics->getTextWidth($footerText, $font, $size);
          if ($footerAlign === "left")        $fx = $sideMargin;
          elseif ($footerAlign === "right")   $fx = $pageWidth - $tw - $sideMargin;
          else                                $fx = ($pageWidth - $tw) / 2;
          $pdf->page_text($fx, $y, $footerText, $font, $size, $color);
        }

        @if ($showPageNumber)
          $pnAlign  = "{{ $pageNumberAlign }}";
          $pnFormat = "{{ $pageNumberFormat }}";

          $pnText = $pnFormat === "N"           ? "{PAGE_NUM}"
                  : ($pnFormat === "Page N"     ? "Page {PAGE_NUM}"
                  : ($pnFormat === "N / M"      ? "{PAGE_NUM} / {PAGE_COUNT}"
                  :                                "Page {PAGE_NUM} of {PAGE_COUNT}"));

          $pnSample = str_replace(array("{PAGE_NUM}", "{PAGE_COUNT}"), array("1", "1"), $pnText);
          $pnw = $fontMetrics->getTextWidth($pnSample, $font, $size);
          if ($pnAlign === "left")        $px = $sideMargin;
          elseif ($pnAlign === "right")   $px = $pageWidth - $pnw - $sideMargin;
          else                            $px = ($pageWidth - $pnw) / 2;

          if ($pnAlign === $footerAlign && $footerText !== "") {
            if ($pnAlign === "center") $px = ($pageWidth - $pnw) / 2 + ($fontMetrics->getTextWidth($footerText, $font, $size) / 2) + 12;
            elseif ($pnAlign === "left") $px = $sideMargin + $fontMetrics->getTextWidth($footerText, $font, $size) + 12;
            else $px = $pageWidth - $pnw - $sideMargin - $fontMetrics->getTextWidth($footerText, $font, $size) - 12;
          }

          $pdf->page_text($px, $y, $pnText, $font, $size, $color);
        @endif
      }
    </script>
</body>

</html>