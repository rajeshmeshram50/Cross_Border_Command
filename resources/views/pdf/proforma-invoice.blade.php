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
        border-top: 1px solid #37B1E0;
        padding: 5px 0;
        background: white;
        z-index: 1000;
    }

    body {
        margin-bottom: 10px;
        /* DejaVu Sans ships with DomPDF and carries µ, ×, É, ®, … glyphs
           that the line-item descriptions use. Arial/Helvetica fall back
           to a TTF that misses those and renders boxes / mojibake. */
        font-family: "DejaVu Sans", Arial, Helvetica, sans-serif;
        position: relative;
    }

    body, table, tr, td, th, div, p, span, strong, li { line-height: 15px; }

    /* Table styling */
    .prod_table { width: 100%; border-collapse: collapse; font-size: 9px; font-family: "DejaVu Sans", Arial, sans-serif; }
    .prod_table thead { display: table-header-group; }
    .prod_table tr { page-break-inside: avoid; }
    .prod_table td.description-cell { word-wrap: break-word; white-space: normal; }
    .prod_table td, .prod_table th { padding: 4px; vertical-align: top; }

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

<!-- GLOBAL FOOTER -->
<div class="pdf-footer">
    <table style="width: 100%; border-collapse: collapse; margin: 0;">
        <tr>
            <td style="width: 15%; text-align: left; vertical-align: middle; padding-left: 10px;">
                <span class="barcode-strip barcode-strip-sm"></span>
            </td>
            <td style="width: 70%; text-align: center; vertical-align: middle; font-size: 9px; color: #333;">
                {{ $companyDetails->name }} | CIN: {{ $companyDetails->cin }} | GST: {{ $companyDetails->gst_no }} | PAN: {{ $companyDetails->pan_no }}
            </td>
            <td style="width: 15%; text-align: right; vertical-align: middle; padding-right: 10px; font-size: 9px;"></td>
        </tr>
    </table>
</div>

