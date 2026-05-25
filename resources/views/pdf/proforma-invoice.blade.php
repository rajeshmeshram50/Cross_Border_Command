<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>{{ strtoupper($pdf_title ?? 'PROFORMA INVOICE') }} — {{ $quotation->pi_number ?? '' }}</title>
<style>
    @page { margin-bottom: 20px; }

    .pdf-footer {
        position: fixed;
        margin-bottom: 30px;
        bottom: 0; left: 0; right: 0; width: 100%;
        border-top: 1px solid {{ $companyDetails->primary_color ?? '#7CB342' }};
        padding: 5px 0;
        background: white;
        z-index: 1000;
    }

    body {
        margin-bottom: 10px;
        /* Helvetica is what the reference PDF metadata reports for every
           text run, so we lead with that. DejaVu Sans stays as a fallback
           because it ships with DomPDF and carries µ, ×, É, ®, … glyphs
           that the line-item descriptions occasionally use. */
        font-family: Helvetica, "DejaVu Sans", Arial, sans-serif;
        font-size: 9px;
        /* Values across the document render in this neutral grey (#777)
           to match the Inorbvict reference. Labels override this via
           <strong> to a slightly darker grey (#666). */
        color: #777777;
        position: relative;
    }

    /* Tighter line-height matches the reference Inorbvict layout. The
       old 15px was leaving large gaps between every label/value pair
       and inflating the header block to ~50% of the page. 12px brings
       it back to the reference proportions. */
    body, table, tr, td, th, div, p, span, strong, li { line-height: 12px; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.15; margin: 0; }
    /* Labels (everything wrapped in <strong>) render slightly darker
       grey than the values, matching the metadata spec from the
       reference Inorbvict letterhead. */
    strong, b { color: #666666; font-weight: bold; }

    /* Table styling — body uses middle vertical alignment so single-line
       values line up cleanly with the header even when a column needs
       to wrap (e.g. a long product description forcing that row taller).
       Header bar gets noticeably more vertical padding (12px top/bottom
       vs 6px on body cells) so it reads as a substantial colored strip
       like the reference Inorbvict product table, not a thin caption. */
    .prod_table { width: 100%; border-collapse: collapse; font-size: 8.5px; font-family: Helvetica, "DejaVu Sans", Arial, sans-serif; }
    .prod_table thead { display: table-header-group; }
    .prod_table tr { page-break-inside: avoid; }
    .prod_table td.description-cell { word-wrap: break-word; white-space: normal; vertical-align: middle; }
    .prod_table td { padding: 10px 6px; vertical-align: middle; line-height: 13px; }
    .prod_table th {
        padding: 12px 6px;
        vertical-align: middle;
        line-height: 13px;
        font-weight: 700;
        font-size: 9.5px;
        white-space: nowrap;
        letter-spacing: 0.2px;
    }

    table { border-collapse: collapse; width: 100%; }
    .content-wrapper { position: relative; z-index: 1; }
    .force-page { page-break-before: always; }
    .page-header { margin-bottom: 10px; }
    .product-area { margin-top: 10px; }
    .main-content { margin-top: 0; padding-top: 0; }
    .sub-header { margin-bottom: 10px; padding-bottom: 5px; font-size: 9px; }

    /* Barcode and QR placeholders — drawn in CSS since the project doesn't
       ship a barcode library. Visual stand-ins for DNS1D / DNS2D output. */
    .barcode-strip {
        display: inline-block;
        background-image: repeating-linear-gradient(90deg,
            #111 0px, #111 2px, transparent 2px, transparent 4px,
            #111 4px, #111 5px, transparent 5px, transparent 8px);
        border-top: 1px solid #fff; border-bottom: 1px solid #fff;
    }
    .barcode-strip-sm { width: 70px; height: 18px; }
    .barcode-strip-lg { width: 120px; height: 40px; }
    .qr-placeholder {
        display: inline-block;
        width: 80px; height: 80px;
        background-color: #fff;
        background-image:
            repeating-linear-gradient(0deg,  #111 0 3px, transparent 3px 6px),
            repeating-linear-gradient(90deg, #111 0 3px, transparent 3px 6px);
        border: 2px solid #111;
    }
</style>
</head>
<body>

<!-- GLOBAL FOOTER — matches the reference Inorbvict letterhead layout:
     LEFT: small barcode + URL beneath it (only when branch.website is set),
     CENTER: company identity strip (Name | CIN | GST | IEC | PAN),
     RIGHT: today's print date.
     A "Page X of Y" line is drawn centered just beneath this footer
     table via the <script type="text/php"> block at the bottom of this
     file ({PAGE_COUNT} is only resolvable from page_text()). -->
<div class="pdf-footer">
    <table style="width: 100%; border-collapse: collapse; margin: 0;">
        <tr>
            <td style="width: 15%; text-align: left; vertical-align: middle; padding-left: 10px;">
                @if(!empty($barcodeData))
                    <img src="{{ $barcodeData }}" alt="Barcode" width="100" height="22" style="width:100px; height:22px; display:block;">
                    <div style="font-size:7px; color:#333; text-align:left; word-break:break-all; line-height:9px; margin-top:1px; max-width:120px;">
                        {{ $companyDetails->website ?? '' }}
                    </div>
                @endif
            </td>
            <td style="width: 70%; text-align: center; vertical-align: middle; font-size: 9px; color: #333; padding: 0 8px;">
                {{ $companyDetails->name }}
                @if($companyDetails->cin)    | CIN: {{ $companyDetails->cin }}    @endif
                @if($companyDetails->gst_no) | GST: {{ $companyDetails->gst_no }} @endif
                @if($companyDetails->iec)    | IEC: {{ $companyDetails->iec }}    @endif
                @if($companyDetails->pan_no) | PAN: {{ $companyDetails->pan_no }} @endif
            </td>
            <td style="width: 15%; text-align: right; vertical-align: middle; padding-right: 10px; font-size: 9px; color: #333;">
                {{ date('d/m/Y') }}
            </td>
        </tr>
    </table>
</div>

<!-- MAIN CONTENT -->
<div class="content-wrapper main-content">
    @php
        // ──────────────────────────────────────────────────────────────
        // AMOUNT IN WORDS — Indian English spell-out (lakhs / crores).
        // Tries ext-intl's NumberFormatter::SPELLOUT first; falls back to
        // a pure-PHP routine on servers without the intl extension so the
        // PDF doesn't 500 (which is what was happening before this fix).
        // Same pattern as resources/views/invoices/payment-invoice.blade.php.
        // ──────────────────────────────────────────────────────────────
        $__grandTotal = (float) ($quotation->grand_total ?? 0);
        $__rupees     = (int) floor($__grandTotal);
        $__paise      = (int) round(($__grandTotal - $__rupees) * 100);
        $__spellInr = function (int $n): string {
            if ($n === 0) return 'Zero';
            $ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            $tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
            $twoDigit = function (int $n) use ($ones, $tens): string {
                if ($n < 20) return $ones[$n];
                return trim($tens[intdiv($n, 10)] . ' ' . ($n % 10 ? $ones[$n % 10] : ''));
            };
            $threeDigit = function (int $n) use ($ones, $twoDigit): string {
                $h = intdiv($n, 100); $r = $n % 100;
                $out = '';
                if ($h) $out .= $ones[$h] . ' Hundred';
                if ($r) $out .= ($h ? ' ' : '') . $twoDigit($r);
                return $out;
            };
            $crore = intdiv($n, 10000000); $n %= 10000000;
            $lakh  = intdiv($n, 100000);   $n %= 100000;
            $thou  = intdiv($n, 1000);     $n %= 1000;
            $hund  = $n;
            $parts = [];
            if ($crore) $parts[] = $threeDigit($crore) . ' Crore';
            if ($lakh)  $parts[] = $twoDigit($lakh)    . ' Lakh';
            if ($thou)  $parts[] = $twoDigit($thou)    . ' Thousand';
            if ($hund)  $parts[] = $threeDigit($hund);
            return implode(' ', $parts);
        };
        try {
            if (!class_exists(\NumberFormatter::class)) {
                throw new \RuntimeException('intl ext missing');
            }
            $__formatter = new \NumberFormatter('en_IN', \NumberFormatter::SPELLOUT);
            $__rupeeWords = ucwords($__formatter->format($__rupees));
            $__paiseWords = $__paise > 0 ? ucwords($__formatter->format($__paise)) : '';
        } catch (\Throwable $e) {
            $__rupeeWords = $__spellInr($__rupees);
            $__paiseWords = $__paise > 0 ? $__spellInr($__paise) : '';
        }
        $amountInWords = $__rupeeWords
            . ($__paiseWords !== '' ? ' and ' . $__paiseWords . ' Paise' : '');

        // ==============================================
        // COMPLETE CALCULATION FOR PAGINATION
        // ==============================================
        $allProducts = $quotationProducts->toArray();
        $totalProducts = count($allProducts);

        $productsPerPage = 7;
        $productPages = array_chunk($allProducts, $productsPerPage);
        $totalProductPages = count($productPages);

        $footerNeedsNewPage = false;
        if ($totalProductPages > 1) {
            $lastPageProducts = count($productPages[$totalProductPages - 1] ?? []);
            if ($lastPageProducts > 8) { $footerNeedsNewPage = true; }
        } else {
            $productsOnSinglePage = count($productPages[0] ?? []);
            if ($productsOnSinglePage >= 8) { $footerNeedsNewPage = true; }
            foreach ($productPages[0] ?? [] as $product) {
                $descLength = strlen($product['product_description'] ?? '');
                if ($descLength > 400) { $footerNeedsNewPage = false; break; }
            }
        }

        $hasTermsConditions = !empty($termsAndConditions) ||
            !empty(trim($quotation->terms_and_conditions ?? ''));

        $currentPageNumber = 1;

        // Resolve logo once — prefer the issuing Branch's uploaded logo
        // (passed in as a base64 data URI on $companyDetails->logo_data),
        // fall back to the bundled IGC default for branches that haven't
        // uploaded one yet.
        $logoData = $companyDetails->logo_data ?? null;
        if (!$logoData) {
            $fallbackPath = public_path('images/igc-logo.png');
            $logoData = file_exists($fallbackPath)
                ? 'data:image/png;base64,' . base64_encode(file_get_contents($fallbackPath))
                : null;
        }
        // Authorised-signatory image rendered inside the "with signature"
        // block — also base64 from the branch's signature upload. When
        // absent, the template falls back to the CSS pseudo-stamp
        // (BRANCH • AUTHORISED • SIGNED) below.
        $signatureData = $companyDetails->signature_data ?? null;
    @endphp

    <!-- ============================ -->
    <!-- CREATE PRODUCT PAGES WITH SUB-HEADERS -->
    <!-- ============================ -->
    @foreach($productPages as $pageIndex => $pageProducts)
        @php
            $isFirstPage = ($pageIndex == 0);
            $isLastProductPage = ($pageIndex == $totalProductPages - 1);
            $pageNumber = $currentPageNumber++;
            $startingSerial = ($pageIndex * $productsPerPage) + 1;
        @endphp

        <div @if(!$isFirstPage) style="page-break-before: always;" @endif>

            @if($isFirstPage)
                <!-- ============================ -->
                <!-- PAGE 1: FULL HEADER -->
                <!-- ============================ -->
                <div class="page-header">
                    <table class="full-w" style="width:100%; border-collapse:collapse;">
                        <tr>
                            <!-- LEFT SIDE: LOGO AND COMPANY INFO -->
                            <td style="width:45%; vertical-align:top; font-size:9px; padding:0; margin:0;">
                                @if($logoData)
                                    <img src="{{ $logoData }}" alt="Logo" width="200" height="80" style="width:200px; height:auto; max-width:200px; max-height:90px; display:block; object-fit:contain;">
                                @endif

                                {{-- Letterhead block — uniform 6px row gap + line-height:1.55
                                     gives the professional "breathing" rhythm the reference uses.
                                     Section break before "One Star Export House Details :" bumps
                                     to 10px so it reads as a sub-section divider, not just
                                     another row in the same group. --}}
                                <div style="margin-top:12px; font-size:9px; line-height:14px;">
                                    <strong style="display:block; font-size:9px; margin-bottom:6px; color:#666666;">
                                        {{ ucwords(strtolower($companyDetails->name)) }}
                                    </strong>
                                    <div style="margin-bottom:6px;">{{ $companyDetails->address }}</div>
                                    <div style="margin-bottom:6px;">{{ $companyDetails->mobile }}</div>
                                    <div style="margin-bottom:6px;">{{ $companyDetails->email }}</div>
                                    <div style="margin-bottom:6px;"><strong>GST No : </strong>{{ $companyDetails->gst_no }}</div>
                                    <div style="margin-bottom:6px;"><strong>GST State Code : </strong>{{ $companyDetails->gst_state_code }}</div>
                                    <div style="margin-bottom:6px;"><strong>PAN No : </strong>{{ $companyDetails->pan_no }}</div>
                                    <div style="margin-bottom:6px;"><strong>CIN : </strong>{{ $companyDetails->cin }}</div>
                                    <div style="margin-bottom:6px;"><strong>IEC : </strong>{{ $companyDetails->iec }}</div>
                                    <div style="margin-bottom:6px;"><strong>Drug License : </strong>{{ $companyDetails->drug_license }}</div>
                                    <div style="margin-bottom:6px;"><strong>PCPNDT No : </strong>{{ $companyDetails->pcpndt_no }}</div>
                                    <div style="margin-bottom:10px;"><strong>AEO Code : </strong>{{ $companyDetails->aeo_code }}</div>
                                    <div style="margin-bottom:6px;"><strong>One Star Export House Details :</strong></div>
                                    <div style="margin-bottom:6px;"><strong>File No : </strong>{{ $companyDetails->onestartfilename }}</div>
                                    <div style="margin-bottom:0;"><strong>UDIN No : </strong>{{ $companyDetails->onestarudinumber }}</div>
                                </div>
                            </td>

                            <!-- RIGHT SIDE: PI INFO -->
                            <td style="width:60%; vertical-align:top;  padding-top:-15px;">
                                <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                    <tr>
                                        <td style="width:35%;"></td>
                                        <td style="width:65%; text-align:left;">
                                            {{-- Title matches the reference Inorbvict PDF: heavy weight 900,
                                                 pure black, ultra-tight line-height so "QUOTATION" and
                                                 "DOCUMENT" sit directly on top of each other instead of
                                                 having a full line-gap between them. --}}
                                            @if (Str::wordCount($pdf_title) > 3)
                                                <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h4>
                                            @else
                                                <h3 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; letter-spacing:-0.3px; white-space:nowrap; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h3>
                                            @endif

                                            <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                                <tr>
                                                    <td style="width:60%; font-size:9px;">
                                                        <div><strong>{{ $doc_label_short ?? 'PI' }} No :</strong> {{ $quotation->pi_number }}</div>
                                                        <div><strong>{{ $doc_label_short ?? 'PI' }} Date :</strong>
                                                            {{ date('d/m/Y', strtotime($quotation->pi_date)) }}</div>
                                                    </td>
                                                    <td style="width:40%; text-align:right;">
                                                        @if(!empty($barcodeData))
                                                            {{-- Branch has a website → render real scannable Code128
                                                                 + the URL below in a clean PDF font. --}}
                                                            <img src="{{ $barcodeData }}" alt="Barcode" width="130" height="30" style="width:130px; height:30px; display:block; margin-left:auto;">
                                                            <div style="font-size:7.5px; color:#333; text-align:center; word-break:break-all; line-height:9px; margin-top:2px; max-width:140px; margin-left:auto;">
                                                                {{ $barcodeText ?? ($companyDetails->website ?? '') }}
                                                            </div>
                                                        @else
                                                            {{-- No website on the branch → branch name takes the slot.
                                                                 Same right-aligned, ~140px wide, so the header strip
                                                                 stays balanced. --}}
                                                            <div style="font-size:11px; font-weight:bold; color:#666666; text-align:right; line-height:13px; max-width:140px; margin-left:auto; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                                {{ $companyDetails->name ?? '' }}
                                                            </div>
                                                        @endif
                                                    </td>
                                                </tr>
                                            </table>

                                            @if($quotation->document_type == "International")
                                                {{-- Document detail block — Doc Type / Opp / Ports / Inco / etc.
                                                     PI No + Date are already rendered in the small block above
                                                     next to the barcode, so we DON'T repeat them here (the old
                                                     template was emitting them twice). Net/Gross Weight rows are
                                                     also dropped — the Quotation model doesn't carry them and
                                                     the blank "Net Weight (kg) :" labels just took space. --}}
                                                {{-- Right-column document info — same uniform 6px row gap
                                                     + 14px line-height as the letterhead on the left so the
                                                     two columns share the same rhythm row-for-row. --}}
                                                <div style="margin-top:12px; font-size:9px; line-height:14px;">
                                                    <div style="margin-bottom:6px;"><strong>Document Type :</strong> {{ $quotation->document_type }}</div>
                                                    <div style="margin-bottom:6px;"><strong>Opportunity ID :</strong> {{ $opportunity_id }}</div>
                                                    <div style="margin-bottom:6px;"><strong>Opportunity Date :</strong>
                                                        {{ $opportunity_date ? $opportunity_date->format('d/m/Y') : '' }}
                                                    </div>
                                                    <div style="margin-bottom:6px;"><strong>Currency :</strong> {{ $quotation->currency->name ?? '' }}</div>
                                                    @if($quotation->portOfLoading ?? null)
                                                        <div style="margin-bottom:6px;"><strong>Port Of Loading :</strong>
                                                            {{ $quotation->portOfLoading->code }}-{{ $quotation->portOfLoading->name }}{{ $quotation->portOfLoading->address ? ', '.$quotation->portOfLoading->address : '' }}
                                                        </div>
                                                    @else
                                                        <div style="margin-bottom:6px;"><strong>Port Of Loading :</strong></div>
                                                    @endif
                                                    <div style="margin-bottom:6px;"><strong>Port of Discharge :</strong> {{ $quotation->port_of_discharge }}</div>
                                                    <div style="margin-bottom:6px;"><strong>Final Destination :</strong> {{ $quotation->final_destination }}</div>
                                                    <div style="margin-bottom:6px;"><strong>Country of Origin :</strong> {{ $quotation->origin_country }}</div>
                                                    <div style="margin-bottom:0;"><strong>INCO Term :</strong> {{ $quotation->inco_term_name }}</div>
                                                </div>
                                            @endif
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>

                    <hr style="border: 0.1px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

                    {{-- BUYER & CONSIGNEE — same uniform 6px row gap + 14px line-height as
                         the letterhead above, so the two columns share a consistent rhythm
                         instead of the previous cramped <br>-stacked block. --}}
                    <table class="full-w" style="width:100%; border-collapse:collapse; margin-top:8px;">
                        <tr>
                            <td style="width:50%; font-size:9px; line-height:14px; vertical-align: top; padding:6px 0;">
                                <div style="margin-bottom:6px;"><strong>Buyer Name : </strong>{{ $buyerDetails->name }}</div>
                                <div style="margin-bottom:6px;">{{ $buyerDetails->address }}</div>
                                <div style="margin-bottom:6px;">{{ $buyerDetails->email }}</div>
                                <div style="margin-bottom:0;">{{ $buyerDetails->contact_no }}</div>
                            </td>
                            <td style="width:50%; font-size:9px; line-height:14px; vertical-align: top; padding:6px 0;">
                                <div style="margin-left:95px;">
                                    @if(empty($quotation->consignee_id))
                                        <div style="margin-bottom:6px;"><strong>Consignee Name : </strong>{{ $buyerDetails->name }}</div>
                                        <div style="margin-bottom:6px;">{{ $buyerDetails->address }}</div>
                                        <div style="margin-bottom:6px;">{{ $buyerDetails->email }}</div>
                                        <div style="margin-bottom:0;">{{ $buyerDetails->contact_no }}</div>
                                    @else
                                        <div style="margin-bottom:6px;"><strong>Consignee Name : </strong>{{ $consigneeDetails->name ?? '' }}</div>
                                        <div style="margin-bottom:6px;">{{ $consigneeDetails->address ?? '' }}</div>
                                        <div style="margin-bottom:6px;">{{ $consigneeDetails->email ?? '' }}</div>
                                        <div style="margin-bottom:0;">{{ $consigneeDetails->mobile ?? '' }}</div>
                                    @endif
                                </div>
                            </td>
                        </tr>
                    </table>
                </div>
            @else
                <!-- ============================ -->
                <!-- PAGES 2, 3, 4...: SUB-HEADER -->
                <!-- ============================ -->
                <div class="sub-header">
                    <table class="full-w" style="width:100%; border-collapse:collapse;">
                        <tr>
                            <td style="width:45%; vertical-align:top; font-size:9px; padding:0; margin:0;">
                                @if($logoData)
                                    <img src="{{ $logoData }}" alt="Logo" width="200" height="80" style="width:200px; height:auto; max-width:200px; max-height:90px; display:block; object-fit:contain;">
                                @endif
                            </td>
                            <td style="width:60%; vertical-align:top; padding:0; margin:0;">
                                <table style="width:100%; border-collapse:collapse; margin-top:15px;">
                                    <tr>
                                        <td style="width:35%;"></td>
                                        <td style="width:65%; text-align:left;">
                                            @if (Str::wordCount($pdf_title) > 3)
                                                <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h4>
                                            @else
                                                <h3 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; letter-spacing:-0.3px; white-space:nowrap; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h3>
                                            @endif

                                            <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                                <tr>
                                                    <td style="width:60%; font-size:9px;">
                                                        <div><strong>{{ $doc_label_short ?? 'PI' }} No :</strong> {{ $quotation->pi_number }}</div>
                                                        <div><strong>{{ $doc_label_short ?? 'PI' }} Date :</strong>
                                                            {{ date('d/m/Y', strtotime($quotation->pi_date)) }}
                                                        </div>
                                                    </td>
                                                    <td style="width:40%; text-align:right;">
                                                        @if(!empty($barcodeData))
                                                            {{-- Branch has a website → render real scannable Code128
                                                                 + the URL below in a clean PDF font. --}}
                                                            <img src="{{ $barcodeData }}" alt="Barcode" width="130" height="30" style="width:130px; height:30px; display:block; margin-left:auto;">
                                                            <div style="font-size:7.5px; color:#333; text-align:center; word-break:break-all; line-height:9px; margin-top:2px; max-width:140px; margin-left:auto;">
                                                                {{ $barcodeText ?? ($companyDetails->website ?? '') }}
                                                            </div>
                                                        @else
                                                            {{-- No website on the branch → branch name takes the slot.
                                                                 Same right-aligned, ~140px wide, so the header strip
                                                                 stays balanced. --}}
                                                            <div style="font-size:11px; font-weight:bold; color:#666666; text-align:right; line-height:13px; max-width:140px; margin-left:auto; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                                {{ $companyDetails->name ?? '' }}
                                                            </div>
                                                        @endif
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </div>
            @endif

            <!-- ============================ -->
            <!-- PRODUCT TABLE FOR THIS PAGE -->
            <!-- ============================ -->
            <section class="product-area">
                <table class="prod_table" style="table-layout: fixed; font-size:9px; width:100%;">
                    <thead>
                        {{-- Column widths sum to 100%. Widened the cramped columns
                             (Sr No, Product Code, Tax Amt, Rate+Tax, Amount) so the
                             header labels stay on a single line; the Description
                             column absorbs the lost width since it's the only one
                             that wraps gracefully. --}}
                        <tr style="background-color:{{ $companyDetails->primary_color ?? '#7CB342' }}; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }};">
                            <th style="width:5%;  text-align: center;">Sr No</th>
                            <th style="width:10%; text-align: center;">Product Code</th>
                            <th style="width:16%; text-align: left;">Product Name</th>
                            <th style="width:18%; text-align: left;">Description</th>
                            <th style="width:6%;  text-align: center;">Qty</th>
                            <th style="width:9%;  text-align: right;">Rate</th>
                            <th style="width:7%;  text-align: center;">Tax%</th>
                            <th style="width:9%;  text-align: right;">Tax Amt</th>
                            <th style="width:10%; text-align: right;">Rate+Tax</th>
                            <th style="width:10%; text-align: right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($pageProducts as $product)
                            <tr>
                                <td style="width:5%;  text-align: center;">{{ $startingSerial++ }}</td>
                                <td style="width:10%; text-align: center;">{{ $product['product_code'] ?: '—' }}</td>
                                <td style="width:16%; text-align: left;">{{ $product['product_name'] }}</td>
                                <td class="description-cell" style="width:18%; text-align: left;">
                                    {{ !empty($product['product_description']) ? $product['product_description'] : '-' }}
                                </td>
                                <td style="width:6%;  text-align: center;">{{ rtrim(rtrim(number_format($product['quantity'], 3, '.', ','), '0'), '.') }}</td>
                                <td style="width:9%;  text-align: right;">{{ number_format($product['rate'], 2) }}</td>
                                <td style="width:7%;  text-align: center;">{{ number_format($product['tax_pct'] ?? 0, 2) }}%</td>
                                <td style="width:9%;  text-align: right;">{{ number_format($product['tax_amt'] ?? 0, 2) }}</td>
                                <td style="width:10%; text-align: right;">{{ number_format($product['rate_with_tax'] ?? $product['rate'], 2) }}</td>
                                <td style="width:10%; text-align: right;">{{ number_format($product['amount'], 2) }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            </section>

            <!-- ============================ -->
            <!-- FOOTER ON LAST PRODUCT PAGE (IF SPACE) -->
            <!-- ============================ -->
            @if($isLastProductPage && !$footerNeedsNewPage)
                <div style="margin-top: 20px;">
                    <hr style="border: 0.2px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

                    {{-- Bank / Totals row — sized for PDF-print balance:
                           • QR cell: ~18% width to fit a 100×100 code with a 16px gap to the bank block
                           • Bank details: 52% — labels #555, values inherit #777 from body
                           • Totals: 30% — Grand Total emphasized 1.5× the surrounding rows --}}
                    <table style="width:100%; border-collapse:collapse; margin-top:12px;">
                        <tr>
                            <!-- LEFT: QR CODE (100×100 print size, 16px right gap) -->
                            <td style="width:18%; vertical-align: top; padding-right:16px;">
                                @if(!empty($qrData))
                                    <img src="{{ $qrData }}" alt="Bank Payment QR" width="100" height="100" style="width:100px; height:100px; display:block;">
                                @else
                                    <span class="qr-placeholder"></span>
                                @endif
                            </td>

                            <!-- MIDDLE: BANK DETAILS — 9px Helvetica, labels #555 bold, values #777 normal -->
                            <td style="width:52%; vertical-align: top; font-size:9px; line-height:14px; padding-right:24px;">
                                <div style="margin-bottom:6px;"><strong style="color:#555;">Bank Name :</strong> {{ $bankDetails->bank_name }}</div>
                                <div style="margin-bottom:6px;"><strong style="color:#555;">Account Holder Name :</strong> {{ $bankDetails->account_holder_name }}</div>
                                <div style="margin-bottom:6px;"><strong style="color:#555;">Address :</strong> {{ $bankDetails->address }}</div>
                                <div style="margin-bottom:6px;">
                                    <strong style="color:#555;">Branch :</strong> {{ $bankDetails->branch }}
                                    &nbsp;&nbsp;
                                    <strong style="color:#555;">Branch Code :</strong> {{ $bankDetails->branch_code }}
                                    &nbsp;&nbsp;
                                    <strong style="color:#555;">Ad Code :</strong> {{ $bankDetails->ad_code }}
                                </div>
                                <div style="margin-bottom:6px;">
                                    <strong style="color:#555;">Account No :</strong> {{ $bankDetails->account_no }}
                                    &nbsp;&nbsp;
                                    <strong style="color:#555;">IFSC :</strong> {{ $bankDetails->ifsc }}
                                </div>
                                <div style="margin-bottom:0;"><strong style="color:#555;">Swift Code :</strong> {{ $bankDetails->swift_code }}</div>
                            </td>

                            <!-- RIGHT: TOTALS — labels #555 bold, values #777, Grand Total emphasized -->
                            <td style="width:30%; vertical-align: top;">
                                <table style="width:100%; font-size:9px; line-height:14px; border-collapse:collapse;">
                                    <tr>
                                        <td style="padding:3px 0;"><strong style="color:#555;">Sub Total</strong></td>
                                        <td style="text-align:right; padding:3px 0;"><strong style="color:#555;">{{ number_format($quotation->total, 2) }}</strong></td>
                                    </tr>
                                    {{-- IGST / CGST / SGST always render (matches the reference
                                         Inorbvict totals stack — Sub Total → IGST → CGST → SGST →
                                         Grand Total). Values come from the quotation row; they're
                                         0.00 when the doc_type doesn't apply that tax bucket. --}}
                                    <tr>
                                        <td style="padding:3px 0; color:#555;">IGST</td>
                                        <td style="text-align:right; padding:3px 0;">{{ number_format($quotation->igst, 2) }}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:3px 0; color:#555;">CGST</td>
                                        <td style="text-align:right; padding:3px 0;">{{ number_format($quotation->cgst, 2) }}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:3px 0; color:#555;">SGST</td>
                                        <td style="text-align:right; padding:3px 0;">{{ number_format($quotation->sgst, 2) }}</td>
                                    </tr>
                                    {{-- Grand Total highlighted — larger font, bolder, with a top
                                         border separator so the eye lands on it as the row that
                                         actually matters. --}}
                                    <tr>
                                        <td style="padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd;"><strong>Grand Total:</strong></td>
                                        <td style="text-align:right; padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd;">
                                            <strong>{{ $quotation->currency_name }} {{ number_format($quotation->grand_total, 2) }}</strong>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>

                    <!-- AMOUNT IN WORDS — text color adapts to whatever
                         primary color the branch picked (white on dark
                         brand colors, near-black on light ones) so it
                         stays readable no matter the theme. -->
                    <div style="width:100%; display:block; font-size:10px; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }}; margin-top:10px; margin-bottom:15px; text-align:left; padding:8px 14px; background-color:{{ $companyDetails->primary_color ?? '#7CB342' }}; box-sizing:border-box; line-height: 14px; font-weight:600;">
                        <strong style="text-transform:capitalize; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }};">
                            Amount In Words :
                            {{ $quotation->currency_name ?? 'INR' }}
                            {{ $amountInWords }}
                        </strong>
                    </div>

                    <!-- SIGNATURE SECTION -->
                    @if ($signature == 'Yes')
                        <section>
                            <table style="width:100%;">
                                <tr>
                                    <td style="width:50%; vertical-align: top; font-size:9px;">
                                        For {{ ucwords(strtolower($companyDetails->name)) }}<br>
                                        @if($signatureData)
                                            {{-- Branch-uploaded signature image. Capped to 110×90 so
                                                 it lines up with the layout's signature column without
                                                 distorting the page balance. --}}
                                            <div style="margin: 6px 0;">
                                                <img src="{{ $signatureData }}" alt="Authorised Signatory"
                                                     style="max-width:140px; max-height:80px; display:block;">
                                            </div>
                                        @else
                                            {{-- Fallback CSS "stamp" for branches without an uploaded
                                                 signature image — keeps the with-signature variant
                                                 visually distinct from the without-signature one. --}}
                                            <table style="margin: 6px 0;">
                                                <tr>
                                                    <td style="width: 90px; height: 90px; border: 2px solid #1e3a8a; border-radius: 90px; text-align: center; vertical-align: middle; color: #1e3a8a; font-weight: 700; font-style: italic; font-size: 9px; line-height: 11px;">
                                                        {{ strtoupper(explode(' ', $companyDetails->name)[0]) }}<br>
                                                        <span style="font-size:7px;">• AUTHORISED •</span><br>
                                                        SIGNED
                                                    </td>
                                                </tr>
                                            </table>
                                        @endif
                                        <strong>Authorized Signatory</strong>
                                    </td>
                                    <td style="width:50%; vertical-align: top;padding-top: 7px; font-size:9px; text-align: right;padding-right: 30px;">
                                        Accept & Acknowledge,<strong> {{ $buyerDetails->name }}</strong><br>
                                        <br>
                                        <div style="margin-top: 75px;"></div>
                                        <div style="display: inline-block; text-align: center;padding-right:40px;">
                                            <div style="border-bottom: 1px solid black; width: 100px; margin: 0 auto;"></div>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </section>
                    @endif
                </div>
            @endif
        </div>
    @endforeach

    <!-- ============================ -->
    <!-- SEPARATE FOOTER PAGE (IF NEEDED) -->
    <!-- ============================ -->
    @if($footerNeedsNewPage)
        <div style="page-break-before: always;">
            <div class="sub-header">
                <table class="full-w" style="width:100%; border-collapse:collapse;">
                    <tr>
                        <td style="width:45%; vertical-align:top; font-size:9px; padding:0; margin:0;">
                            @if($logoData)
                                <img src="{{ $logoData }}" alt="Logo" width="200" height="80" style="width:200px; height:auto; max-width:200px; max-height:90px; display:block; object-fit:contain;">
                            @endif
                        </td>
                        <td style="width:60%; vertical-align:top; padding:0; margin:0;">
                            <table style="width:100%; border-collapse:collapse; margin-top:15px;">
                                <tr>
                                    <td style="width:35%;"></td>
                                    <td style="width:65%; text-align:left;">
                                        @if (Str::wordCount($pdf_title) > 3)
                                            <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                {{ strtoupper($pdf_title) }}
                                            </h4>
                                        @else
                                            <h3 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; letter-spacing:-0.3px; white-space:nowrap; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                                {{ strtoupper($pdf_title) }}
                                            </h3>
                                        @endif

                                        <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                            <tr>
                                                <td style="width:60%; font-size:9px;">
                                                    <div><strong>{{ $doc_label_short ?? 'PI' }} No :</strong> {{ $quotation->pi_number }}</div>
                                                    <div><strong>{{ $doc_label_short ?? 'PI' }} Date :</strong>
                                                        {{ date('d/m/Y', strtotime($quotation->pi_date)) }}
                                                    </div>
                                                </td>
                                                <td style="width:40%; text-align:right;">
                                                    @if(!empty($barcodeData))
                                                            <img src="{{ $barcodeData }}" alt="Barcode" width="130" height="38" style="width:130px; height:38px; display:block; margin-left:auto;">
                                                        @else
                                                            <span class="barcode-strip barcode-strip-lg"></span>
                                                        @endif
                                                    <div style="font-size:8px; text-align:center;">
                                                        {{ $companyDetails->website }}
                                                    </div>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </div>

            <div style="margin-top: 20px;">
                <hr style="border: 0.2px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

                <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                    <tr>
                        <td style="width:20%; vertical-align: top; font-size:9px; padding-right:10px;">
                            @if(!empty($qrData))
                                <img src="{{ $qrData }}" alt="Bank Payment QR" width="84" height="84" style="width:84px; height:84px; display:block;">
                            @else
                                <span class="qr-placeholder"></span>
                            @endif
                        </td>
                        <td style="width:50%; vertical-align: top; font-size:9px; padding-right:10px;">
                            <strong>Bank Name :</strong> {{ $bankDetails->bank_name }}<br>
                            <strong>Account Holder Name :</strong> {{ $bankDetails->account_holder_name }}<br>
                            <strong>Address :</strong> {{ $bankDetails->address }}<br>
                            <strong>Branch :</strong> {{ $bankDetails->branch }}
                            &nbsp;&nbsp;
                            <strong>Branch Code :</strong> {{ $bankDetails->branch_code }}<br>
                            <strong>Ad Code :</strong> {{ $bankDetails->ad_code }}
                            &nbsp;&nbsp;
                            <strong>Account No :</strong> {{ $bankDetails->account_no }}<br>
                            <strong>IFSC :</strong> {{ $bankDetails->ifsc }}
                            &nbsp;&nbsp;
                            <strong>Swift Code :</strong> {{ $bankDetails->swift_code }}
                        </td>
                        <td style="width:30%; vertical-align: top;">
                            <table style="width:100%; font-size:9px; border-collapse:collapse;">
                                <tr>
                                    <th style="text-align:left;"><strong>SUB TOTAL</strong></th>
                                    <th style="text-align:right;">
                                        <strong>{{ number_format($quotation->total, 2) }}</strong>
                                    </th>
                                </tr>
                                @if ($quotation->document_type == "Domestic")
                                    <tr><td>IGST</td><td style="text-align:right;">{{ number_format($quotation->igst, 2) }}</td></tr>
                                    <tr><td>CGST</td><td style="text-align:right;">{{ number_format($quotation->cgst, 2) }}</td></tr>
                                    <tr><td>SGST</td><td style="text-align:right;">{{ number_format($quotation->sgst, 2) }}</td></tr>
                                @endif
                                @if($quotation->document_type == "International")
                                    <tr>
                                        <td>Shipping Cost</td>
                                        <td style="text-align:right;">{{ number_format($quotation->shipping_cost, 2) }}</td>
                                    </tr>
                                @endif
                                <tr>
                                    <td><strong>Grand Total:</strong></td>
                                    <td style="text-align:right;">
                                        <strong>{{ $quotation->currency_name }}
                                            {{ number_format($quotation->grand_total, 2) }}</strong>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <div style="width:100%; display:block; font-size:9px; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }}; margin-top:15px; margin-bottom:15px; text-align:left; padding:6px; background-color:{{ $companyDetails->primary_color ?? '#7CB342' }}; box-sizing:border-box;">
                    <strong style="text-transform:capitalize; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }};">
                        Amount In Words :
                        {{ $quotation->currency_name }}
                        {{ $amountInWords }}
                    </strong>
                </div>

                @if ($signature == 'Yes')
                    <section>
                        <table style="width:100%;">
                            <tr>
                                <td style="width:50%; vertical-align: top; text-align: left; font-size:9px;">
                                    <br>
                                    For {{ ucwords(strtolower($companyDetails->name)) }}<br>
                                    <table style="margin: 6px 0 6px 10px;">
                                        <tr>
                                            <td style="width: 90px; height: 90px; border: 2px solid #1e3a8a; border-radius: 90px; text-align: center; vertical-align: middle; color: #1e3a8a; font-weight: 700; font-style: italic; font-size: 9px; line-height: 11px;">
                                                {{ strtoupper(explode(' ', $companyDetails->name)[0]) }}<br>
                                                <span style="font-size:7px;">• AUTHORISED •</span><br>
                                                SIGNED
                                            </td>
                                        </tr>
                                    </table>
                                    <strong style="display: block; color: #000000; margin-left:20px">Authorized Signatory</strong>
                                </td>
                                <td style="width:50%; vertical-align: top; font-size:9px;">
                                    <div style="text-align: right; padding-top: 95px;">
                                        <div style="display: inline-block; text-align: center;">
                                            <div style="font-size: 11px; color: #000000;"><strong>Customer Signature</strong></div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </section>
                @endif
            </div>
        </div>
    @endif

    {{-- The dedicated "Terms & Conditions" force-page block that lived
         here was deliberately removed. The reference Quotation PDF keeps
         everything on page 1 (or page 2 only when products overflow);
         the T&C text is sent in the quotation email body / contract,
         not on the PDF. If a future requirement brings T&C back, render
         it inline above the signature block in the main content above,
         not on its own page. --}}
</div>

<script type="text/php">
if (isset($pdf)) {
    // Page pagination "1 / 3" — drawn AFTER the page is rendered (the
    // script-text block is the only DomPDF hook that has access to
    // {PAGE_COUNT}, since the total page count isn't known until
    // rendering finishes).
    //
    // Coordinates use $pdf->get_width() / $pdf->get_height() instead of
    // hardcoded A4 values so the position stays correct if the page
    // size changes. Y = height − 28 keeps the text inside the printable
    // area (below that and DomPDF clips it — earlier Y=828 was below
    // the bottom margin and didn't render at all).
    //
    // Font is DejaVu Sans because it's the only font we can rely on
    // being registered in the DomPDF cache; "helvetica" silently
    // falls back to a default that doesn't always draw via page_text().
    // Page indicator — "Page 1 of 3" centered just beneath the footer
    // table, in the @page bottom margin area.
    $font = $fontMetrics->get_font("DejaVu Sans", "normal");
    $size = 9;
    $text = "Page {PAGE_NUM} of {PAGE_COUNT}";
    $width = $fontMetrics->get_text_width($text, $font, $size);
    $x = ($pdf->get_width() - $width) / 2;
    $y = $pdf->get_height() - 18;
    $pdf->page_text($x, $y, $text, $font, $size, [0.2, 0.2, 0.2]);
}
</script>

</body>
</html>
