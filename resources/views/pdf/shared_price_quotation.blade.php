@php
    $PRIMARY = $companyDetails->primary_color ?? '#7CB342';
    $ONW = $companyDetails->primary_text_color ?? '#ffffff';
    $curr = $quotation->currency_name ?? ($quotation->currency->name ?? 'INR');
    $money = fn($n) => $curr . ' ' . number_format((float) $n, 2);

    $c = $companyDetails;
    $b = $buyerDetails;
    $logo = $c->logo_data ?? null;

    // Grand total spelled out (Indian numbering; falls back when ext-intl is absent).
    $__grand = (float) ($quotation->grand_total ?? 0);
    $__whole = (int) floor($__grand);
    $__frac  = (int) round(($__grand - $__whole) * 100);
    $__spell = function (int $n) use (&$__spell): string {
        if ($n === 0) return 'Zero';
        $ones = ['', 'One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
        $tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
        $two = fn (int $n) => $n < 20 ? $ones[$n] : trim($tens[intdiv($n,10)].' '.($n%10 ? $ones[$n%10] : ''));
        $three = function (int $n) use ($ones,$two) { $h=intdiv($n,100); $r=$n%100; $o=''; if($h)$o.=$ones[$h].' Hundred'; if($r)$o.=($h?' ':'').$two($r); return $o; };
        $cr=intdiv($n,10000000); $n%=10000000; $la=intdiv($n,100000); $n%=100000; $th=intdiv($n,1000); $n%=1000; $hu=$n;
        $p=[]; if($cr)$p[]=$__spell($cr).' Crore'; if($la)$p[]=$two($la).' Lakh'; if($th)$p[]=$two($th).' Thousand'; if($hu)$p[]=$three($hu);
        return implode(' ', $p);
    };
    try {
        if (!class_exists(\NumberFormatter::class)) throw new \RuntimeException('no intl');
        $__fmt = new \NumberFormatter('en_IN', \NumberFormatter::SPELLOUT);
        $__ww = ucwords($__fmt->format($__whole));
        $__fw = $__frac > 0 ? ucwords($__fmt->format($__frac)) : '';
    } catch (\Throwable $e) {
        $__ww = $__spell($__whole);
        $__fw = $__frac > 0 ? $__spell($__frac) : '';
    }
    $amountInWords = $__ww . ($__fw !== '' ? ' and ' . $__fw . ' Paise' : '');

    // Small barcode for the footer band.
    $footerBar = '';
    try { $footerBar = (new \Milon\Barcode\DNS1D())->getBarcodeHTML((string) ($quotation->pi_number ?? ''), 'C128', 0.7, 18); } catch (\Throwable $e) {}
@endphp
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <title>{{ $pdf_title ?? 'QUOTATION' }} — {{ $quotation->pi_number ?? '' }}</title>
    <style>
        @page {
            margin: 44px 48px 70px;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: Helvetica, 'DejaVu Sans', Arial, sans-serif;
            font-size: 9px;
            color: #777777;
            margin: 0;
            position: relative;
            line-height: 13px;
        }

        strong {
            color: #555;
            font-weight: bold;
        }

        .hdr {
            width: 100%;
        }

        .hdr td {
            vertical-align: top;
        }

        .h-l {
            width: 55%;
        }

        .h-r {
            width: 45%;
            text-align: right;
        }

        .logo-img {
            max-height: 54px;
            max-width: 170px;
            margin-bottom: 8px;
        }

        .logo-box {
            display: inline-block;
            padding: 14px 22px;
            background:
                {{ $PRIMARY }}
            ;
            color:
                {{ $ONW }}
            ;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 800;
            margin-bottom: 8px;
        }

        .org-name {
            font-size: 13px;
            font-weight: 800;
            color: #333;
            margin-bottom: 3px;
        }

        .line {
            font-size: 8.5px;
            color: #777;
            line-height: 13px;
        }

        .kv {
            font-size: 8.5px;
            color: #777;
            line-height: 13px;
        }

        .kv strong {
            color: #555;
        }

        .doc-title {
            font-family: Helvetica, 'DejaVu Sans', Arial, sans-serif;
            font-size: 22px;
            font-weight: bold;
            color: #333;
            letter-spacing: .02em;
            margin-bottom: 6px;
        }

        .barcode {
            display: block;
            text-align: right;
            margin-bottom: 8px;
        }

        .barcode img,
        .barcode div {
            display: inline-block;
        }

        .meta {
            font-size: 8.5px;
            color: #777;
        }

        .cust-title {
            font-size: 9px;
            font-weight: 800;
            color:
                {{ $PRIMARY }}
            ;
            margin-top: 10px;
            margin-bottom: 3px;
        }

        .rule {
            height: 1.4px;
            background:
                {{ $PRIMARY }}
            ;
            margin: 20px 0;
        }

        table.prod {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
        }

        table.prod thead th {
            background:
                {{ $PRIMARY }}
            ;
            color:
                {{ $ONW }}
            ;
            font-size: 8.5px;
            font-weight: 700;
            text-align: right;
            padding: 11px 8px;
            letter-spacing: .2px;
        }

        table.prod thead th.l {
            text-align: left;
        }

        table.prod thead th.c {
            text-align: center;
        }

        table.prod tbody td {
            font-size: 8.5px;
            color: #555;
            padding: 10px 8px;
            text-align: right;
            vertical-align: top;
        }

        table.prod tbody td.l {
            text-align: left;
        }

        table.prod tbody td.c {
            text-align: center;
        }

        .pname {
            font-weight: 700;
            color: #444;
        }

        .tot {
            width: 100%;
            margin-top: 6px;
        }

        .tot td {
            vertical-align: top;
        }

        .tot-box {
            width: 42%;
        }

        .tot-row td {
            padding: 4px 8px;
            font-size: 9px;
        }

        .tot-k {
            color: #777;
            font-weight: 600;
        }

        .tot-v {
            text-align: right;
            color: #555;
            font-weight: 700;
        }

        .tot-grand td {
            border-top: 1.4px solid
                {{ $PRIMARY }}
            ;
            padding-top: 6px;
        }

        .tot-grand .tot-k {
            color: #333;
            font-weight: 800;
            font-size: 11px;
        }

        .tot-grand .tot-v {
            color:
                {{ $PRIMARY }}
            ;
            font-weight: 800;
            font-size: 12px;
        }

        .pdf-footer {
            position: fixed;
            bottom: 8px;
            left: 0;
            right: 0;
            width: 100%;
            height: 52px;
            border-top: 1px solid {{ $PRIMARY }};
            background: #fff;
            font-size: 8px;
            color: #4d4d4d;
        }

        .pdf-footer .pf-bar { height: 18px; width: 90px; display: block; }
    </style>
</head>

<body>
    <!-- ── HEADER (mirrors the Proforma-Invoice layout) ── -->
    <table style="width:100%; border-collapse:collapse;">
        <tr>
            <!-- LEFT: logo + issuer letterhead (narrow column so the address wraps) -->
            <td style="width:45%; vertical-align:top;">
                <div style="height:78px;">
                    @if ($logo)
                        <img src="{{ $logo }}" alt="logo" style="max-width:190px; max-height:76px; display:block;">
                    @else
                        <div class="logo-box">{{ strtoupper(substr($c->name ?? 'Q', 0, 2)) }}</div>
                    @endif
                </div>
                <div style="margin-top:10px; font-size:9px; line-height:14px;">
                    <strong
                        style="display:block; font-size:10px; color:#555; margin-bottom:5px;">{{ $c->name ?? '—' }}</strong>
                    @if (!empty($c->address))
                    <div style="margin-bottom:5px;">{{ $c->address }}</div>@endif
                    @if (!empty($c->mobile))
                    <div style="margin-bottom:5px;">{{ $c->mobile }}</div>@endif
                    @if (!empty($c->email))
                    <div style="margin-bottom:5px;">{{ $c->email }}</div>@endif
                    @if (!empty($c->gst_no))
                    <div style="margin-bottom:5px;"><strong>GST No :</strong> {{ $c->gst_no }}</div>@endif
                    @if (!empty($c->gst_state_code))
                    <div style="margin-bottom:0;"><strong>GST State Code :</strong> {{ $c->gst_state_code }}</div>@endif
                </div>
            </td>

            <!-- MIDDLE: blank spacer -->
            <td style="width:6%;"></td>

            <!-- RIGHT: title + Opp Id/Date (left) with barcode (right); customer below
                 sits inside the SAME 78px band as the left logo, so both letterheads
                 (issuer + customer) start on the same row. -->
            <td style="width:45%; vertical-align:top; text-align:left;">
                <div style="height:78px;">
                    <table style="width:100%; border-collapse:collapse;">
                        {{-- Row 1: QUOTATION heading (spans both columns, left) --}}
                        <tr>
                            <td colspan="2" style="text-align:left;">
                                <div class="doc-title" style="text-align:left; margin-bottom:6px;">
                                    {{ $pdf_title ?? 'QUOTATION' }}
                                </div>
                            </td>
                        </tr>
                        {{-- Row 2: Opp Id/Opp Date (left) | barcode fills the right cell --}}
                        <tr>
                            <td
                                style="vertical-align:middle; text-align:left; font-size:9px; line-height:14px; width:56%; white-space:nowrap;">
                                <div style="margin-bottom:2px; white-space:nowrap;"><strong>Opp Id :</strong> {{ $opportunity_id ?? '—' }}</div>
                                <div style="white-space:nowrap;"><strong>Opp Date :</strong> {{ $opportunity_date ? $opportunity_date->format('d/m/Y') : '—' }}</div>
                            </td>
                            <td style="vertical-align:middle; text-align:left ;">
                                @if (!empty($barcodeHtml))
                                <div style="text-align:right; width:100%;">{!! $barcodeHtml !!}</div>@endif
                            </td>
                        </tr>
                    </table>
                </div>

                {{-- Customer letterhead — same field order/spacing as the issuer on the left:
                name → address → region → phone → email → GST No. --}}
                <div style="margin-top:10px; font-size:9px; line-height:14px; text-align:left;">
                    <strong
                        style="display:block; font-size:10px; color:#555; margin-bottom:5px;">{{ $b->name ?? '—' }}</strong>
                    @if (!empty($b->address_line))
                    <div style="margin-bottom:5px;">{{ $b->address_line }}</div>@endif
                    @if (!empty($b->region))
                    <div style="margin-bottom:5px;">{{ $b->region }}</div>@endif
                    @if (!empty($b->contact_no))
                    <div style="margin-bottom:5px;">{{ $b->contact_no }}</div>@endif
                    @if (!empty($b->email))
                    <div style="margin-bottom:5px;">{{ $b->email }}</div>@endif
                    @if (!empty($b->gst_no))
                    <div style="margin-bottom:0;"><strong>GST No :</strong> {{ $b->gst_no }}</div>@endif
                </div>
            </td>
        </tr>
    </table>

    <div class="rule"></div>

    <!-- ── PRODUCT TABLE ── -->
    <table class="prod">
        <thead>
            <tr>
                <th class="c" style="width:5%;">Sr No</th>
                <th class="c" style="width:11%;">Product Code</th>
                <th class="l" style="width:34%;">Product Name</th>
                <th class="c" style="width:6%;">Qty</th>
                <th style="width:9%;">Rate</th>
                <th class="c" style="width:7%;">Tax%</th>
                <th style="width:9%;">Tax Amt</th>
                <th style="width:9%;">Rate+Tax</th>
                <th style="width:10%;">Amount</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($quotationProducts as $i => $row)
                <tr>
                    <td class="c">{{ $i + 1 }}</td>
                    <td class="c">{{ $row['product_code'] ?: '—' }}</td>
                    <td class="l"><span class="pname">{{ $row['product_name'] }}</span></td>
                    <td class="c">{{ rtrim(rtrim(number_format((float) $row['quantity'], 3, '.', ','), '0'), '.') }}</td>
                    <td>{{ number_format((float) $row['rate'], 2) }}</td>
                    <td class="c">0.00%</td>
                    <td>{{ number_format(0, 2) }}</td>
                    <td>{{ number_format((float) ($row['rate_with_tax'] ?? $row['rate']), 2) }}</td>
                    <td>{{ number_format((float) $row['amount'], 2) }}</td>
                </tr>
            @endforeach
        </tbody>
    </table>

    {{-- Colored rule after the product table (matches the PI's post-table line). --}}
    <div class="rule" style="margin:14px 0;"></div>

    <!-- ── TOTALS (mirrors the PI totals: labels #555, plain values, Grand Total emphasized) ── -->
    <table style="width:100%; border-collapse:collapse;">
        <tr>
            <td></td>
            <td style="width:35%; vertical-align:top;">
                <table style="width:100%; font-size:9px; line-height:14px; border-collapse:collapse;">
                    <tr>
                        <td style="padding:3px 0;"><strong style="color:#555;">Sub Total</strong></td>
                        <td style="text-align:right; padding:3px 0;"><strong style="color:#555;">{{ number_format((float) $quotation->total, 2) }}</strong></td>
                    </tr>
                    <tr>
                        <td style="padding:3px 0; color:#555;">IGST</td>
                        <td style="text-align:right; padding:3px 0;">{{ number_format((float) $quotation->igst, 2) }}</td>
                    </tr>
                    <tr>
                        <td style="padding:3px 0; color:#555;">CGST</td>
                        <td style="text-align:right; padding:3px 0;">{{ number_format((float) $quotation->cgst, 2) }}</td>
                    </tr>
                    <tr>
                        <td style="padding:3px 0; color:#555;">SGST</td>
                        <td style="text-align:right; padding:3px 0;">{{ number_format((float) $quotation->sgst, 2) }}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd; white-space:nowrap;"><strong>Grand Total:</strong></td>
                        <td style="text-align:right; padding:8px 0 0 0; font-size:12px; color:#333; border-top:1px solid #ddd; white-space:nowrap;"><strong>{{ $curr }} {{ number_format((float) $quotation->grand_total, 2) }}</strong></td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    {{-- ── AMOUNT IN WORDS ── (primary-colour bar; a full-width table so its right
         edge lines up exactly with the product table / totals, not overflowing). --}}
    <table style="width:100%; border-collapse:collapse; margin-top:14px;">
        <tr>
            <td style="background-color:{{ $PRIMARY }}; color:{{ $ONW }}; padding:8px 14px; font-size:10px; font-weight:600; line-height:14px; text-align:left;">
                <strong style="text-transform:capitalize; color:{{ $ONW }};">Amount In Words : {{ $curr }} {{ $amountInWords }}</strong>
            </td>
        </tr>
    </table>

    {{-- ── FOOTER: barcode (left) + issuer name (center); "Page X of Y" below via script ── --}}
    <div class="pdf-footer">
        <table style="width:100%; border-collapse:collapse;">
            <tr>
                <td style="width:20%; text-align:left; padding:5px 0 0 8px; vertical-align:top;">{!! $footerBar !!}</td>
                <td style="width:60%; text-align:center; padding-top:6px; vertical-align:top; color:{{ $PRIMARY }}; font-size:8px; font-weight:600;">
                    {{ $c->name ?? '' }}@if (!empty($c->gst_no)) &nbsp;|&nbsp; GST No : {{ $c->gst_no }}@endif
                </td>
                <td style="width:20%;">&nbsp;</td>
            </tr>
        </table>
    </div>

    <script type="text/php">
        if (isset($pdf)) {
            $font  = $fontMetrics->get_font("DejaVu Sans", "normal");
            $size  = 8;
            $text  = "Page {PAGE_NUM} of {PAGE_COUNT}";
            $width = $fontMetrics->get_text_width("Page 99 of 99", $font, $size);
            $x     = ($pdf->get_width() - $width) / 2 + 2;
            $y     = $pdf->get_height() - 34;
            $pdf->page_text($x, $y, $text, $font, $size, [0.30, 0.30, 0.30]);
        }
    </script>
</body>

</html>