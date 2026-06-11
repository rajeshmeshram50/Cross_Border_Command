@php
    // Resolve absolute path to the tenant's logo so dompdf can embed it as
    // base64. Falls back to a text initials block when there's no logo.
    $logoPath = null;
    if (!empty($client?->logo)) {
        $abs = public_path(ltrim((string) $client->logo, '/'));
        if (file_exists($abs))
            $logoPath = $abs;
        else {
            $storage = storage_path('app/public/' . ltrim((string) $client->logo, '/'));
            if (file_exists($storage))
                $logoPath = $storage;
        }
    }

    $orgName = $client?->org_name ?? 'Cross Border Command';
    $orgAddress = trim(implode(', ', array_filter([
        $client?->address,
        $client?->city,
        $client?->state,
        $client?->country,
    ])));
    $orgPincode = $client?->pincode;
    $orgPhone = $client?->phone;
    $orgEmail = $client?->email;
    $orgGst = $client?->gst_number;
    $orgPan = $client?->pan_number;
    $orgWebsite = $client?->website;
    /* B37: keep unicode letters + digits in the watermark text.
     * Previously `[^A-Za-z0-9\s]` stripped Ñ / ü / CJK characters
     * (e.g. "Müller GmbH" → "Mller GmbH"), and a name composed
     * entirely of non-ASCII produced an empty watermark. Using
     * the Unicode property classes with the /u flag preserves
     * every letter and number in any script while still removing
     * punctuation / control characters that could choke dompdf. */
    $watermark = mb_strtoupper((string) preg_replace('/[^\p{L}\p{N}\s]/u', '', (string) $orgName));

    $product = $entry->leadProduct?->product;
    $lp = $entry->leadProduct;
    $sharedAt = \Carbon\Carbon::parse($entry->shared_at);
