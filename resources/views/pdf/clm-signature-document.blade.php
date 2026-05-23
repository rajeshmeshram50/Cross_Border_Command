@php
  /**
   * CLM Trade Document → Zoho Sign render target (CBC).
   *
   * Layout / styling are a direct port of New_IDIMS_6.0's
   * documents.signature-document blade — fixed leafy SVG background, green
   * accent header with the tenant's logo + tagline + document title +
   * scannable Code-128 barcode, and a fixed bottom footer carrying the
   * tenant's company line, a smaller barcode, and the generated date.
   * "Page N of M" stamped via dompdf's text/php block.
   *
   * Inputs:
   *   - $document       (ClmTradeDocLibrary)  draft row (code, name, title, content)
   *   - $party          (Model)               Customer | Consignee | Vendor
   *   - $modelName      (string)              'Customer' | 'Consignee' | 'Vendor'
   *   - $processedHtml  (string)              placeholder-replaced HTML body
   *   - $signers        (array)               list of {name, email, order}
   *   - $generatedDate  (string)              'd/m/Y'
   *   - $requestId      (string)              UUID stamped in the footer
   *   - $client         (Client|null)         tenant for branding (logo, company info)
   *
   * The signature placeholders in $processedHtml come pre-replaced with a
   * styled .sig-box scaffold; Zoho overlays the signer's real signature
   * on top via the x/y/page coords sent in the submit payload.
   */

  use Milon\Barcode\DNS1D;

  $documentTitle = $document->title ?? $document->name ?? 'Document';
  $clientName    = trim((string) ($client->org_name ?? 'Cross Border Command'));
  $clientWebsite = trim((string) ($client->website  ?? ''));
  $clientEmail   = trim((string) ($client->email    ?? ''));
  $clientPhone   = trim((string) ($client->phone    ?? ''));
  $clientGstin   = trim((string) ($client->gst_number ?? ''));
  $clientPan     = trim((string) ($client->pan_number ?? ''));
  $clientCin     = trim((string) ($client->unique_number ?? ''));

  // Header logo — base64-encode the client's stored logo so dompdf can
  // embed it without a network round-trip. Falls back to a tagline-only
  // header when no logo is configured.
  $headerLogoBase64 = '';
  if ($client && $client->logo) {
      try {
          $relativePath = (string) $client->logo;
          if (\Illuminate\Support\Facades\Storage::disk('public')->exists($relativePath)) {
              $headerLogoBase64 = base64_encode(
                  \Illuminate\Support\Facades\Storage::disk('public')->get($relativePath),
              );
          }
      } catch (\Throwable $e) {
          $headerLogoBase64 = '';
      }
  }

  // Barcode payloads — same Code-128 width/heights as the New_IDIMS
  // template. URL goes to the client's website if set, otherwise a CBC
  // permalink that resolves to the signature request id.
  $barcodeUrl = $clientWebsite !== '' ? $clientWebsite : 'https://cross-border-command.app';
  try {
      $barcodeGen   = new DNS1D();
      $headerBarcode = $barcodeGen->getBarcodePNG($barcodeUrl, 'C128', 3, 60);
      $footerBarcode = $barcodeGen->getBarcodePNG($barcodeUrl, 'C128', 2, 25);
  } catch (\Throwable $e) {
      $headerBarcode = '';
      $footerBarcode = '';
  }

  // Footer company line — assembled from whichever client fields are
  // present, separated by " | " so it degrades gracefully on partial
  // tenant data.
  $footerCompanyParts = array_filter([
      $clientName ?: null,
      $clientCin   !== '' ? "CIN: {$clientCin}"   : null,
      $clientGstin !== '' ? "GST: {$clientGstin}" : null,
      $clientPan   !== '' ? "PAN: {$clientPan}"   : null,
  ]);
  $footerCompanyLine = implode(' | ', $footerCompanyParts);