<!-- MAIN CONTENT -->
<div class="content-wrapper main-content">
    @php
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

        // Resolve logo once — using IGC project logo.
        $logoPath = public_path('images/igc-logo.png');
        $logoData = file_exists($logoPath)
            ? 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath))
            : null;
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
                                    <img src="{{ $logoData }}" alt="Logo" style="max-width:120px; display:block;">
                                @endif

                                <div>
                                    <br>
                                    <strong style="display:block; margin-top:0px;">
                                        {{ ucwords(strtolower($companyDetails->name)) }}
                                    </strong>
                                    {{ $companyDetails->address }}<br>
                                    {{ $companyDetails->mobile }}<br>
                                    {{ $companyDetails->email }}<br>
                                    <strong>GST No : </strong>{{ $companyDetails->gst_no }}<br>
                                    <strong>GST State Code : </strong>{{ $companyDetails->gst_state_code }}<br>
                                    <strong>PAN No : </strong>{{ $companyDetails->pan_no }}<br>
                                    <strong>CIN : </strong>{{ $companyDetails->cin }}<br>
                                    <strong>IEC : </strong>{{ $companyDetails->iec }}<br>
                                    <strong>Drug License : </strong>{{ $companyDetails->drug_license }}<br>
                                    <strong>PCPNDT No : </strong>{{ $companyDetails->pcpndt_no }}<br>
                                    <strong>AEO Code : </strong>{{ $companyDetails->aeo_code }}<br>
                                    <strong>One Star Export House Details:-</strong><br>
                                    <strong>File No : </strong>{{ $companyDetails->onestartfilename }}<br>
                                    <strong>UDIN No: </strong>{{ $companyDetails->onestarudinumber }}<br>
                                </div>
                            </td>

                            <!-- RIGHT SIDE: PI INFO -->
                            <td style="width:60%; vertical-align:top;  padding-top:-15px;">
                                <table style="width:100%; border-collapse:collapse; margin-top:15px;">
                                    <tr>
                                        <td style="width:35%;"></td>
                                        <td style="width:65%; text-align:left;">
                                            @if (Str::wordCount($pdf_title) > 3)
                                                <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h4>
                                            @else
                                                <h3 style="margin:0; padding:0; font-weight:bold; font-size:22px;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h3>
                                            @endif

                                            <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                                <tr>
                                                    <td style="width:60%; font-size:9px;">
                                                        <div><strong>PI No :</strong> {{ $quotation->pi_number }}</div>
                                                        <div><strong>PI Date :</strong>
                                                            {{ date('d/m/Y', strtotime($quotation->pi_date)) }}</div>
                                                    </td>
                                                    <td style="width:40%; text-align:right;">
                                                        <span class="barcode-strip barcode-strip-lg"></span>
                                                        <div style="font-size:8px; text-align:center;">
                                                            {{ $companyDetails->website }}
                                                        </div>
                                                    </td>
                                                </tr>
                                            </table>

                                            @if($quotation->document_type == "International")
                                                <div style="margin-top:15px; font-size:9px;">
                                                    <div><strong>PI No :</strong> {{ $quotation->pi_number }}</div>
                                                    <div><strong>PI Date :</strong>
                                                        {{ date('d/m/Y', strtotime($quotation->pi_date)) }}</div>
                                                    <div><strong>Opportunity ID :</strong> {{ $opportunity_id ?? 'NA' }}</div>
                                                    <div><strong>Opportunity Date :</strong>
                                                        {{ $opportunity_date ? $opportunity_date->format('d/m/Y') : 'NA' }}
                                                    </div>
                                                    <div><strong>Currency :</strong> {{ $quotation->currency->name }}</div>
                                                    @if($quotation->portOfLoading ?? null)
                                                        <div><strong>Port Of Loading:</strong>
                                                            {{ $quotation->portOfLoading->code }}-{{ $quotation->portOfLoading->name }},
                                                            {{ $quotation->portOfLoading->address }}
                                                        </div>
                                                    @endif
                                                    <div><strong>Port of Discharge :</strong> {{ $quotation->port_of_discharge }}</div>
                                                    <div><strong>Final Destination :</strong> {{ $quotation->final_destination }}</div>
                                                    <div><strong>Country of Origin :</strong> {{ $quotation->origin_country }}</div>
                                                    <div><strong>INCO Term :</strong> {{ $quotation->inco_term_name }}</div>
                                                    <div><strong>Net Weight (kg) :</strong> {{ $quotation->net_weight }}</div>
                                                    <div><strong>Gross Weight (kg) :</strong> {{ $quotation->gross_weight }}</div>
                                                </div>
                                            @endif
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>

                    <hr style="border: 0.1px solid #37B1E0; margin-top:5px; margin-bottom:5px;">

                    <!-- BUYER & CONSIGNEE DETAILS (FIRST PAGE ONLY) -->
                    <table class="full-w" style="width:100%; border-collapse:collapse;">
                        <tr>
                            <td style="width:50%; font-size:9px; vertical-align: top;">
                                <strong>Buyer Name : </strong>{{ $buyerDetails->name }}<br>
                                {{ $buyerDetails->address }}<br>
                                {{ $buyerDetails->email }}<br>
                                {{ $buyerDetails->contact_no }}
                            </td>
                            <td style="width:50%; font-size:9px; vertical-align: top;">
                                <div style="margin-left:95px;">
                                    @if(empty($quotation->consignee_id))
                                        <strong>Consignee Name : </strong>{{ $buyerDetails->name }}<br>
                                        {{ $buyerDetails->address }}<br>
                                        {{ $buyerDetails->email }}<br>
                                        {{ $buyerDetails->contact_no }}
                                    @else
                                        <strong>Consignee Name :</strong> {{ $consigneeDetails->name ?? '' }}<br>
                                        {{ $consigneeDetails->address ?? '' }}<br>
                                        {{ $consigneeDetails->email ?? '' }}<br>
                                        {{ $consigneeDetails->mobile ?? '' }}
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
                                    <img src="{{ $logoData }}" alt="Logo" style="max-width:120px; display:block;">
                                @endif
                            </td>
                            <td style="width:60%; vertical-align:top; padding:0; margin:0;">
                                <table style="width:100%; border-collapse:collapse; margin-top:15px;">
                                    <tr>
                                        <td style="width:35%;"></td>
                                        <td style="width:65%; text-align:left;">
                                            @if (Str::wordCount($pdf_title) > 3)
                                                <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h4>
                                            @else
                                                <h3 style="margin:0; padding:0; font-weight:bold; font-size:22px;">
                                                    {{ strtoupper($pdf_title) }}
                                                </h3>
                                            @endif

                                            <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                                <tr>
                                                    <td style="width:60%; font-size:9px;">
                                                        <div><strong>PI No :</strong> {{ $quotation->pi_number }}</div>
                                                        <div><strong>PI Date :</strong>
                                                            {{ date('d/m/Y', strtotime($quotation->pi_date)) }}
                                                        </div>
                                                    </td>
                                                    <td style="width:40%; text-align:right;">
                                                        <span class="barcode-strip barcode-strip-lg"></span>
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
            @endif

            <!-- ============================ -->
            <!-- PRODUCT TABLE FOR THIS PAGE -->
            <!-- ============================ -->
            <section class="product-area">
                <table class="prod_table" style="table-layout: fixed; font-size:9px; width:100%;">
                    <thead>
                        <tr style="background-color:#37B1E0; color:white;">
                            <th style="width:5%; text-align: center;">Sr No</th>
                            <th style="width:20%;">Product Name</th>
                            <th style="width:15%;">Brand</th>
                            <th style="width:35%;">Description</th>
                            <th style="width:5%; text-align: center;">Qty</th>
                            <th style="width:10%; text-align: center;">Rate</th>
                            <th style="width:15%; text-align: center;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($pageProducts as $product)
                            <tr style="vertical-align:top;">
                                <td style="width:5%; text-align: center;">{{ $startingSerial++ }}</td>
                                <td style="width:20%;">{{ $product['product_name'] }}</td>
                                <td style="width:15%;">
                                    {{ !empty($product['model_name']) ? $product['model_name'] : 'NA' }}
                                </td>
                                <td class="description-cell" style="width:35%;">
                                    {{ !empty($product['product_description']) ? $product['product_description'] : '-' }}
                                </td>
                                <td style="width:5%; text-align: center;">{{ $product['quantity'] }}</td>
                                <td style="width:10%; text-align: center;">{{ number_format($product['rate'], 2) }}</td>
                                <td style="width:15%; text-align:center;">{{ number_format($product['amount'], 2) }}</td>
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
                    <hr style="border: 0.2px solid #37B1E0; margin-top:5px; margin-bottom:5px;">

                    <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                        <tr>
                            <!-- LEFT: QR CODE -->
                            <td style="width:15%; vertical-align: top; font-size:9px; padding-right:10px;">
                                <span class="qr-placeholder"></span>
                            </td>

                            <!-- MIDDLE: BANK DETAILS -->
                            <td style="width:55%; vertical-align: top; font-size:9px;padding-right:50px">
                                <strong>Bank Name :</strong> {{ $bankDetails->bank_name }}<br>
                                <strong>Account Holder Name :</strong> {{ $bankDetails->account_holder_name }}<br>
                                <strong>Address :</strong> {{ $bankDetails->address }}<br>
                                <strong>Branch :</strong> {{ $bankDetails->branch }}
                                &nbsp;&nbsp;
                                <strong>Branch Code :</strong> {{ $bankDetails->branch_code }}
                                &nbsp;&nbsp;
                                <strong>Ad Code :</strong> {{ $bankDetails->ad_code }}<br>
                                <strong>Account No :</strong> {{ $bankDetails->account_no }}
                                &nbsp;&nbsp;
                                <strong>IFSC :</strong> {{ $bankDetails->ifsc }}
                                &nbsp;&nbsp;
                                <strong>Swift Code :</strong> {{ $bankDetails->swift_code }}
                            </td>

                            <!-- RIGHT: TOTALS -->
                            <td style="width:30%; vertical-align: top;">
                                <table style="width:100%; font-size:9px; border-collapse:collapse;">
                                    <tr>
                                        <th style="text-align:left;"><strong>Sub Total</strong></th>
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
                                            <td><strong>Shipping Cost</strong></td>
                                            <td style="text-align:right;">{{ number_format($quotation->shipping_cost, 2) }}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Packaging Cost</strong></td>
                                            <td style="text-align:right;">{{ number_format($quotation->packaging_cost, 2) }}</td>
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

                    <!-- AMOUNT IN WORDS -->
                    <div style="width:100%; display:block; font-size:9px; color:#ffffff; margin-top:5px; margin-bottom:15px; text-align:left; padding:4px 6px; background-color:#37B1E0; box-sizing:border-box; line-height: 12px;">
                        <strong style="text-transform:capitalize;">
                            Amount In Words :
                            {{ $quotation->currency_name ?? 'INR' }}
                            {{ ucwords((new NumberFormatter('en_IN', NumberFormatter::SPELLOUT))->format($quotation->grand_total)) }}
                        </strong>
                    </div>

                    <!-- SIGNATURE SECTION -->
                    @if ($signature == 'Yes')
                        <section>
                            <table style="width:100%;">
                                <tr>
                                    <td style="width:50%; vertical-align: top; font-size:9px;">
                                        For {{ $companyDetails->name }}<br>
                                        <table style="margin: 6px 0;">
                                            <tr>
                                                <td style="width: 90px; height: 90px; border: 2px solid #1e3a8a; border-radius: 90px; text-align: center; vertical-align: middle; color: #1e3a8a; font-weight: 700; font-style: italic; font-size: 9px; line-height: 11px;">
                                                    {{ strtoupper(explode(' ', $companyDetails->name)[0]) }}<br>
                                                    <span style="font-size:7px;">• AUTHORISED •</span><br>
                                                    SIGNED
                                                </td>
                                            </tr>
                                        </table>
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
                                <img src="{{ $logoData }}" alt="Logo" style="max-width:120px; display:block;">
                            @endif
                        </td>
                        <td style="width:60%; vertical-align:top; padding:0; margin:0;">
                            <table style="width:100%; border-collapse:collapse; margin-top:15px;">
                                <tr>
                                    <td style="width:35%;"></td>
                                    <td style="width:65%; text-align:left;">
                                        @if (Str::wordCount($pdf_title) > 3)
                                            <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px;">
                                                {{ strtoupper($pdf_title) }}
                                            </h4>
                                        @else
                                            <h3 style="margin:0; padding:0; font-weight:bold; font-size:22px;">
                                                {{ strtoupper($pdf_title) }}
                                            </h3>
                                        @endif

                                        <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                            <tr>
                                                <td style="width:60%; font-size:9px;">
                                                    <div><strong>PI No :</strong> {{ $quotation->pi_number }}</div>
                                                    <div><strong>PI Date :</strong>
                                                        {{ date('d/m/Y', strtotime($quotation->pi_date)) }}
                                                    </div>
                                                </td>
                                                <td style="width:40%; text-align:right;">
                                                    <span class="barcode-strip barcode-strip-lg"></span>
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
                <hr style="border: 0.2px solid #37B1E0; margin-top:5px; margin-bottom:5px;">

                <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                    <tr>
                        <td style="width:20%; vertical-align: top; font-size:9px; padding-right:10px;">
                            <span class="qr-placeholder"></span>
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

                <div style="width:100%; display:block; font-size:9px; color:#ffffff; margin-top:15px; margin-bottom:15px; text-align:left; padding:6px; background-color:#37B1E0; box-sizing:border-box;">
                    <strong style="text-transform:capitalize;">
                        Amount In Words :
                        {{ $quotation->currency_name }}
                        {{ ucwords((new NumberFormatter('en_IN', NumberFormatter::SPELLOUT))->format($quotation->grand_total)) }}
                    </strong>
                </div>

                @if ($signature == 'Yes')
                    <section>
                        <table style="width:100%;">
                            <tr>
                                <td style="width:50%; vertical-align: top; text-align: left; font-size:9px;">
                                    <br>
                                    For {{ $companyDetails->name }}<br>
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

    <!-- ============================ -->
    <!-- TERMS & CONDITIONS PAGE -->
    <!-- ============================ -->
    @if($hasTermsConditions)
        <div class="force-page" style="padding-bottom: 80px;">
            <div class="sub-header">
                <table class="full-w" style="width:100%; border-collapse:collapse;">
                    <tr>
                        <td style="width:45%; vertical-align:top; font-size:9px; padding:0; margin:0;">
                            @if($logoData)
                                <img src="{{ $logoData }}" alt="Logo" style="max-width:120px; display:block;">
                            @endif
                        </td>
                        <td style="width:60%; vertical-align:top; padding:0; margin:0;">
                            <table style="width:100%; border-collapse:collapse; margin-top:15px;">
                                <tr>
                                    <td style="width:35%;"></td>
                                    <td style="width:65%; text-align:left;">
                                        @if (Str::wordCount($pdf_title) > 3)
                                            <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px;">
                                                {{ strtoupper($pdf_title) }}
                                            </h4>
                                        @else
                                            <h3 style="margin:0; padding:0; font-weight:bold; font-size:22px;">
                                                {{ strtoupper($pdf_title) }}
                                            </h3>
                                        @endif

                                        <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                                            <tr>
                                                <td style="width:60%; font-size:9px;">
                                                    <div><strong>PI No :</strong> {{ $quotation->pi_number }}</div>
                                                    <div><strong>PI Date :</strong>
                                                        {{ date('d/m/Y', strtotime($quotation->pi_date)) }}
                                                    </div>
                                                </td>
                                                <td style="width:40%; text-align:right;">
                                                    <span class="barcode-strip barcode-strip-lg"></span>
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

            <section style="margin-top:10px; font-size:11px;">
                <p align="justify">
                    <strong>Terms And Conditions :</strong><br>
                </p>
                @if(!empty($termsAndConditions))
                    <pre style="font-family: Arial, Helvetica, sans-serif; white-space: pre-wrap; word-wrap: break-word; font-size: 11px; margin: 0; padding: 0;">{{ $termsAndConditions->terms_and_conditions }}</pre>
                    <br>
                @endif
                @if(!empty(trim($quotation->terms_and_conditions ?? '')))
                    <pre style="font-family: Arial, Helvetica, sans-serif; white-space: pre-wrap; word-wrap: break-word; font-size: 11px; margin: 0; padding: 0;">{{ $quotation->terms_and_conditions }}</pre>
                    <br>
                @endif
            </section>
        </div>
    @endif
</div>

<script type="text/php">
if (isset($pdf)) {
    $font = $fontMetrics->get_font("helvetica", "normal");
    $size = 7;
    $text = "Page {PAGE_NUM} of {PAGE_COUNT}";
    $width = $fontMetrics->get_text_width($text, $font, $size);
    $x = (595 - $width) / 2 + 45;
    $y = 805;
    $pdf->page_text($x, $y, $text, $font, $size, [0.3, 0.3, 0.3]);
}
</script>

</body>
</html>
