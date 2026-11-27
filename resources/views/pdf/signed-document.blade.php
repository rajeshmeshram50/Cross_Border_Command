@php
  $h = is_array($header) ? $header : [];
  $f = is_array($footer) ? $footer : [];

  $orgName = trim((string) ($companyName ?? ''));
  $fillOrg = function (string $s) use ($orgName): string {
      if ($s === '') return $s;
      $s = preg_replace('/\{\{\s*CompanyName\s*\}\}/i', $orgName, $s);
      foreach (['Company Name Pvt. Ltd.', 'Company Name'] as $ph) {
          $s = str_ireplace($ph, $orgName, $s);
      }
      $s = preg_replace('/\s*\|\s*\|\s*/', ' | ', $s);
      $s = preg_replace('/^\s*\|\s*|\s*\|\s*$/', '', $s);
      return trim(preg_replace('/\s{2,}/', ' ', $s));
  };

  $title    = $fillOrg((string) ($h['title']    ?? ''));
  $subtitle = (string) ($h['subtitle'] ?? '');
  $align    = (string) ($h['align']    ?? 'right');
  $hBg      = (string) ($h['background'] ?? '#ffffff');
  $hFg      = (string) ($h['text_color'] ?? '#111827');
  $showLogo = ($h['show_logo'] ?? true) && !empty($logoDataUri);
  $logoH   = max(24, min(200, (int) ($h['logo_height'] ?? 62)));
  $headerH = max(80, $logoH + 30);
  $showTitle= ($h['show_title'] ?? true);

  $fText    = $fillOrg((string) ($f['text']  ?? ''));
  $fAlign   = (string) ($f['align'] ?? 'center');
  $fBg      = (string) ($f['background'] ?? '#ffffff');
  $fFg      = (string) ($f['text_color'] ?? '#6b7280');
  $showPage = !empty($f['show_page_number']);
@endphp
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>{{ $row->template?->name ?? 'Signed Document' }}</title>
<style>
  @page { margin: {{ $headerH + 30 }}px 40px 70px 40px; }
  body  { font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; color: #1f2937; line-height: 1.6; }
  header {
    position: fixed; top: -{{ $headerH + 10 }}px; left: 0; right: 0; height: {{ $headerH }}px;
    background: {{ $hBg }}; color: {{ $hFg }};
    border-bottom: 2px solid #f3f4f6; padding: 0 8px;
  }
  header table { width: 100%; height: 100%; border-collapse: collapse; }
  header td { vertical-align: middle; }
  header .logo { width: 35%; text-align: left; }
  header .title { text-align: {{ $align === 'left' ? 'left' : ($align === 'center' ? 'center' : 'right') }}; }
  header .title .t1 { font-size: 14px; font-weight: 700; }
  header .title .t2 { font-size: 10px; color: #6b7280; }
  footer {
    position: fixed; bottom: -45px; left: 0; right: 0; height: 36px;
    background: {{ $fBg }}; color: {{ $fFg }}; border-top: 2px solid #f3f4f6;
    font-size: 10px;
  }
  footer table { width: 100%; height: 100%; border-collapse: collapse; }
  footer td { vertical-align: middle; padding: 0 8px; }
  .pn { text-align: right; }
  .body p { margin: 0 0 8px 0; }
  .body h1, .body h2, .body h3 { margin: 14px 0 8px; }
  .body table { width: 100%; border-collapse: collapse; }
  .body td, .body th { padding: 6px 8px; vertical-align: top; }
  .body img { max-width: 100%; }
  .body div.page-break,
  .body div[data-page-break] {
    page-break-after: always;
    height: 0; margin: 0; padding: 0; border: 0; line-height: 0;
  }
</style>
</head>
<body>
<header>
  <table>
    <tr>
      <td class="logo">
        @if($showLogo)
          <img src="{{ $logoDataUri }}" style="height:{{ $logoH }}px; width:auto; max-width:240px;" />
        @endif
      </td>
      <td class="title">
        @if($showTitle && $title !== '')
          <div class="t1">{{ $title }}</div>
        @endif
        @if($subtitle !== '')
          <div class="t2">{{ $subtitle }}</div>
        @endif
      </td>
    </tr>
  </table>
</header>

<footer>
  <table>
    <tr>
      <td style="text-align:{{ $fAlign }};">{{ $fText }}</td>
      @if($showPage)
        <td class="pn">
          Page <span class="pagenum"></span>
        </td>
      @endif
    </tr>
  </table>
  <script type="text/php">
    if (isset($pdf)) {
      $font = $fontMetrics->get_font("DejaVu Sans", "normal");
      $size = 8;
      $pageText = "Page {PAGE_NUM} of {PAGE_COUNT}";
      $w = $fontMetrics->get_text_width($pageText, $font, $size);
      $x = $pdf->get_width() - $w - 20;
      $y = $pdf->get_height() - 28;
      $pdf->page_text($x, $y, $pageText, $font, $size, [0.42, 0.45, 0.50]);
    }
  </script>
</footer>

<main class="body">
  {!! \App\Support\PdfHighlight::fix($bodyHtml) !!}
</main>
</body>
</html>
