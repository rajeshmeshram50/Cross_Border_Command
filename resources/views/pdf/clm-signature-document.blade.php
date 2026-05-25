@php
  /**
   * CLM Trade Document → Zoho Sign render target (CBC).
   *
   * Header + footer are now driven by the document's saved page-shell
   * config (`header_config` / `footer_config` JSON on
   * clm_trade_doc_library — see [[HeaderFooterPanel.tsx]]). Whatever the
   * user configured in Stage 2 of the draft renders verbatim here.
   * Falls back to a minimal client-name header / company-line footer
   * for legacy rows that pre-date those columns.
   *
   * Inputs:
   *   - $document         (ClmTradeDocLibrary)  draft row (code, name, title, content)
   *   - $party            (Model)               Customer | Consignee | Vendor
   *   - $modelName        (string)              'Customer' | 'Consignee' | 'Vendor'
   *   - $processedHtml    (string)              placeholder-replaced HTML body
   *   - $signers          (array)               list of {name, email, order}
   *   - $generatedDate    (string)              'd/m/Y'
   *   - $requestId        (string)              UUID stamped in the footer
   *   - $client           (Client|null)         tenant fallback for branding
   *   - $headerConfig     (array)               saved HeaderConfig JSON
   *   - $footerConfig     (array)               saved FooterConfig JSON
   *   - $headerLogoBase64 (string)              pre-resolved base64 logo (or '')
   *
   * The signature placeholders in $processedHtml come pre-replaced with a
   * styled .sig-box scaffold; Zoho overlays the signer's real signature
   * on top via the x/y/page coords sent in the submit payload.
   */

  $documentTitle = $document->title ?? $document->name ?? 'Document';
  $clientName    = trim((string) ($client->org_name ?? 'Cross Border Command'));

  // ── Resolve header zone from saved config, with sensible fallbacks ──
  // For legacy rows (no header_config saved) we keep a minimal text-only
  // header so the PDF still has a recognisable brand line.
  $hcfg = is_array($headerConfig ?? null) ? $headerConfig : [];
  $headerTitle      = (string) ($hcfg['title']      ?? $clientName);
  $headerSubtitle   = (string) ($hcfg['subtitle']   ?? '');
  $headerAlign      = (string) ($hcfg['align']      ?? 'right');
  $headerBg         = (string) ($hcfg['background'] ?? '#ffffff');
  $headerColor      = (string) ($hcfg['text_color'] ?? '#111827');
  $headerShowLogo   = array_key_exists('show_logo',  $hcfg) ? (bool) $hcfg['show_logo']  : true;
  $headerShowTitle  = array_key_exists('show_title', $hcfg) ? (bool) $hcfg['show_title'] : true;
  $headerLogoHeight = (int) ($hcfg['logo_height'] ?? 62);
  // dompdf has no support for the % free-drag positions HeaderFooterPanel
  // emits — collapse them into a simple left/right 2-col header keyed off
  // the logo's horizontal position (logo_pos.x ≤ 50 → logo on the left).
  $logoX = isset($hcfg['logo_pos']['x']) ? (float) $hcfg['logo_pos']['x'] : 10.0;
  $logoOnLeft = $logoX <= 50.0;
  // Map HeaderFooterPanel's 'space-between' legacy value to right-align
  // so the title block doesn't ghost off the page on those older rows.
  if ($headerAlign === 'space-between') $headerAlign = 'right';

  // ── Resolve footer zone ──
  $fcfg = is_array($footerConfig ?? null) ? $footerConfig : [];
  $footerText        = (string) ($fcfg['text']        ?? $clientName);
  $footerAlign       = (string) ($fcfg['align']       ?? 'center');
  $footerBg          = (string) ($fcfg['background']  ?? '#ffffff');
  $footerColor       = (string) ($fcfg['text_color']  ?? '#6b7280');
  $showPageNumber    = array_key_exists('show_page_number', $fcfg) ? (bool) $fcfg['show_page_number'] : true;
  $pageNumberAlign   = (string) ($fcfg['page_number_align']  ?? 'right');
  $pageNumberFormat  = (string) ($fcfg['page_number_format'] ?? 'Page N of M');