@endphp
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <title>Quotation {{ $quoteCode }}</title>
    <style>
        @page {
            margin: 30px 32px 60px;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: 'DejaVu Sans', Arial, sans-serif;
            font-size: 9.5px;
            color: #1e293b;
            margin: 0;
            position: relative;
        }

        /* ── Diagonal watermark ─────────────────────────────────────── */
        .watermark {
            position: fixed;
            top: 38%;
            left: 0;
            width: 100%;
            text-align: center;
            font-size: 70px;
            font-weight: 800;
            color: rgba(16, 185, 129, 0.12);
            transform: rotate(-28deg);
            transform-origin: center center;
            letter-spacing: 6px;
            z-index: -1;
            white-space: nowrap;
        }

        /* ── Header (tenant logo + info on left, Quotation + barcode on right) ─── */
        .header {
            display: table;
            width: 100%;
            margin-bottom: 14px;
        }

        .header-left,
        .header-right {
            display: table-cell;
            vertical-align: top;
        }

        .header-left {
            width: 60%;
        }

        .header-right {
            width: 40%;
            text-align: right;
        }

        .logo-row {
            display: table;
            margin-bottom: 4px;
        }

        .logo-cell {
            display: table-cell;
            vertical-align: middle;
            padding-right: 10px;
        }

        .logo-img {
            max-height: 46px;
            max-width: 130px;
        }

        .logo-initials {
            width: 46px;
            height: 46px;
            border-radius: 12px;
            background: linear-gradient(135deg, #10b981, #047857);
            color: #fff;
            display: inline-block;
            text-align: center;
            line-height: 46px;
            font-size: 18px;
            font-weight: 800;
        }

        .org-name {
            font-size: 13px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 1px;
        }

        .org-line {
            font-size: 8.5px;
            color: #475569;
            line-height: 1.35;
        }

        .org-info {
            margin-top: 6px;
            font-size: 8.5px;
            color: #334155;
        }

        .org-info-row {
            display: table;
            width: 100%;
            margin-bottom: 1px;
        }

        .org-info-label {
            display: table-cell;
            width: 90px;
            color: #64748b;
            font-weight: 600;
        }

        .org-info-val {
            display: table-cell;
            color: #1e293b;
            font-weight: 600;
        }

        .doc-title {
            font-size: 14px;
            font-weight: 800;
            color: #0f2a52;
            letter-spacing: .04em;
            margin-bottom: 6px;
        }

        .barcode-box {
            display: inline-block;
            padding: 6px 10px;
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            margin-bottom: 4px;
        }

        .barcode-box img,
        .barcode-box div {
            display: block;
            margin: 0 auto;
        }

        .website-link {
            font-size: 8.5px;
            color: #2563eb;
            word-break: break-all;
        }

        /* ── Detail table ─────────────────────────────────────────── */
        .detail-wrap {
            margin-top: 4px;
            border: 1.5px solid #10b981;
            border-radius: 8px;
            padding: 10px;
            background: #fff;
        }

        .detail-table {
            width: 100%;
            border-collapse: collapse;
        }

        .detail-table tr td {
            padding: 7px 12px;
            font-size: 10px;
            border-bottom: 1px solid #d1fae5;
        }

        .detail-table tr:last-child td {
            border-bottom: none;
        }

        .detail-table .label-cell {
            width: 35%;
            font-weight: 700;
            color: #047857;
            background: #f0fdf4;
            border-right: 1px solid #d1fae5;
        }

        .detail-table .val-cell {
            color: #0f172a;
            font-weight: 600;
        }

        .price-row td {
            font-weight: 800;
            color: #047857;
        }

        /* ── Footer (fixed at page bottom) ─────────────────────────── */
        .footer {
            position: fixed;
            bottom: 14px;
            left: 32px;
            right: 32px;
            border-top: 1.5px solid #10b981;
            padding-top: 6px;
            font-size: 8px;
            color: #475569;
            text-align: center;
            line-height: 1.4;
        }

        .footer-line1 {
            font-weight: 700;
            color: #1e293b;
        }

        .footer-link {
            color: #2563eb;
        }

        .divider {
            height: 1.5px;
            background: #10b981;
            margin: 8px 0 12px;
            border-radius: 1px;
        }
    </style>
</head>

<body>
    <div class="watermark">{{ $watermark }}</div>

    <!-- ── HEADER ── -->
    <div class="header">
        <div class="header-left">
            <div class="logo-row">
                <div class="logo-cell">
                    @if ($logoPath)
                        <img src="{{ $logoPath }}" alt="logo" class="logo-img">
                    @else
                        <span class="logo-initials">{{ strtoupper(substr($orgName, 0, 1)) }}</span>
                    @endif
                </div>
                <div class="logo-cell">
                    <div class="org-name">{{ $orgName }}</div>
                    @if ($orgAddress)
                        <div class="org-line">{{ $orgAddress }}{{ $orgPincode ? ' - ' . $orgPincode : '' }}</div>
                    @endif
                    @if ($orgPhone)
                    <div class="org-line">{{ $orgPhone }}</div> @endif
                    @if ($orgEmail)
                    <div class="org-line">{{ $orgEmail }}</div> @endif
                </div>
            </div>

            <div class="org-info">
                @if ($orgGst)
                    <div class="org-info-row">
                        <span class="org-info-label">GST No.</span>
                        <span class="org-info-val">{{ $orgGst }}</span>
                    </div>
                @endif
                @if ($orgPan)
                    <div class="org-info-row">
                        <span class="org-info-label">PAN No.</span>
                        <span class="org-info-val">{{ $orgPan }}</span>
                    </div>
                @endif
                <div class="org-info-row">
                    <span class="org-info-label">Issued By</span>
                    <span class="org-info-val">{{ $entry->creator?->name ?? '—' }}</span>
                </div>
                <div class="org-info-row">
                    <span class="org-info-label">Opportunity</span>
                    <span
                        class="org-info-val">{{ $entry->lead?->opp_code ?? $entry->lead?->unique_query_id ?? '—' }}</span>
                </div>
                @if ($entry->lead?->customer?->company_name)
                    <div class="org-info-row">
                        <span class="org-info-label">Customer</span>
                        <span class="org-info-val">{{ $entry->lead->customer->company_name }}</span>
                    </div>
                @endif
            </div>
        </div>

        <div class="header-right">
            <div class="doc-title">Quotation Document</div>
            <div class="barcode-box">
                @if ($barcodeHtml)
                    {!! $barcodeHtml !!}
                @else
                    <div style="font-family: monospace; font-size: 9px; color: #0f172a;">{{ $quoteCode }}</div>
                @endif
            </div>
            @if ($orgWebsite)
                <div class="website-link">{{ $orgWebsite }}</div>
            @endif
        </div>
    </div>

    <div class="divider"></div>

    <!-- ── DETAIL TABLE ── -->
    <div class="detail-wrap">
        <table class="detail-table">
            <tr>
                <td class="label-cell">Product Name</td>
                <td class="val-cell">{{ $product?->name ?? '—' }}</td>
            </tr>
            <tr>
                <td class="label-cell">Product Code</td>
                <td class="val-cell">{{ $product?->product_code ?? '—' }}</td>
            </tr>
            <tr>
                <td class="label-cell">Quantity</td>
                <td class="val-cell">{{ $lp?->quantity !== null ? number_format((float) $lp->quantity, 0) : '—' }}</td>
            </tr>
            {{-- <tr>
                <td class="label-cell">Target Price</td>
                <td class="val-cell">{{ $lp?->target_price !== null ? number_format((float) $lp->target_price, 2) : '—'
                    }}</td>
            </tr> --}}
            <tr class="price-row">
                <td class="label-cell">Quoted Price</td>
                <td class="val-cell">{{ number_format((float) $entry->quoted_price, 2) }}</td>
            </tr>
            <tr>
                <td class="label-cell">Currency</td>
                <td class="val-cell">{{ $lp?->currency ?? '—' }}</td>
            </tr>
            <tr>
                <td class="label-cell">Shared Date</td>
                <td class="val-cell">{{ $sharedAt->format('Y-m-d H:i:s') }}</td>
            </tr>
            <tr>
                <td class="label-cell">Quotation ID</td>
                <td class="val-cell">{{ $quoteCode }}</td>
            </tr>
        </table>
    </div>

    <!-- ── FOOTER ── -->
    <div class="footer">
        <div class="footer-line1">
            {{ $orgName }}
            @if ($orgGst) | GST: {{ $orgGst }} @endif
            @if ($orgPan) | PAN: {{ $orgPan }} @endif
        </div>
        @if ($orgWebsite)
            <div class="footer-link">{{ $orgWebsite }}</div>
        @endif
    </div>
</body>

</html>