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
        /* Proportional line-height (NOT the body's fixed 15px) so larger fonts
           in inserted clause content get a proportional line box and don't
           overlap — the fixed 15px line box clipped/overlapped bigger text. */
        line-height: 1.5;
      }

      .document-content p  { margin: 0 0 8px 0; line-height: 1.5; }
      .document-content li { line-height: 1.5; }
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
       * signer WHERE the widget will land in the rendered output.
       *
       * `position: relative` anchors the absolutely-positioned .sig-marker
       * to the box's top-left corner. Without this the marker would sit
       * inside the centred text flow (text-align: center) and PDF.js
       * would report its baseline at roughly (box_left + 60pt) instead
       * of (box_left), pushing the Zoho field to the right of the box.
       * That was the "Vendor signature lands above and to the right"
       * bug — Customer drafts happened to use a left-aligned context so
       * the centre-shift was zero, masking the issue. */
      .sig-box {
        display: inline-block;
        width: 220px; height: 80px;
        border: 1.5px dashed #94a3b8; border-radius: 6px;
        background: #f8fafc;
        color: #94a3b8; font-size: 10px; font-style: italic;
        text-align: center;
        padding: 32px 0;
        vertical-align: middle;
        position: relative;
      }
      /* Detection marker — rendered at 0.5pt in near-white so it sits in
       * the PDF text stream (where PDF.js can find it from the send modal)
       * without being visible to humans. Absolute positioning pins the
       * marker text to the box's top-left corner so its detected
       * (x, y) is the box's top-left regardless of how the surrounding
       * draft paragraph is aligned. */
      .sig-marker {
        font-size: 0.5pt; color: #fefefe; letter-spacing: 0;
        position: absolute;
        top: 0;
        left: 0;
        line-height: 1;
      }
    </style>
  </head>

  <body>
    {{-- FOOTER + page number are painted via dompdf page_text scripts at
         the bottom of the file — both stamps share one baseline Y, so
         they always sit on the same line regardless of body length.
         The previous `position: fixed; bottom: 0` approach drifted
         upward on short documents because dompdf falls back to natural
         flow when the body doesn't fill a page. --}}

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

    {{-- Footer-text + page-number stamps. Both are painted via dompdf
         `page_text()` at the SAME baseline Y so they always line up
         regardless of how short the body is. The earlier approach used
         a `position: fixed; bottom: 0` `<div class="pdf-footer">` for
         the text, but dompdf renders that in NATURAL FLOW when the
         body doesn't fill the page — pushing the footer text high up
         while the page_text page-number remained at the bottom edge,
         producing a big vertical gap on short documents.

         Both stamps live on every page. Margins (28pt from edges) +
         a shared baseline Y produce the customer/consignee/vendor
         layout you've already seen for trade-doc sends. --}}
    <script type="text/php">
      if (isset($pdf)) {
        $font  = $fontMetrics->get_font("helvetica", "normal");
        $size  = 9;
        $color = array(0.42, 0.45, 0.5);

        $pageWidth   = $pdf->get_width();
        $sideMargin  = 28;
        // Footer baseline — 28pt above the page bottom edge, matching the
        // Proforma Invoice footer (proforma-invoice.blade.php draws its
        // "Page X of Y" at get_height() - 28) so CTC, customer, consignee &
        // supplier docs all share the PI's footer position. Sits well inside
        // the @page { margin-bottom: 70px } reservation so it never overlaps
        // body content.
        $y           = $pdf->get_height() - 28;

        // ── Footer text (footer.text) ──
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
          // ── Page number (show_page_number + page_number_format) ──
          $pnAlign  = "{{ $pageNumberAlign }}";
          $pnFormat = "{{ $pageNumberFormat }}";

          // Match HeaderFooterPanel's format options 1:1.
          $pnText = $pnFormat === "N"           ? "{PAGE_NUM}"
                  : ($pnFormat === "Page N"     ? "Page {PAGE_NUM}"
                  : ($pnFormat === "N / M"      ? "{PAGE_NUM} / {PAGE_COUNT}"
                  :                                "Page {PAGE_NUM} of {PAGE_COUNT}"));

          $pnw = $fontMetrics->getTextWidth($pnText, $font, $size);
          if ($pnAlign === "left")        $px = $sideMargin;
          elseif ($pnAlign === "right")   $px = $pageWidth - $pnw - $sideMargin;
          else                            $px = ($pageWidth - $pnw) / 2;

          // If footer text + page number both land on the same cell
          // (e.g. both centre-aligned), nudge the page number rightwards
          // so they don't overlap into an unreadable smear.
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