@endphp
<!DOCTYPE html>
<html>
  <head>
    <title>Document Archive - {{ $modelName }}</title>
    <style>
      /* PAGE MARGINS — proper left/right padding */
      @page {
        margin-bottom: 80px;
        margin-top: 25px;
        margin-left: 25px;
        margin-right: 25px;
      }

      /* FOOTER — fixed at the bottom of every page */
      .pdf-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        border-top: 1px solid #68AD35;
        padding: 5px 0;
        background: white;
        z-index: 1000;
        font-family: Arial, Helvetica, sans-serif;
      }

      body {
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        line-height: 15px;
        color: #333;
      }

      .pdf-bg {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 0;
        pointer-events: none;
      }

      .pdf-bg svg.bg-svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0.06;
      }

      .no-page-break {
        page-break-inside: avoid;
      }

      hr {
        border: 0.1px solid #68AD35;
        margin: 8px 0;
      }

      table {
        border-collapse: collapse;
        width: 100%;
      }

      /* HEADER */
      .page-header {
        margin-bottom: 12px;
        page-break-after: avoid;
        page-break-inside: avoid;
      }

      .brand-block {
        width: 100%;
        margin: 0;
        text-align: left;
      }

      .brand-logo-wrap {
        width: 100%;
        text-align: left;
      }

      .brand-logo {
        display: block;
        max-width: 230px;
        width: auto;
        height: auto;
        margin: 0;
      }

      .tagline-center {
        margin-top: 6px;
        font-size: 10px;
        letter-spacing: 3px;
        color: #68AD35;
        font-weight: 600;
        white-space: nowrap;
        text-align: left;
      }

      .right-header-block {
        width: 360px;
        margin-left: auto;
        margin-right: 18px;
        margin-top: 5px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9px;
        line-height: 1.4;
      }

      .document-title {
        text-align: center;
        margin-top: 10px;
        margin-bottom: 10px;
        font-size: 18px;
        font-weight: 800;
        line-height: 1.1;
        color: #68AD35;
      }

      .barcode-container {
        text-align: center;
        margin-top: 8px;
      }

      .barcode-url {
        font-size: 8px;
        text-align: center;
        margin-top: 2px;
      }

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
    {{-- Leaf background watermark — same SVG New_IDIMS uses. --}}
    <div class="pdf-bg">
      <svg class="bg-svg" viewBox="0 0 800 1100" xmlns="http://www.w3.org/2000/svg">
        <g fill="#43a047">
          <path d="M120,980 C240,780 280,640 230,520 C180,400 80,320 50,220
                   C170,290 290,380 340,520 C390,660 350,830 230,1010 Z" />
          <path d="M740,210 C610,300 520,430 550,560 C580,690 690,800 770,900
                   C705,815 650,700 635,560 C620,420 670,300 740,210 Z" />
          <circle cx="640" cy="920" r="42" />
          <circle cx="690" cy="960" r="30" />
          <circle cx="600" cy="965" r="28" />
          <circle cx="130" cy="160" r="30" />
          <circle cx="170" cy="120" r="20" />
          <circle cx="95"  cy="115" r="18" />
        </g>
      </svg>
    </div>

    {{-- GLOBAL FOOTER — fixed at the page bottom on every page. --}}
    <div class="pdf-footer">
      <table style="width: 100%; border-collapse: collapse; margin: 0;">
        <tr>
          <td style="width: 20%; text-align: left; vertical-align: middle; padding-left: 10px;">
            @if(!empty($footerBarcode))
              <img src="data:image/png;base64,{{ $footerBarcode }}" alt="Barcode" style="width: 95px; height: 25px; display: block;">
              @if($clientWebsite !== '')
                <div style="font-size:7px; margin-top:2px;">{{ $clientWebsite }}</div>
              @endif
            @endif
          </td>

          <td style="width: 60%; text-align: center; vertical-align: middle; font-size: 9px; color: #333;">
            {{ $footerCompanyLine ?: $clientName }}
          </td>

          <td style="width: 20%; text-align: right; vertical-align: middle; padding-right: 10px; font-size: 8px;">
            {{ $generatedDate ?? date('d/m/Y') }}
          </td>
        </tr>
      </table>
    </div>

    {{-- MAIN CONTENT --}}
    <div class="content-wrapper main-content first-page-fix">
      <div class="page-header">
        <table style="width:100%; border-collapse:collapse;">
          <tr>
            {{-- LEFT: tenant logo + tagline --}}
            <td style="width:60%; vertical-align:top; padding:0; margin:0;">
              <div class="brand-block">
                <div class="brand-logo-wrap">
                  @if(!empty($headerLogoBase64))
                    <img src="data:image/png;base64,{{ $headerLogoBase64 }}" class="brand-logo" alt="{{ $clientName }}">
                  @else
                    <div style="font-size: 20px; font-weight: 800; color: #68AD35; letter-spacing: -0.5px;">
                      {{ $clientName }}
                    </div>
                  @endif
                </div>
                <div class="tagline-center">CROSS BORDER COMMAND</div>
              </div>
            </td>

            {{-- RIGHT: document title + scannable barcode --}}
            <td style="width:40%; vertical-align:top; padding:0; margin:0;">
              <div class="right-header-block">
                <div class="document-title">
                  {{ $documentTitle }}
                </div>

                @if(!empty($headerBarcode))
                  <div class="barcode-container">
                    <img src="data:image/png;base64,{{ $headerBarcode }}" style="width:150px; height:50px; display:block; margin:0 auto;" alt="Barcode">
                    <div class="barcode-url">{{ $barcodeUrl }}</div>
                  </div>
                @endif
              </div>
            </td>
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

    {{-- Page-number stamp; same script DOMPDF expects. --}}
    <script type="text/php">
      if (isset($pdf)) {
        $font = $fontMetrics->get_font("helvetica", "normal");
        $size = 8;
        $text = "Page {PAGE_NUM} of {PAGE_COUNT}";
        $color = array(0.4, 0.4, 0.4);
        $pageWidth = $pdf->get_width();
        $textWidth = $fontMetrics->getTextWidth($text, $font, $size);
        $x = ($pageWidth - $textWidth) / 2;
        $y = $pdf->get_height() - 45;
        $pdf->page_text($x, $y, $text, $font, $size, $color);
      }
    </script>
  </body>
</html>
