<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8" />
    <title>DEBIT NOTE — {{ $dn->code ?? '' }}</title>
    <style>
        @page {
            /* Reserve more than the 40px footer so a flowing line whose top fits
               the content box (but bottom overshoots by ~one line) still clears
               the fixed footer instead of overlapping the barcode/company strip. */
            margin-bottom: 10px;
        }

        .pdf-footer {
            position: fixed;
            margin-bottom: 0;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100%;
            height: 40px;
            border-top: 1px solid {{ $companyDetails->primary_color ?? '#8BC34A' }};
            padding: 0;
            background: white;
            z-index: 1000;
            font-family: Helvetica, Arial, sans-serif;
            font-size: 9px;
            font-weight: 400;
            color: #4d4d4d;
        }

        .pdf-footer .pf-row {
            width: 100%;
            border-collapse: collapse;
        }

        .pdf-footer .pf-row td {
            vertical-align: top;
            padding-top: 4px;
        }

        .pdf-footer .pf-barcode {
            height: 18px;
            width: 90px;
            display: block;
        }

        .pdf-footer .pf-company {
            font-size: 7.5px;
            line-height: 1.2;
            color: #7CB342;
            font-weight: 400;
        }

        body {
            margin-bottom: 10px;
            font-family: Helvetica, "DejaVu Sans", Arial, sans-serif;
            font-size: 9px;
            color: #777777;
            position: relative;
        }

        body,
        table,
        tr,
        td,
        th,
        div,
        p,
        span,
        strong,
        li {
            line-height: 12px;
        }

        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
            line-height: 1.15;
            margin: 0;
        }

        strong,
        b {
            color: #666666;
            font-weight: bold;
        }

        .prod_table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8.5px;
            font-family: Helvetica, "DejaVu Sans", Arial, sans-serif;
        }

        .prod_table thead {
            display: table-header-group;
        }

        .prod_table tr {
            page-break-inside: avoid;
        }

        .prod_table td.description-cell {
            word-wrap: break-word;
            white-space: normal;
            vertical-align: middle;
        }

        .prod_table td {
            padding: 10px 6px;
            vertical-align: middle;
            line-height: 13px;
        }

        .prod_table th {
            padding: 12px 6px;
            vertical-align: middle;
            line-height: 13px;
            font-weight: 700;
            font-size: 9.5px;
            white-space: nowrap;
            letter-spacing: 0.2px;
        }

        table {
            border-collapse: collapse;
            width: 100%;
        }

        .content-wrapper {
            position: relative;
            z-index: 1;
        }

        .info-line {
            margin-bottom: 6px;
        }

        .qr-placeholder {
            display: inline-block;
            width: 80px;
            height: 80px;
            background-color: #fff;
            background-image:
                repeating-linear-gradient(0deg, #111 0 3px, transparent 3px 6px),
                repeating-linear-gradient(90deg, #111 0 3px, transparent 3px 6px);
            border: 2px solid #111;
        }

        .po-terms {
            font-size: 8px;
            color: #555;
            line-height: 12px;
            text-align: justify;
        }
    </style>
</head>

<body>

    @php
        $pdfClean = function ($s) {
            $s = (string) $s;
            $s = mb_convert_encoding($s, 'UTF-8', 'UTF-8');
            $s = preg_replace('/[^\x09\x0A\x0D\x20-\x7E\x{00A0}-\x{00FF}]/u', '', $s);
            return trim((string) $s);
        };

        // Footer compliance strip — only non-empty fields, joined by " | ".
        $__footerParts = [];
        if (trim((string) ($companyDetails->name ?? '')) !== '') $__footerParts[] = $companyDetails->name;
        if (trim((string) ($companyDetails->cin ?? '')) !== '') $__footerParts[] = 'CIN: ' . $companyDetails->cin;
        if (trim((string) ($companyDetails->gst_no ?? '')) !== '') $__footerParts[] = 'GST: ' . $companyDetails->gst_no;
        if (trim((string) ($companyDetails->iec ?? '')) !== '') $__footerParts[] = 'IEC: ' . $companyDetails->iec;
        if (trim((string) ($companyDetails->pan_no ?? '')) !== '') $__footerParts[] = 'PAN: ' . $companyDetails->pan_no;
        $__footerStrip = implode('  |  ', $__footerParts);

        // Amount in words (Indian English lakhs/crores).
        $__grandTotal = (float) ($totals->grand_total ?? 0);
        $__rupees = (int) floor($__grandTotal);
        $__paise = (int) round(($__grandTotal - $__rupees) * 100);
        $__spellInr = function (int $n): string {
            if ($n === 0) return 'Zero';
            $ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            $tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
            $twoDigit = function (int $n) use ($ones, $tens): string {
                if ($n < 20) return $ones[$n];
                return trim($tens[intdiv($n, 10)] . ' ' . ($n % 10 ? $ones[$n % 10] : ''));
            };
            $threeDigit = function (int $n) use ($ones, $twoDigit): string {
                $h = intdiv($n, 100); $r = $n % 100; $out = '';
                if ($h) $out .= $ones[$h] . ' Hundred';
                if ($r) $out .= ($h ? ' ' : '') . $twoDigit($r);
                return $out;
            };
            $crore = intdiv($n, 10000000); $n %= 10000000;
            $lakh = intdiv($n, 100000); $n %= 100000;
            $thou = intdiv($n, 1000); $n %= 1000;
            $hund = $n; $parts = [];
            if ($crore) $parts[] = $threeDigit($crore) . ' Crore';
            if ($lakh) $parts[] = $twoDigit($lakh) . ' Lakh';
            if ($thou) $parts[] = $twoDigit($thou) . ' Thousand';
            if ($hund) $parts[] = $threeDigit($hund);
            return implode(' ', $parts);
        };
        try {
            if (!class_exists(\NumberFormatter::class)) throw new \RuntimeException('intl missing');
            $__formatter = new \NumberFormatter('en_IN', \NumberFormatter::SPELLOUT);
            $__rupeeWords = ucwords($__formatter->format($__rupees));
            $__paiseWords = $__paise > 0 ? ucwords($__formatter->format($__paise)) : '';
        } catch (\Throwable $e) {
            $__rupeeWords = $__spellInr($__rupees);
            $__paiseWords = $__paise > 0 ? $__spellInr($__paise) : '';
        }
        $amountInWords = $__rupeeWords . ($__paiseWords !== '' ? ' and ' . $__paiseWords . ' Paise' : '');
        $__ccyCode = trim((string) ($dn->currency ?? 'INR')) ?: 'INR';

        // Logo / monogram fallback.
        $logoData = $companyDetails->logo_data ?? null;
        $logoFallbackHtml = '';
        if (!$logoData) {
            $skipWords = ['pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'co', 'company', 'and', 'the', 'of'];
            $initials = '';
            foreach (preg_split('/[\s\-_.,&]+/', trim((string) ($companyDetails->name ?? ''))) as $word) {
                $clean = preg_replace('/[^A-Za-z0-9]/', '', (string) $word);
                if ($clean === '' || in_array(strtolower($clean), $skipWords, true)) continue;
                $initials .= strtoupper($clean[0]);
                if (strlen($initials) >= 4) break;
            }
            if (strlen($initials) < 2) {
                $bare = preg_replace('/[^A-Za-z0-9]/', '', (string) ($companyDetails->name ?? ''));
                $initials = strtoupper(substr($bare, 0, 3)) ?: ($initials ?: 'NA');
            }
            $logoBrand = $companyDetails->primary_color ?? '#7CB342';
            $logoFallbackHtml = '<table style="border-collapse:collapse;"><tr>'
                . '<td style="width:74px; height:74px; background:' . $logoBrand . '; border-radius:12px; '
                . 'text-align:center; vertical-align:middle; color:#ffffff; font-size:26px; '
                . 'font-weight:bold; letter-spacing:1px; font-family:Arial,sans-serif;">'
                . e($initials) . '</td></tr></table>';
        }
        $signatureData = $companyDetails->signature_data ?? null;
    @endphp

    <!-- GLOBAL FOOTER -->
    <div class="pdf-footer">
        <table class="pf-row">
            <tr>
                <td style="width:15%; text-align:left; padding-left:8px;">
                    @if(!empty($barcodeData))
                        <img src="{{ $barcodeData }}" alt="" class="pf-barcode" width="90" height="18" style="width:90px; height:18px;">
                    @endif
                </td>
                <td class="pf-company" style="width:70%; text-align:center; color:{{ $companyDetails->primary_color ?? '#7CB342' }};">
                    {{ $__footerStrip }}
                </td>
                <td style="width:15%;">&nbsp;</td>
            </tr>
        </table>
    </div>

    <!-- MAIN CONTENT -->
    <div class="content-wrapper">

        <!-- HEADER -->
        <table class="full-w" style="width:100%; border-collapse:collapse;">
            <tr>
                <!-- LEFT: LOGO + LETTERHEAD -->
                <td style="width:50%; vertical-align:top; font-size:9px; padding:0; margin:0;">
                    <div style="height:80px;">
                        @if($logoData)
                            <img src="{{ $logoData }}" alt="Logo" width="200" height="80"
                                style="width:200px; height:auto; max-width:200px; max-height:78px; display:block; object-fit:contain;">
                        @else
                            {!! $logoFallbackHtml !!}
                        @endif
                    </div>

                    <div style="margin-top:12px; font-size:9px; line-height:14px;">
                        <strong style="display:block; font-size:9px; margin-bottom:6px; color:#666666;">
                            {{ ucwords(strtolower($companyDetails->name)) }}
                        </strong>
                        @if(trim((string) $companyDetails->address) !== '')
                            <div class="info-line">{{ $companyDetails->address }}</div>
                        @endif
                        @if(trim((string) $companyDetails->mobile) !== '')
                            <div class="info-line">{{ $companyDetails->mobile }}</div>
                        @endif
                        @if(trim((string) $companyDetails->email) !== '')
                            <div class="info-line">{{ $companyDetails->email }}</div>
                        @endif
                        @if(trim((string) $companyDetails->gst_no) !== '')
                            <div class="info-line"><strong>GST No : </strong>{{ $companyDetails->gst_no }}</div>
                        @endif
                        @if(trim((string) $companyDetails->gst_state_code) !== '')
                            <div class="info-line"><strong>GST State Code : </strong>{{ $companyDetails->gst_state_code }}</div>
                        @endif
                        @if(trim((string) $companyDetails->pan_no) !== '')
                            <div class="info-line"><strong>PAN No : </strong>{{ $companyDetails->pan_no }}</div>
                        @endif
                        @if(trim((string) $companyDetails->cin) !== '')
                            <div class="info-line"><strong>CIN : </strong>{{ $companyDetails->cin }}</div>
                        @endif
                        @if(trim((string) $companyDetails->iec) !== '')
                            <div class="info-line"><strong>IEC : </strong>{{ $companyDetails->iec }}</div>
                        @endif
                        @if(trim((string) $companyDetails->drug_license) !== '')
                            <div class="info-line"><strong>Drug License : </strong>{{ $companyDetails->drug_license }}</div>
                        @endif
                        @if(trim((string) $companyDetails->pcpndt_no) !== '')
                            <div class="info-line"><strong>PCPNDT No : </strong>{{ $companyDetails->pcpndt_no }}</div>
                        @endif
                        @if(trim((string) $companyDetails->aeo_code) !== '')
                            <div style="margin-bottom:10px;"><strong>AEO Code : </strong>{{ $companyDetails->aeo_code }}</div>
                        @endif
                        @php
                            $oneStarFile = trim((string) $companyDetails->onestartfilename);
                            $oneStarUdin = trim((string) $companyDetails->onestarudinumber);
                        @endphp
                        @if($oneStarFile !== '' || $oneStarUdin !== '')
                            <div class="info-line"><strong>One Star Export House Details :</strong></div>
                            @if($oneStarFile !== '')
                                <div class="info-line"><strong>File No : </strong>{{ $oneStarFile }}</div>
                            @endif
                            @if($oneStarUdin !== '')
                                <div style="margin-bottom:0;"><strong>UDIN No : </strong>{{ $oneStarUdin }}</div>
                            @endif
                        @endif
                    </div>
                </td>

                <!-- RIGHT: TITLE + DEBIT NOTE INFO GRID + SUPPLIER -->
                <td style="width:50%; vertical-align:top;">
                    <div style="min-height:80px;">
                        {{-- Row 1: title on its own line, full width. --}}
                        <h3 style="margin:0 0 6px 0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; letter-spacing:-0.3px; white-space:nowrap; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                            {{ strtoupper($pdf_title ?? 'DEBIT NOTE') }}
                        </h3>
                        {{-- Row 2: the two fields (No + Date) on the left, barcode on the right.
                             The right cell uses the SAME 55%/45% split as the info grid below,
                             and the barcode is LEFT-aligned so its left edge lines up exactly
                             with the "Debit Note Date / SPI Date / …" fields underneath it. --}}
                        <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                            <tr>
                                <td style="width:55%; vertical-align:top; font-size:9px;">
                                    <div><strong>Debit Note No :</strong> {{ $dn->code }}</div>
                                    <div><strong>Debit Note Date :</strong> {{ $dn->dn_date }}</div>
                                </td>
                                <td style="width:45%; text-align:left; vertical-align:top;">
                                    @if(!empty($barcodeData))
                                        <img src="{{ $barcodeData }}" alt="Barcode" width="130" height="30"
                                            style="width:130px; height:30px; display:block; margin:0;">
                                        <div style="font-size:7.5px; color:#333; text-align:left; word-break:break-all; line-height:9px; margin-top:2px; max-width:140px;">
                                            {{ $barcodeText ?? ($companyDetails->website ?? '') }}
                                        </div>
                                    @else
                                        <div style="font-size:11px; font-weight:bold; color:#666666; text-align:left; line-height:13px; max-width:140px;">
                                            {{ $companyDetails->name ?? '' }}
                                        </div>
                                    @endif
                                </td>
                            </tr>
                        </table>
                    </div>

                    {{-- DEBIT NOTE INFO GRID — two sub-columns like the PO layout. --}}
                    <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:9px; line-height:14px;">
                        <tr>
                            <td style="width:55%; vertical-align:top;">
                                <div class="info-line"><strong>SHP ID :</strong> {{ $dn->shipment_code }}</div>
                                <div class="info-line"><strong>Procurement ID :</strong> {{ $dn->procurement_code }}</div>
                                <div class="info-line"><strong>Debit Note Type :</strong> {{ $dn->dn_type }}</div>
                                <div class="info-line"><strong>Expected Debit Date :</strong> {{ $dn->expected_debit_date }}</div>
                                <div class="info-line"><strong>SPI No :</strong> {{ $dn->spi_code }}</div>
                                <div class="info-line"><strong>PO No :</strong> {{ $dn->po_code }}</div>
                                <div class="info-line"><strong>Invoice No :</strong> {{ $dn->invoice_no }}</div>
                                <div class="info-line"><strong>Invoice Date :</strong> {{ $dn->invoice_date }}</div>
                            </td>
                            <td style="width:45%; vertical-align:top;">
                                <div class="info-line"><strong>Debit Note Date :</strong> {{ $dn->dn_date }}</div>
                                <div class="info-line"><strong>SPI Date :</strong> {{ $dn->spi_date }}</div>
                                <div class="info-line"><strong>PO Date :</strong> {{ $dn->po_date }}</div>
                            </td>
                        </tr>
                    </table>

                    <div style="margin-top:8px; font-size:9px; line-height:14px;">
                        <div class="info-line"><strong>Supplier Name :</strong> {{ $supplier->name }}</div>
                        <div class="info-line"><strong>Supplier Address :</strong> {{ $pdfClean($supplier->address) }}</div>
                        @if(trim((string) ($supplier->state_code ?? '')) !== '')
                            <div style="margin-bottom:0;"><strong>Supplier State Code :</strong> {{ $supplier->state_code }}</div>
                        @endif
                    </div>
                </td>
            </tr>
        </table>

        <hr style="border: 0.1px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

        <!-- DEBIT TO / BILL TO -->
        <table class="full-w" style="width:100%; border-collapse:collapse; margin-top:8px;">
            <tr>
                <td style="width:50%; font-size:9px; line-height:14px; vertical-align: top; padding:6px 0;">
                    <div class="info-line"><strong>Debit To : </strong>{{ $debitTo->name }}</div>
                    @if(trim((string) $debitTo->address) !== '')
                        <div class="info-line">{{ $debitTo->address }}</div>
                    @endif
                    @if(trim((string) $debitTo->gstin) !== '')
                        <div class="info-line"><strong>GSTIN : </strong>{{ $debitTo->gstin }}</div>
                    @endif
                    @if(trim((string) $debitTo->contact) !== '')
                        <div style="margin-bottom:0;">{{ $debitTo->contact }}</div>
                    @endif
                </td>
                <td style="width:50%; font-size:9px; line-height:14px; vertical-align: top; padding:6px 0;">
                    <div style="margin-left:20px;">
                        <div class="info-line"><strong>Bill To : </strong>{{ $billTo->name }}</div>
                        @if(trim((string) $billTo->address) !== '')
                            <div class="info-line">{{ $billTo->address }}</div>
                        @endif
                        @if(trim((string) $billTo->gstin) !== '')
                            <div class="info-line"><strong>GSTIN : </strong>{{ $billTo->gstin }}</div>
                        @endif
                        @if(trim((string) $billTo->contact) !== '')
                            <div style="margin-bottom:0;">{{ $billTo->contact }}</div>
                        @endif
                    </div>
                </td>
            </tr>
        </table>

        <!-- PRODUCT TABLE -->
        <section style="margin-top:10px;">
            <table class="prod_table" style="table-layout: fixed; font-size:9px; width:100%;">
                <thead>
                    <tr style="background-color:{{ $companyDetails->primary_color ?? '#7CB342' }}; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }};">
                        <th style="width:6%;  text-align: center;">Sr No</th>
                        <th style="width:34%; text-align: left;">Product Name</th>
                        <th style="width:14%; text-align: left;">HSN / SAC</th>
                        <th style="width:9%;  text-align: center;">Debit Qty</th>
                        <th style="width:13%; text-align: right;">Rate</th>
                        <th style="width:9%;  text-align: center;">GST%</th>
                        <th style="width:15%; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach ($products as $i => $product)
                        <tr>
                            <td style="width:6%;  text-align: center;">{{ $i + 1 }}</td>
                            <td style="width:34%; text-align: left;">{{ $pdfClean($product['product_name']) }}</td>
                            <td style="width:14%; text-align: left;">{{ $pdfClean($product['hsn_code']) ?: '—' }}</td>
                            <td style="width:9%;  text-align: center;">
                                {{ rtrim(rtrim(number_format($product['quantity'], 3, '.', ','), '0'), '.') }}
                            </td>
                            <td style="width:13%; text-align: right;">{{ number_format($product['rate'], 2) }}</td>
                            <td style="width:9%;  text-align: center;">{{ rtrim(rtrim(number_format($product['gst_pct'], 2), '0'), '.') }}</td>
                            <td style="width:15%; text-align: right;">{{ number_format($product['amount'], 2) }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </section>

        <!-- BANK + CHARGES/TOTALS -->
        <div style="margin-top: 16px; page-break-inside: avoid;">
            <hr style="border: 0.2px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

            <table style="width:100%; table-layout:fixed; border-collapse:collapse; margin-top:12px;">
                <tr>
                    <td style="width:20%; vertical-align: top; padding-right:8px; padding-top:0;">
                        @if(!empty($qrData))
                            <img src="{{ $qrData }}" alt="Bank Payment QR" width="120" height="120"
                                style="width:120px; height:120px; display:block; margin-top:-6px;">
                        @else
                            <span class="qr-placeholder" style="width:120px; height:120px; display:block; margin-top:-6px;"></span>
                        @endif
                    </td>

                    <td style="width:48%; vertical-align: top; font-size:9px; line-height:14px; padding-right:16px;">
                        <div class="info-line"><strong style="color:#555;">Bank Name :</strong> {{ $bankDetails->bank_name }}</div>
                        <div class="info-line"><strong style="color:#555;">Account Holder Name :</strong> {{ $bankDetails->account_holder_name }}</div>
                        <div class="info-line"><strong style="color:#555;">Address :</strong> {{ $bankDetails->address }}</div>
                        <div class="info-line">
                            <strong style="color:#555;">Branch :</strong> {{ $bankDetails->branch }}
                            &nbsp;&nbsp;
                            <strong style="color:#555;">Ad Code :</strong> {{ $bankDetails->ad_code }}
                        </div>
                        <div class="info-line">
                            <strong style="color:#555;">Account No :</strong> {{ $bankDetails->account_no }}
                            &nbsp;&nbsp;
                            <strong style="color:#555;">IFSC :</strong> {{ $bankDetails->ifsc }}
                        </div>
                        <div style="margin-bottom:0;"><strong style="color:#555;">Swift Code :</strong> {{ $bankDetails->swift_code }}</div>
                    </td>

                    <td style="width:32%; vertical-align: top;">
                        <table style="width:100%; font-size:9px; line-height:14px; border-collapse:collapse;">
                            <tr>
                                <td style="padding:3px 0;"><strong style="color:#555;">Sub Total</strong></td>
                                <td style="text-align:right; padding:3px 0;"><strong style="color:#555;">{{ number_format($totals->sub_total, 2) }}</strong></td>
                            </tr>
                            @if($interState)
                                <tr>
                                    <td style="padding:3px 0; color:#555;">IGST</td>
                                    <td style="text-align:right; padding:3px 0;">{{ number_format($totals->igst, 2) }}</td>
                                </tr>
                            @else
                                <tr>
                                    <td style="padding:3px 0; color:#555;">CGST</td>
                                    <td style="text-align:right; padding:3px 0;">{{ number_format($totals->cgst, 2) }}</td>
                                </tr>
                                <tr>
                                    <td style="padding:3px 0; color:#555;">SGST</td>
                                    <td style="text-align:right; padding:3px 0;">{{ number_format($totals->sgst, 2) }}</td>
                                </tr>
                            @endif
                            <tr>
                                <td style="padding:3px 0; color:#555;">Additions (+)</td>
                                <td style="text-align:right; padding:3px 0;">{{ number_format($totals->additions, 2) }}</td>
                            </tr>
                            <tr>
                                <td style="padding:3px 0; color:#555;">Deductions (–)</td>
                                <td style="text-align:right; padding:3px 0;">– {{ number_format($totals->deductions, 2) }}</td>
                            </tr>
                            <tr>
                                <td style="padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd; white-space:nowrap;">
                                    <strong>Grand Total:</strong>
                                </td>
                                <td style="text-align:right; padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd; white-space:nowrap;">
                                    <strong>{{ $__ccyCode }} {{ number_format($totals->grand_total, 2) }}</strong>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <!-- AMOUNT IN WORDS -->
            <div style="width:100%; display:block; font-size:10px; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }}; margin-top:10px; margin-bottom:15px; text-align:left; padding:8px 14px; background-color:{{ $companyDetails->primary_color ?? '#7CB342' }}; box-sizing:border-box; line-height: 14px; font-weight:600;">
                <strong style="text-transform:capitalize; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }};">
                    Amount In Words : {{ $__ccyCode }} {{ $amountInWords }}
                </strong>
            </div>

            <!-- SIGNATURE -->
            @if ($signature == 'Yes')
                <section>
                    <table style="width:100%;">
                        <tr>
                            <td style="width:50%; vertical-align: top; font-size:9px;">
                                For {{ ucwords(strtolower($companyDetails->name)) }}<br>
                                @if($signatureData)
                                    <div style="margin: 6px 0;">
                                        <img src="{{ $signatureData }}" alt="Authorised Signatory"
                                            style="max-width:140px; max-height:80px; display:block;">
                                    </div>
                                @else
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
                            <td style="width:50%; vertical-align: top; padding-top: 7px; font-size:9px; text-align: right; padding-right: 30px;">
                                Accept &amp; Acknowledge,<strong> {{ $supplier->name }}</strong><br>
                                <br>
                                <div style="margin-top: 75px;"></div>
                                <div style="display: inline-block; text-align: center; padding-right:40px;">
                                    <div style="border-bottom: 1px solid black; width: 100px; margin: 0 auto;"></div>
                                </div>
                            </td>
                        </tr>
                    </table>
                </section>
            @endif
        </div>

        <!-- REASON -->
        @if(!empty(trim((string) ($dn->reason ?? ''))))
            <div style="margin-top: 14px;">
                <div style="font-size: 10px; font-weight: 700; color: #000; margin-bottom: 6px; padding-bottom: 3px; border-bottom: 1px solid {{ $companyDetails->primary_color ?? '#7CB342' }};">
                    Reason :
                </div>
                <div class="po-terms">
                    {!! nl2br(e(trim((string) $dn->reason))) !!}
                </div>
            </div>
        @endif

        <!-- TERMS & CONDITIONS -->
        @php
            $__masterTerms = $masterTerms ?? [];
            $__formTerms = trim((string) ($dn->terms ?? ''));
        @endphp
        @if(!empty($__masterTerms) || $__formTerms !== '')
            <div style="margin-top: 18px;">
                <div style="font-size: 10px; font-weight: 700; color: #000; margin-bottom: 6px; padding-bottom: 3px; border-bottom: 1px solid {{ $companyDetails->primary_color ?? '#7CB342' }};">
                    Terms And Conditions :
                </div>
                {{-- Master T&C from the CLM library (rich text / HTML), one block per row. --}}
                @foreach($__masterTerms as $__t)
                    <div class="po-terms" style="margin-bottom:6px;">{!! $__t !!}</div>
                @endforeach
                {{-- Free-text terms typed on the debit note form. --}}
                @if($__formTerms !== '')
                    <div class="po-terms">{!! nl2br(e($__formTerms)) !!}</div>
                @endif
            </div>
        @endif

    </div>

    <script type="text/php">
if (isset($pdf)) {
    $font  = $fontMetrics->get_font("DejaVu Sans", "normal");
    $size  = 8;
    $text  = "Page {PAGE_NUM} of {PAGE_COUNT}";
    $width = $fontMetrics->get_text_width("Page 99 of 99", $font, $size);
    $x     = ($pdf->get_width() - $width) / 2 + 2;
    $y     = $pdf->get_height() - 30;
    $pdf->page_text($x, $y, $text, $font, $size, [0.30, 0.30, 0.30]);
}
</script>

</body>

</html>
