<?php
    $company = config('invoice.company');
    $bank = config('invoice.bank');
    $defaults = config('invoice.defaults');
    $terms = config('invoice.terms');

    $client = $payment->client;
    $plan = $payment->plan;

    $itemName = $plan ? $plan->name . ' Plan' : 'Platform Subscription';
    $itemDescription = 'Subscription service for ' . ($client->org_name ?? 'Client');
    $price = (float) $payment->amount;
    $taxableValue = $price;

    $gstRate = $defaults['gst_rate'];
    $stateCodeMap = [
        'MAHARASHTRA' => 'MH', 'DELHI' => 'DL', 'KARNATAKA' => 'KA', 'TAMIL NADU' => 'TN',
        'GUJARAT' => 'GJ', 'UTTAR PRADESH' => 'UP', 'WEST BENGAL' => 'WB', 'RAJASTHAN' => 'RJ',
        'HARYANA' => 'HR', 'PUNJAB' => 'PB', 'KERALA' => 'KL', 'TELANGANA' => 'TS',
        'ANDHRA PRADESH' => 'AP', 'MADHYA PRADESH' => 'MP', 'BIHAR' => 'BR', 'ODISHA' => 'OD',
        'ASSAM' => 'AS', 'JHARKHAND' => 'JH', 'CHHATTISGARH' => 'CG', 'UTTARAKHAND' => 'UK',
        'HIMACHAL PRADESH' => 'HP', 'GOA' => 'GA', 'JAMMU AND KASHMIR' => 'JK', 'LADAKH' => 'LA',
        'MANIPUR' => 'MN', 'MEGHALAYA' => 'ML', 'MIZORAM' => 'MZ', 'NAGALAND' => 'NL',
        'SIKKIM' => 'SK', 'TRIPURA' => 'TR', 'ARUNACHAL PRADESH' => 'AR',
        'CHANDIGARH' => 'CH', 'PUDUCHERRY' => 'PY', 'DADRA AND NAGAR HAVELI' => 'DN',
        'DAMAN AND DIU' => 'DD', 'LAKSHADWEEP' => 'LD', 'ANDAMAN AND NICOBAR' => 'AN',
    ];
    $normalize = fn($s) => strtoupper(trim((string)$s));
    $resolveCode = function($state) use ($stateCodeMap, $normalize) {
        $s = $normalize($state);
        if (!$s) return null;
        if (strlen($s) === 2 && ctype_alpha($s)) return $s;
        return $stateCodeMap[$s] ?? null;
    };
    $companyStateCode = $resolveCode(env('INVOICE_COMPANY_STATE', 'Maharashtra')) ?? 'MH';
    $clientStateCode = $resolveCode($client->state) ?? $companyStateCode;
    $isIntraState = $clientStateCode === $companyStateCode;

    $gstinStateCodes = [
        'JK'=>'01','HP'=>'02','PB'=>'03','CH'=>'04','UK'=>'05','HR'=>'06','DL'=>'07','RJ'=>'08',
        'UP'=>'09','BR'=>'10','SK'=>'11','AR'=>'12','NL'=>'13','MN'=>'14','MZ'=>'15','TR'=>'16',
        'ML'=>'17','AS'=>'18','WB'=>'19','JH'=>'20','OD'=>'21','CG'=>'22','MP'=>'23','GJ'=>'24',
        'DD'=>'25','DN'=>'26','MH'=>'27','AP'=>'28','KA'=>'29','GA'=>'30','LD'=>'31','KL'=>'32',
        'TN'=>'33','PY'=>'34','AN'=>'35','TS'=>'36','LA'=>'38',
    ];
    $clientGstinCode = $gstinStateCodes[$clientStateCode] ?? '27';
    $companyGstinCode = $gstinStateCodes[$companyStateCode] ?? '27';

    $gstAmount = (float) ($payment->gst ?? 0);
    if ($gstAmount <= 0 && $gstRate > 0) {
        $gstAmount = round($taxableValue * ($gstRate / 100), 2);
    }
    $cgst = $isIntraState ? $gstAmount / 2 : 0;
    $sgst = $isIntraState ? $gstAmount / 2 : 0;
    $igst = $isIntraState ? 0 : $gstAmount;

    $grandTotal = (float) $payment->total;
    if ($grandTotal <= 0) {
        $grandTotal = $taxableValue + $gstAmount - (float)($payment->discount ?? 0);
    }

    try {
        $formatter = new \NumberFormatter('en_IN', \NumberFormatter::SPELLOUT);
        $rupees = floor($grandTotal);
        $amountInWords = ucwords($formatter->format($rupees)) . ' Only';
    } catch (\Throwable $e) {
        $amountInWords = number_format($grandTotal, 2) . ' Only';
    }

    $upiUri = 'upi://pay?pa=' . rawurlencode($bank['upi_id'])
        . '&pn=' . rawurlencode($company['name'])
        . '&am=' . rawurlencode(number_format($grandTotal, 2, '.', ''))
        . '&cu=INR'
        . '&tn=' . rawurlencode('Invoice ' . $payment->invoice_number);

    try {
        $qrOptions = new \chillerlan\QRCode\QROptions([
            'outputInterface' => \chillerlan\QRCode\Output\QRGdImagePNG::class,
            'eccLevel' => \chillerlan\QRCode\Common\EccLevel::L,
            'scale' => 5,
            'addQuietzone' => true,
            'quietzoneSize' => 1,
            'imageBase64' => true,
        ]);
        $qrUrl = (new \chillerlan\QRCode\QRCode($qrOptions))->render($upiUri);
    } catch (\Throwable $e) {
        $qrUrl = null;
    }

    $copyLabel = 'Original for Recipient';
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Tax Invoice - {{ $payment->invoice_number }}</title>
    <style>
        @page { margin: 0; size: A4; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
            font-family: DejaVu Sans, sans-serif;
            color: #1f2937;
            font-size: 9.5px;
            line-height: 1.35;
        }
        .page-wrap {
            padding: 16mm 18mm;
            page-break-after: always;
        }
        .page-wrap:last-child { page-break-after: auto; }

        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }

        .muted { color: #6b7280; }
        .bold { font-weight: bold; }
        .center { text-align: center; }
        .right { text-align: right; }

        .header-row td { padding-bottom: 8px; }
        .title {
            font-size: 22px; font-weight: bold; color: #1f2937; letter-spacing: 1px;
            white-space: nowrap;
        }
        .copy-label {
            font-size: 9px; color: #374151; font-weight: bold;
        }
        .invoice-no {
            font-size: 16px; font-weight: bold; color: #1f4e79;
            white-space: nowrap;
        }
        .logo-text {
            font-size: 22px; font-weight: bold; color: #1f4e79; letter-spacing: 1px;
        }
        .logo-sub {
            font-size: 8px; color: #6b7280; letter-spacing: 2px;
        }

        .amount-bar {
            background-color: #2f5373; color: #ffffff; padding: 6px 10px;
            font-size: 11px; font-weight: bold;
        }
        .amount-bar .val { font-size: 13px; }

        .meta-table td { padding: 2px 0; font-size: 9px; }
        .meta-table .lbl { color: #374151; text-align: right; padding-right: 10px; }
        .meta-table .val { font-weight: bold; color: #111827; }

        .company-name { font-size: 13px; font-weight: bold; color: #111827; margin-bottom: 2px; }
        .company-info { font-size: 9px; color: #374151; line-height: 1.55; }
        .company-info .lbl { font-weight: bold; color: #111827; }

        .section-hdr {
            font-size: 9px; color: #6b7280; margin-bottom: 2px;
        }
        .section-name {
            font-size: 12px; font-weight: bold; color: #111827; margin-bottom: 2px;
        }
        .section-body {
            font-size: 9px; color: #374151; line-height: 1.55;
        }
        .section-body .lbl { font-weight: bold; color: #111827; }

        .ship-field { color: #1f4e79; font-weight: bold; }

        .items-table {
            border: 1px solid #d1d5db; margin-top: 4px;
        }
        .items-table thead th {
            background-color: #2f5373; color: #ffffff;
            padding: 8px 6px; font-size: 9px; font-weight: bold;
            border-right: 1px solid #3d668b;
        }
        .items-table thead th:last-child { border-right: none; }
        .items-table tbody td {
            padding: 8px 6px; font-size: 9px;
            border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;
        }
        .items-table tbody td:last-child { border-right: none; }
        .items-table .item-name { font-weight: bold; color: #1f4e79; font-size: 10px; margin-bottom: 2px; }
        .items-table .item-desc { color: #6b7280; font-size: 8.5px; }
        .items-table .tax-pct { font-size: 8px; color: #6b7280; display: block; }

        .total-row td {
            padding: 8px 6px; font-size: 9.5px; font-weight: bold;
            background-color: #f9fafb; border-top: 2px solid #2f5373;
        }

        .bank-qr-table td { vertical-align: top; padding-top: 10px; }
        .bank-info { font-size: 9px; line-height: 1.7; color: #111827; }
        .bank-info .lbl { font-weight: bold; }

        .summary-table { font-size: 10px; }
        .summary-table td { padding: 5px 8px; white-space: nowrap; }
        .summary-table .lbl { color: #374151; text-align: right; }
        .summary-table .val { text-align: right; font-weight: bold; color: #111827; }
        .summary-table .grand-lbl { color: #1f4e79; font-weight: bold; font-size: 11px; }
        .summary-table .grand-val { color: #1f4e79; font-weight: bold; font-size: 12px; }
        .summary-table .words { color: #374151; font-style: italic; text-align: right; font-weight: bold; white-space: normal; }

        .terms-box { margin-top: 14px; border-top: 1px solid #d1d5db; padding-top: 8px; }
        .terms-title { font-size: 10px; font-weight: bold; color: #111827; margin-bottom: 3px; }
        .terms-sub { font-size: 9px; font-style: italic; color: #374151; margin-bottom: 3px; }
        .terms-body { font-size: 9px; color: #374151; line-height: 1.6; }

        .signature-box {
            text-align: center; padding-top: 6px;
        }
        .signature-script {
            font-family: 'Times New Roman', serif; font-style: italic;
            font-size: 28px; color: #111827; margin-bottom: 4px;
        }
        .signature-line {
            border-top: 1px solid #374151; padding-top: 4px;
            font-size: 9px; font-weight: bold; color: #111827;
        }
        .signature-sub { font-size: 9px; color: #374151; margin-top: 2px; }

        .payment-icons { margin-top: 6px; font-size: 8.5px; color: #6b7280; }
        .payment-icons span {
            display: inline-block; padding: 2px 6px; border: 1px solid #d1d5db;
            border-radius: 2px; margin-right: 3px; font-weight: bold; color: #374151;
        }
    </style>
</head>
<body>

<div class="page-wrap">

    {{-- ═══════════════ HEADER ═══════════════ --}}
    <table class="header-row">
        <tr>
            <td style="width: 28%;">
                @if(file_exists(public_path('images/igc-logo-invoice.png')))
                    <img src="{{ public_path('images/igc-logo-invoice.png') }}" alt="Logo" style="height: 40px; width: auto;" />
                @else
                    <div class="logo-text">{{ strtoupper($company['name']) }}</div>
                    <div class="logo-sub">BILLING MADE EASIER</div>
                @endif
            </td>
            <td style="width: 36%;" class="center">
                <div class="title">TAX INVOICE</div>
            </td>
            <td style="width: 36%;" class="right">
                <div class="copy-label">{{ $copyLabel }}</div>
                <div class="invoice-no">{{ $payment->invoice_number }}</div>
            </td>
        </tr>
    </table>

    {{-- ═══════════════ COMPANY + META ═══════════════ --}}
    <table style="margin-bottom: 10px;">
        <tr>
            <td style="width: 58%; padding-right: 12px; vertical-align: top;">
                <div class="company-name">{{ $company['name'] }}</div>
                <div class="company-info">
                    {{ $company['address_line1'] }}<br/>
                    {{ $company['address_line2'] }}<br/>
                    {{ $company['phone'] }}<br/>
                    {{ $company['email'] }}<br/>
                    <span class="lbl">GST No :</span> {{ $company['gstin'] }}<br/>
                    <span class="lbl">GST State Code :</span> {{ $company['gst_state_code'] }}<br/>
                    <span class="lbl">PAN No :</span> {{ $company['pan'] }}<br/>
                    <span class="lbl">CIN :</span> {{ $company['cin'] }}<br/>
                    <span class="lbl">IEC :</span> {{ $company['iec'] }}
                </div>
            </td>
            <td style="width: 42%; vertical-align: top;">
                <div class="amount-bar">
                    <table>
                        <tr>
                            <td>Amount Due:</td>
                            <td class="right val">₹{{ number_format($grandTotal, 2) }}</td>
                        </tr>
                    </table>
                </div>
                <table class="meta-table" style="margin-top: 6px;">
                    <tr>
                        <td class="lbl" style="width: 45%;">Invoice Date:</td>
                        <td class="val">{{ $payment->created_at->format('d - M - Y') }}</td>
                    </tr>
                    @if($payment->valid_from)
                    <tr>
                        <td class="lbl">Valid From:</td>
                        <td class="val">{{ $payment->valid_from->format('d - M - Y') }}</td>
                    </tr>
                    @endif
                    @if($payment->valid_until)
                    <tr>
                        <td class="lbl">Valid Until:</td>
                        <td class="val">{{ $payment->valid_until->format('d - M - Y') }}</td>
                    </tr>
                    @endif
                    @if($payment->billing_cycle)
                    <tr>
                        <td class="lbl">Billing Cycle:</td>
                        <td class="val">{{ ucfirst($payment->billing_cycle) }}</td>
                    </tr>
                    @endif
                </table>
            </td>
        </tr>
    </table>

    {{-- ═══════════════ BILL TO ═══════════════ --}}
    <table style="margin-bottom: 8px;">
        <tr>
            <td style="vertical-align: top;">
                <div class="section-hdr">Bill To</div>
                <div class="section-name">{{ $client->org_name }}</div>
                <div class="section-body">
                    {{ trim(implode(', ', array_filter([
                        $client->address,
                        $client->city,
                        $client->state ? $client->state . ' (' . $clientStateCode . ')' : null,
                        $client->pincode,
                        $client->country ?? 'IN',
                    ]))) }}<br/>
                    {{ $client->email }}@if($client->phone) &nbsp; | &nbsp; {{ $client->phone }}@endif<br/>
                    @if($client->gst_number)
                        <span class="lbl">GSTIN:</span> {{ $client->gst_number }}&nbsp;&nbsp;
                    @endif
                    @if($client->pan_number)
                        <span class="lbl">PAN:</span> {{ $client->pan_number }}
                    @endif
                </div>
            </td>
        </tr>
    </table>

    {{-- ═══════════════ ITEMS TABLE ═══════════════ --}}
    <table class="items-table">
        <thead>
            <tr>
                <th style="width: 5%;">S.No</th>
                <th style="width: 42%; text-align: left;">Item Description</th>
                <th style="width: 13%; text-align: right;">Price<br/>(₹)</th>
                <th style="width: 14%; text-align: right;">Taxable Value<br/>(₹)</th>
                @if($isIntraState)
                    <th style="width: 10%; text-align: right;">CGST<br/>(₹)</th>
                    <th style="width: 10%; text-align: right;">SGST<br/>(₹)</th>
                @else
                    <th style="width: 14%; text-align: right;">IGST<br/>(₹)</th>
                @endif
                <th style="width: 16%; text-align: right;">Amount<br/>(₹)</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td class="center">1</td>
                <td>
                    <div class="item-name">{{ $itemName }}</div>
                    <div class="item-desc">{{ $itemDescription }}</div>
                </td>
                <td class="right">{{ number_format($price, 2) }}</td>
                <td class="right">{{ number_format($taxableValue, 2) }}</td>
                @if($isIntraState)
                    <td class="right">
                        {{ number_format($cgst, 2) }}
                        <span class="tax-pct">{{ number_format($gstRate / 2, 0) }}%</span>
                    </td>
                    <td class="right">
                        {{ number_format($sgst, 2) }}
                        <span class="tax-pct">{{ number_format($gstRate / 2, 0) }}%</span>
                    </td>
                @else
                    <td class="right">
                        {{ number_format($igst, 2) }}
                        <span class="tax-pct">{{ number_format($gstRate, 0) }}%</span>
                    </td>
                @endif
                <td class="right bold">{{ number_format($price + ($isIntraState ? $cgst + $sgst : $igst), 2) }}</td>
            </tr>
            <tr class="total-row">
                <td colspan="3" class="right">Total {{ '@' . number_format($gstRate, 0) }}%</td>
                <td class="right">{{ number_format($taxableValue, 2) }}</td>
                @if($isIntraState)
                    <td class="right">{{ number_format($cgst, 2) }}</td>
                    <td class="right">{{ number_format($sgst, 2) }}</td>
                @else
                    <td class="right">{{ number_format($igst, 2) }}</td>
                @endif
                <td class="right">{{ number_format($grandTotal, 2) }}</td>
            </tr>
        </tbody>
    </table>

    {{-- ═══════════════ BANK + QR + SUMMARY ═══════════════ --}}
    <table class="bank-qr-table">
        <tr>
            <td style="width: 55%; padding-right: 12px;">
                <div class="bank-info">
                    <span class="lbl">Bank Name:</span> {{ $bank['bank_name'] }}<br/>
                    <span class="lbl">Account Holder Name:</span> {{ $bank['account_holder'] }}<br/>
                    <span class="lbl">Address:</span> {{ $bank['bank_address'] }}<br/>
                    <span class="lbl">Branch:</span> {{ $bank['branch_name'] }}
                    &nbsp;&nbsp;<span class="lbl">Branch Code:</span> {{ $bank['branch_code'] }}
                    &nbsp;&nbsp;<span class="lbl">Ad Code:</span> {{ $bank['ad_code'] }}<br/>
                    <span class="lbl">Account No:</span> {{ $bank['account_number'] }}
                    &nbsp;&nbsp;<span class="lbl">IFSC:</span> {{ $bank['ifsc_code'] }}
                    &nbsp;&nbsp;<span class="lbl">Swift Code:</span> {{ $bank['swift_code'] }}
                </div>

                <div style="margin-top: 12px;">
                    <div class="bank-info lbl" style="margin-bottom: 4px;">PAYMENT QR CODE</div>
                    <table>
                        <tr>
                            <td style="vertical-align: top; padding-right: 10px;">
                                @if($qrUrl)
                                    <img src="{{ $qrUrl }}" alt="UPI QR" style="width: 110px; height: 110px; border: 1px solid #e5e7eb;" />
                                @else
                                    <div style="width: 110px; height: 110px; border: 1px solid #e5e7eb; text-align: center; line-height: 110px; font-size: 9px; color: #9ca3af;">QR</div>
                                @endif
                            </td>
                            <td style="vertical-align: top;">
                                <div class="bank-info">
                                    <span class="lbl">UPI ID:</span><br/>
                                    {{ $bank['upi_id'] }}
                                </div>
                                <div class="payment-icons">
                                    <span>PhonePe</span>
                                    <span>G Pay</span>
                                    <span>Paytm</span>
                                    <span>UPI</span>
                                </div>
                            </td>
                        </tr>
                    </table>
                </div>
            </td>
            <td style="width: 45%;">
                <table class="summary-table">
                    <tr>
                        <td class="lbl">Total Taxable Value</td>
                        <td class="val">₹{{ number_format($taxableValue, 2) }}</td>
                    </tr>
                    <tr>
                        <td class="lbl">Total Tax Amount</td>
                        <td class="val">₹{{ number_format($gstAmount, 2) }}</td>
                    </tr>
                    @if((float)($payment->discount ?? 0) > 0)
                    <tr>
                        <td class="lbl">Discount</td>
                        <td class="val" style="color: #16a34a;">-₹{{ number_format((float)$payment->discount, 2) }}</td>
                    </tr>
                    @endif
                    <tr>
                        <td class="grand-lbl" style="border-top: 1px solid #d1d5db; padding-top: 8px;">Total Value (in figure)</td>
                        <td class="grand-val" style="border-top: 1px solid #d1d5db; padding-top: 8px;">₹{{ number_format($grandTotal, 0) }}</td>
                    </tr>
                    <tr>
                        <td class="lbl" style="vertical-align: top; padding-top: 6px;">Total Value (in words)</td>
                        <td class="words" style="padding-top: 6px;">₹ {{ $amountInWords }}</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    {{-- ═══════════════ TERMS + SIGNATURE ═══════════════ --}}
    <div class="terms-box">
        <table>
            <tr>
                <td style="width: 65%; padding-right: 12px; vertical-align: top;">
                    <div class="terms-title">Terms &amp; Conditions</div>
                    <div class="terms-sub">Note for Invoice</div>
                    <div class="terms-body">
                        @foreach($terms as $term)
                            {{ $term }}<br/>
                        @endforeach
                    </div>
                </td>
                <td style="width: 35%; vertical-align: bottom;" class="right">
                    <div class="signature-box">
                        <div class="signature-script">Signature</div>
                        <div class="signature-line">For, {{ $company['name'] }}</div>
                        <div class="signature-sub">Provider Signature</div>
                    </div>
                </td>
            </tr>
        </table>
    </div>

</div>

</body>
</html>
