{{--
  Advance Receipt Refund Adjustment — the credit note raised when a PO is cancelled
  after money was released. It prints exactly what the vendor credit carries: the PO's
  lines, the single adjustment (charges less TDS, less what the supplier keeps) and the
  credit total. Same letterhead and table as pdf/purchase-order.blade.php.
--}}
<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8" />
    <title>ADVANCE RECEIPT REFUND ADJUSTMENT — {{ $adr->code ?? '' }}</title>
    <style>
        @page { margin-bottom: 10px; }

        .pdf-footer {
            position: fixed; bottom: 0; left: 0; right: 0; width: 100%; height: 40px;
            border-top: 1px solid {{ $companyDetails->primary_color ?? '#7CB342' }};
            padding: 0; margin-bottom: 0; background: white; z-index: 1000;
            font-family: Helvetica, Arial, sans-serif; font-size: 9px; font-weight: 400; color: #4d4d4d;
        }
        .pdf-footer .pf-row { width: 100%; border-collapse: collapse; }
        .pdf-footer .pf-row td { vertical-align: top; padding-top: 4px; }
        .pdf-footer .pf-company { font-size: 7.5px; line-height: 1.2; color: #7CB342; font-weight: 400; }
        .pdf-footer .pf-barcode { height: 18px; width: 90px; display: block; }

        body {
            margin-bottom: 10px; font-family: Helvetica, "DejaVu Sans", Arial, sans-serif;
            font-size: 9px; color: #777777; position: relative;
        }
        body, table, tr, td, th, div, p, span, strong, li { line-height: 12px; }
        h1, h2, h3, h4, h5, h6 { line-height: 1.15; margin: 0; }
        strong, b { color: #666666; font-weight: bold; }
        table { border-collapse: collapse; width: 100%; }

        .prod_table {
            width: 100%; border-collapse: collapse; font-size: 8.5px;
            font-family: Helvetica, "DejaVu Sans", Arial, sans-serif;
        }
        .prod_table thead { display: table-header-group; }
        .prod_table tr { page-break-inside: auto; }
        .prod_table td { padding: 10px 6px; vertical-align: middle; line-height: 13px; }
        .prod_table th {
            padding: 12px 6px; vertical-align: middle; line-height: 13px;
            font-weight: 700; font-size: 9.5px; white-space: nowrap; letter-spacing: 0.2px;
        }
        .prod_table td.name-cell, .prod_table td.description-cell {
            word-wrap: break-word; overflow-wrap: break-word; white-space: normal; vertical-align: top;
        }

        .content-wrapper { position: relative; z-index: 1; }
        .info-line { margin-bottom: 6px; }

        /* break-all keeps a pasted run of characters with no spaces inside the page. */
        .why-cell {
            word-wrap: break-word; overflow-wrap: break-word; word-break: break-all; white-space: normal;
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

        $__footerParts = [];
        if (trim((string) ($companyDetails->name ?? '')) !== '') $__footerParts[] = $companyDetails->name;
        if (trim((string) ($companyDetails->cin ?? '')) !== '') $__footerParts[] = 'CIN: ' . $companyDetails->cin;
        if (trim((string) ($companyDetails->gst_no ?? '')) !== '') $__footerParts[] = 'GST: ' . $companyDetails->gst_no;
        if (trim((string) ($companyDetails->iec ?? '')) !== '') $__footerParts[] = 'IEC: ' . $companyDetails->iec;
        if (trim((string) ($companyDetails->pan_no ?? '')) !== '') $__footerParts[] = 'PAN: ' . $companyDetails->pan_no;
        $__footerStrip = implode('  |  ', $__footerParts);

        // Amount in words (Indian English lakhs/crores), same helper as the PO.
        $__total = (float) ($totals->credit_total ?? 0);
        $__rupees = (int) floor($__total);
        $__paise = (int) round(($__total - $__rupees) * 100);
        $__spellInr = function (int $n): string {
            if ($n === 0) return 'Zero';
            $ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            $tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
            $twoDigit = function (int $n) use ($ones, $tens): string {
                if ($n < 20) return $ones[$n];
                return trim($tens[intdiv($n, 10)] . ' ' . ($n % 10 ? $ones[$n % 10] : ''));
            };
            $threeDigit = function (int $n) use (&$threeDigit, $ones, $twoDigit): string {
                if ($n >= 1000) {
                    $th = intdiv($n, 1000); $r = $n % 1000;
                    return trim($threeDigit($th) . ' Thousand' . ($r ? ' ' . $threeDigit($r) : ''));
                }
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
        $__ccyCode = trim((string) ($adr->currency ?? 'INR')) ?: 'INR';

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
        $taxLabel = $totals->tax_mode === 'export' ? 'Tax' : ($totals->tax_mode === 'inter' ? 'IGST' : 'CGST + SGST');
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
        <table style="width:100%; border-collapse:collapse;">
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
                            <div style="margin-bottom:0;"><strong>IEC : </strong>{{ $companyDetails->iec }}</div>
                        @endif
                    </div>
                </td>

                <!-- RIGHT: TITLE + ADR INFO + SUPPLIER -->
                <td style="width:50%; vertical-align:top;">
                    {{-- Title across the block, then the number/date beside the barcode. --}}
                    <div style="height:80px;">
                        <table style="width:100%; border-collapse:collapse;">
                            <tr>
                                <td colspan="2" style="vertical-align:top; padding:0 0 8px 0;">
                                    <h3 style="margin:0; padding:0; font-weight:bold; font-size:17px; line-height:1.1; color:#777777; letter-spacing:-0.3px; font-family: Helvetica, 'DejaVu Sans', sans-serif;">
                                        ADVANCE RECEIPT REFUND ADJUSTMENT
                                    </h3>
                                </td>
                            </tr>
                            <tr>
                                <td style="width:50%; vertical-align:top; font-size:9px;">
                                    <div><strong>ADR No :</strong> {{ $adr->code }}</div>
                                    <div><strong>ADR Date :</strong> {{ $adr->date }}</div>
                                </td>
                                <td style="width:50%; text-align:right; vertical-align:top;">
                                    @if(!empty($barcodeData))
                                        <img src="{{ $barcodeData }}" alt="Barcode" width="130" height="30"
                                            style="width:130px; height:30px; display:block; margin-left:auto;">
                                        <div style="font-size:7.5px; color:#333; text-align:center; word-break:break-all; line-height:9px; margin-top:2px; max-width:140px; margin-left:auto;">
                                            {{ $barcodeText ?? ($companyDetails->website ?? '') }}
                                        </div>
                                    @endif
                                </td>
                            </tr>
                        </table>
                    </div>

                    <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:9px; line-height:14px;">
                        <tr>
                            <td style="width:55%; vertical-align:top;">
                                <div class="info-line"><strong>PO No :</strong> {{ $adr->po_code }}</div>
                                <div class="info-line"><strong>Refund Type :</strong> {{ $adr->refund_type }}</div>
                                <div class="info-line"><strong>Supplier Ref No :</strong> {{ $adr->supplier_ref ?: 'NA' }}</div>
                                <div class="info-line"><strong>Currency :</strong> {{ $__ccyCode }}</div>
                            </td>
                            <td style="width:45%; vertical-align:top;">
                                <div class="info-line"><strong>PO Date :</strong> {{ $adr->po_date ?: 'NA' }}</div>
                                <div class="info-line"><strong>SHP ID :</strong> {{ $adr->shipment ?: 'NA' }}</div>
                                <div class="info-line"><strong>Opportunity ID :</strong> {{ $adr->opportunity ?: 'NA' }}</div>
                                <div class="info-line"><strong>Document Type :</strong> {{ $adr->document_type }}</div>
                            </td>
                        </tr>
                    </table>

                    <div style="margin-top:8px; font-size:9px; line-height:14px;">
                        <div class="info-line"><strong>Supplier Name :</strong> {{ $vendor->name }}</div>
                        <div class="info-line"><strong>Supplier Address :</strong> {{ $pdfClean($vendor->address) ?: 'NA' }}</div>
                        @if(trim((string) ($vendor->gst_no ?? '')) !== '')
                            <div style="margin-bottom:0;"><strong>Supplier GST No :</strong> {{ $vendor->gst_no }}</div>
                        @endif
                    </div>
                </td>
            </tr>
        </table>

        <hr style="border: 0.1px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

        <!-- CREDITED LINES — the PO's products, as the credit carries them -->
        <section style="margin-top:10px;">
            <table class="prod_table" style="table-layout: fixed; font-size:9px; width:100%;">
                <thead>
                    <tr style="background-color:{{ $companyDetails->primary_color ?? '#7CB342' }}; color:{{ $companyDetails->primary_text_color ?? '#ffffff' }};">
                        <th style="width:5%;  text-align: center;">Sr No</th>
                        <th style="width:25%; text-align: left;">Product Name</th>
                        <th style="width:20%; text-align: left;">Description</th>
                        <th style="width:10%; text-align: left;">HSN / SAC</th>
                        <th style="width:8%;  text-align: center;">Qty</th>
                        <th style="width:11%; text-align: right;">Rate</th>
                        <th style="width:8%;  text-align: center;">{{ $taxLabel }} %</th>
                        <th style="width:13%; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    @forelse ($lines as $i => $line)
                        <tr>
                            <td style="width:5%;  text-align: center;">{{ $i + 1 }}</td>
                            <td class="name-cell" style="width:25%; text-align: left;">
                                {{ $pdfClean($line['name']) }}{{ $line['code'] !== '' ? ' (' . $pdfClean($line['code']) . ')' : '' }}
                            </td>
                            <td class="description-cell" style="width:20%; text-align: left;">{{ $pdfClean($line['description']) ?: '—' }}</td>
                            <td style="width:10%; text-align: left;">{{ $line['hsn'] ?: '—' }}</td>
                            <td style="width:8%;  text-align: center;">
                                {{ rtrim(rtrim(number_format($line['quantity'], 3, '.', ','), '0'), '.') }}{{ $line['unit'] !== '' ? ' ' . $line['unit'] : '' }}
                            </td>
                            <td style="width:11%; text-align: right;">{{ number_format($line['rate'], 2) }}</td>
                            <td style="width:8%;  text-align: center;">{{ rtrim(rtrim(number_format($line['gst_pct'], 2), '0'), '.') }}</td>
                            <td style="width:13%; text-align: right;">{{ number_format($line['taxable'], 2) }}</td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="8" style="text-align:center; padding:14px 6px;">No product lines on this purchase order.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </section>

        <!-- TOTALS -->
        <div style="margin-top: 16px; page-break-inside: avoid;">
            <hr style="border: 0.2px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-top:5px; margin-bottom:5px;">

            <table style="width:100%; table-layout:fixed; border-collapse:collapse; margin-top:12px;">
                <tr>
                    {{-- Why the credit exists, beside the money it is made of. --}}
                    <td class="why-cell" style="width:58%; vertical-align: top; font-size:9px; line-height:13px; padding-right:16px;">
                        <div style="margin-bottom:6px;">
                            <strong style="color:#555;">Reason for cancellation :</strong> {{ $pdfClean($adr->reason) ?: '—' }}
                        </div>
                        @if($totals->retained > 0 && trim((string) $adr->retained_remark) !== '')
                            <div style="margin-bottom:0;">
                                <strong style="color:#555;">Cancellation charges ({{ $adr->retained_type ?: 'retained' }}) :</strong> {{ $pdfClean($adr->retained_remark) }}
                            </div>
                        @endif
                    </td>

                    <td style="width:42%; vertical-align: top;">
                        {{-- The credit is raised on what was released, not on the order's value. --}}
                        <table style="width:100%; font-size:9px; line-height:14px; border-collapse:collapse;">
                            <tr>
                                <td style="padding:3px 0; color:#555;">Total PO Amount</td>
                                <td style="text-align:right; padding:3px 0;">{{ number_format($totals->po_total, 2) }}</td>
                            </tr>
                            <tr>
                                <td style="padding:3px 0; color:#555;">Less : TDS Deducted</td>
                                <td style="text-align:right; padding:3px 0;">{{ number_format($totals->tds, 2) }}</td>
                            </tr>
                            <tr>
                                <td style="padding:3px 0; color:#555;">Net Payable</td>
                                <td style="text-align:right; padding:3px 0;">{{ number_format($totals->net, 2) }}</td>
                            </tr>
                            <tr>
                                <td style="padding:3px 0; border-top:1px solid #eee;"><strong style="color:#555;">Total Paid (credited)</strong></td>
                                <td style="text-align:right; padding:3px 0; border-top:1px solid #eee;"><strong style="color:#555;">{{ number_format($totals->paid, 2) }}</strong></td>
                            </tr>
                            <tr>
                                <td style="padding:3px 0; color:#555;">Less : Cancellation Charges</td>
                                <td style="text-align:right; padding:3px 0;">{{ number_format($totals->retained, 2) }}</td>
                            </tr>
                            <tr>
                                <td style="padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd; white-space:nowrap;">
                                    <strong>Credit Total:</strong>
                                </td>
                                <td style="text-align:right; padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd; white-space:nowrap;">
                                    <strong>{{ $__ccyCode }} {{ number_format($totals->credit_total, 2) }}</strong>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:5px 0 0 0; color:#555;">Amount to be recovered</td>
                                <td style="text-align:right; padding:5px 0 0 0;">{{ $__ccyCode }} {{ number_format($totals->refund, 2) }}</td>
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
            <section style="margin-top:18px;">
                <table style="width:100%;">
                    <tr>
                        <td style="width:60%;">&nbsp;</td>
                        <td style="width:40%; text-align:right; font-size:9px;">
                            <div style="margin-bottom:4px;">For {{ ucwords(strtolower($companyDetails->name)) }}</div>
                            @if($signatureData)
                                <img src="{{ $signatureData }}" alt="Signature" width="130" height="45"
                                    style="width:130px; height:45px; display:block; margin-left:auto; object-fit:contain;">
                            @else
                                <div style="height:45px;">&nbsp;</div>
                            @endif
                            <div style="border-top:1px solid #ccc; padding-top:4px; display:inline-block; min-width:150px;">Authorised Signatory</div>
                        </td>
                    </tr>
                </table>
            </section>

        </div>
    </div>
</body>

</html>
