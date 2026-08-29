@php
  $h = is_array($header) ? $header : [];
  $f = is_array($footer) ? $footer : [];

  /* Letterhead name, resolved at RENDER time. (#113)
   *
   * Templates seeded before the organisation name was available stored the
   * placeholder words "Company Name" / "Company Name Pvt. Ltd." as plain text,
   * so every document built from them printed those words as if they were the
   * letterhead — and in Evidence Vault the footer read "Company Name
   * Confidential". Plain text has nothing to resolve, so fixing the seed only
   * helps templates written from now on; the documents already in the vault
   * needed the substitution to happen here, where they are drawn.
   *
   * $companyName is passed by the controllers and resolves per document to the
   * legal entity, then the client org name, then the employee's own BRANCH —
   * the branch-name default this ticket asks for. When it cannot be resolved
   * the placeholder is dropped rather than printed, so a footer degrades to
   * "Confidential" instead of asserting a company that does not exist.
   *
   * Also swaps the {{CompanyName}} token, which new templates now seed when the
   * author has no organisation of their own. */
  $orgName = trim((string) ($companyName ?? ''));
  $fillOrg = function (string $s) use ($orgName): string {
      if ($s === '') return $s;
      $s = preg_replace('/\{\{\s*CompanyName\s*\}\}/i', $orgName, $s);
      // Longest first — "Company Name Pvt. Ltd." must not be half-replaced.
      foreach (['Company Name Pvt. Ltd.', 'Company Name'] as $ph) {
          $s = str_ireplace($ph, $orgName, $s);
      }
      // A dropped name can leave "  |  Confidential" or a trailing separator.
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
  @page { margin: 110px 40px 70px 40px; }
  body  { font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; color: #1f2937; line-height: 1.6; }
  header {
    position: fixed; top: -90px; left: 0; right: 0; height: 80px;
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
  .body img { max-width: 100%; }
  /* Explicit break emitted by the editor's Page Break button. The div is
     zero-height and invisible in print; only the instruction matters. Matched
     on the class AND the data attribute so a stripped stylesheet or a
     sanitiser that drops classes still leaves the break standing. */
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
          <img src="{{ $logoDataUri }}" style="max-height:50px; max-width:160px;" />
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
  {!! $bodyHtml !!}
</main>
</body>
</html>