@endphp
<!DOCTYPE html>
<html>
  <head>
    <title>Document Archive - {{ $modelName }}</title>
    <style>
      /* PAGE MARGINS — proper left/right padding */
      @page {
        margin-bottom: 70px;
        margin-top: 25px;
        margin-left: 25px;
        margin-right: 25px;
      }

      /* FOOTER — fixed at the bottom of every page. Background / colour
         come from the saved footer_config so a tenant whose footer band
         was configured dark renders correctly on every page. */
      .pdf-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        border-top: 1px solid #e5e7eb;
        padding: 8px 14px;
        background: {{ $footerBg }};
        color: {{ $footerColor }};
        z-index: 1000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
      }

      .pdf-footer table { width: 100%; border-collapse: collapse; margin: 0; }
      .pdf-footer td    { vertical-align: middle; }

      body {
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        line-height: 15px;
        color: #333;
      }

      .no-page-break { page-break-inside: avoid; }

      table { border-collapse: collapse; width: 100%; }

      /* HEADER — driven by header_config */
      .page-header {
        margin-bottom: 12px;
        padding: 10px 14px;
        background: {{ $headerBg }};
        color: {{ $headerColor }};
        page-break-after: avoid;
        page-break-inside: avoid;
      }

      .page-header table { border-collapse: collapse; }
      .page-header td    { vertical-align: middle; padding: 0; }

      .brand-logo {
        display: block;
        max-width: 230px;
        max-height: {{ max(24, min(200, $headerLogoHeight)) }}px;
        width: auto; height: auto;
        margin: 0;
      }

      .header-title    { font-size: 16px; font-weight: 800; line-height: 1.25; }
      .header-subtitle { font-size: 11px; opacity: 0.7; margin-top: 2px; }

      /* DOCUMENT SECTION */
      .document-section {
        padding: 0 5px;
        margin: 0 0 20px 0;
      }

      .document-content {
        padding: 18px 20px;
        border-radius: 4px;
        word-wrap: break-word;
        page-break-inside: auto;
      }

      .document-content p { margin: 0 0 8px 0; }
      .document-content h1, .document-content h2, .document-content h3 { margin: 14px 0 8px; color: #0f172a; }
      .document-content table { width: 100%; border-collapse: collapse; }
      .document-content table td,
      .document-content table th { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
      .document-content img { max-width: 100%; }
      .document-content ul, .document-content ol { margin: 0 0 8px 24px; }

      .content-wrapper { margin-bottom: 25px; }
      .first-page-fix  { page-break-before: avoid; page-break-after: avoid; }

      /* SIGNATURE BOX — visual scaffolding for the signature placeholders
       * in the draft body. Zoho overlays the real signature widget at the
       * (x, y) coords sent in the submit payload; this box just shows the
       * signer WHERE the widget will land in the rendered output. */
      .sig-box {
        display: inline-block;
        width: 220px; height: 80px;
        border: 1.5px dashed #94a3b8; border-radius: 6px;
        background: #f8fafc;
        color: #94a3b8; font-size: 10px; font-style: italic;
        text-align: center;
        padding: 32px 0;
        vertical-align: middle;
      }
      /* Detection marker — rendered at 0.5pt in near-white so it sits in
       * the PDF text stream (where PDF.js can find it from the send modal)
       * without being visible to humans. */
      .sig-marker { font-size: 0.5pt; color: #fefefe; letter-spacing: 0; }
    </style>
  </head>

  <body>
    {{-- FOOTER — fixed on every page, driven by footer_config. Three
         cells (left / center / right) mirror HeaderFooterPanel's preview
         so footer.text lands in the cell matching its `align`, and the
         page number (when enabled) lands in the cell matching its
         `page_number_align`. Cells can overlap on the same side. --}}
    <div class="pdf-footer">
      <table>
        <tr>
          @foreach (['left', 'center', 'right'] as $cell)
            @php
              $showText = $footerAlign === $cell;
              $showNum  = $showPageNumber && $pageNumberAlign === $cell;
              $justify  = $cell === 'left' ? 'left' : ($cell === 'right' ? 'right' : 'center');
            @endphp
            <td style="width: 33.33%; text-align: {{ $justify }};">
              @if ($showText)
                <span>{{ $footerText }}</span>
              @endif
              @if ($showNum)
                <span class="pdf-footer-pageno" data-format="{{ $pageNumberFormat }}"
                      style="display:inline-block; padding:2px 6px; margin-left:{{ $showText ? '8px' : '0' }};
                             font-weight:700; font-size:10.5px;">
                  {{-- Actual page numbers are stamped by the dompdf script
                       at the bottom (positioned absolutely); this span just
                       reserves visual room in the right cell. --}}
                  &nbsp;
                </span>
              @endif
            </td>
          @endforeach
        </tr>
      </table>
    </div>

    {{-- HEADER — driven by header_config, no hardcoded brand block. --}}
    <div class="content-wrapper main-content first-page-fix">
      <div class="page-header">
        <table>
          <tr>
            @if ($logoOnLeft)
              <td style="width: 45%; text-align: left;">
                @if ($headerShowLogo)
                  @if (!empty($headerLogoBase64))
                    <img src="data:image/png;base64,{{ $headerLogoBase64 }}" class="brand-logo" alt="logo">
                  @endif
                @endif
              </td>
              <td style="width: 55%; text-align: {{ $headerAlign }};">
                @if ($headerShowTitle)
                  <div class="header-title">{!! nl2br(e($headerTitle)) !!}</div>
                  @if ($headerSubtitle !== '')
                    <div class="header-subtitle">{!! nl2br(e($headerSubtitle)) !!}</div>
                  @endif
                @endif
              </td>
            @else
              <td style="width: 55%; text-align: {{ $headerAlign }};">
                @if ($headerShowTitle)
                  <div class="header-title">{!! nl2br(e($headerTitle)) !!}</div>
                  @if ($headerSubtitle !== '')
                    <div class="header-subtitle">{!! nl2br(e($headerSubtitle)) !!}</div>
                  @endif
                @endif
              </td>
              <td style="width: 45%; text-align: right;">
                @if ($headerShowLogo)
                  @if (!empty($headerLogoBase64))
                    <img src="data:image/png;base64,{{ $headerLogoBase64 }}" class="brand-logo" alt="logo" style="margin-left:auto;">
                  @endif
                @endif
              </td>
            @endif
          </tr>
        </table>
      </div>

      {{-- DOCUMENT BODY — comes from the trade-doc draft with the
           {{customer.*}} / {{consignee.*}} / {{supplier.*}} tokens
           already swapped for real data + signature scaffolding. --}}
      <div class="document-section">
        <div class="document-content">
          {!! $processedHtml !!}
        </div>
      </div>
    </div>

    {{-- Page-number stamp — renders into whichever footer cell the user
         picked via page_number_align. Hidden entirely when the user
         turned off `show_page_number` on the draft. --}}
    @if ($showPageNumber)
      <script type="text/php">
        if (isset($pdf)) {
          $font   = $fontMetrics->get_font("helvetica", "normal");
          $size   = 9;
          $align  = "{{ $pageNumberAlign }}";
          $format = "{{ $pageNumberFormat }}";

          // Match HeaderFooterPanel's format options 1:1.
          $text = $format === "N"           ? "{PAGE_NUM}"
                : ($format === "Page N"     ? "Page {PAGE_NUM}"
                : ($format === "N / M"      ? "{PAGE_NUM} / {PAGE_COUNT}"
                :                              "Page {PAGE_NUM} of {PAGE_COUNT}"));

          $color      = array(0.42, 0.45, 0.5);
          $pageWidth  = $pdf->get_width();
          $textWidth  = $fontMetrics->getTextWidth($text, $font, $size);
          if ($align === "left")        $x = 28;
          elseif ($align === "right")   $x = $pageWidth - $textWidth - 28;
          else                          $x = ($pageWidth - $textWidth) / 2;
          $y = $pdf->get_height() - 22;
          $pdf->page_text($x, $y, $text, $font, $size, $color);
        }
      </script>
    @endif
  </body>
</html>
