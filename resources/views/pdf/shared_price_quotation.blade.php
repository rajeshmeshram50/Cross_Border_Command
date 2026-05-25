<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Quotation #{{ str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT) }}</title>
    <style>
        @page { margin: 36px 40px; }
        body {
            font-family: 'DejaVu Sans', Arial, sans-serif;
            font-size: 11px; color: #1e293b; margin: 0;
        }
        .head {
            background: linear-gradient(180deg, #1e2a5e 0%, #2f4d9e 100%);
            color: #fff; padding: 18px 22px; border-radius: 8px;
            display: table; width: 100%;
        }
        .head-cell { display: table-cell; vertical-align: middle; }
        .head-title { font-size: 18px; font-weight: 700; letter-spacing: .03em; }
        .head-sub   { font-size: 11px; opacity: .85; margin-top: 4px; }
        .head-right { text-align: right; }
        .head-chip  {
            display: inline-block; background: rgba(255,255,255,.18);
            padding: 5px 12px; border-radius: 999px;
            font-size: 11px; font-weight: 700;
        }
        .strip {
            display: table; width: 100%; margin-top: 14px;
            border: 1px solid #e5e7eb; border-radius: 8px;
            border-collapse: collapse;
        }
        .strip-cell {
            display: table-cell; padding: 10px 14px;
            border-right: 1px solid #e5e7eb;
            border-bottom: 1px solid #e5e7eb;
            vertical-align: top;
        }
        .strip-cell:last-child { border-right: none; }
        .strip-cell:nth-last-child(-n+4) { border-bottom: none; }
        .strip-label {
            font-size: 9px; font-weight: 700; color: #64748b;
            text-transform: uppercase; letter-spacing: .08em;
        }
        .strip-val { font-size: 12px; font-weight: 700; color: #1e2a5e; margin-top: 3px; }
        .section-title {
            margin-top: 22px; margin-bottom: 8px;
            font-size: 13px; font-weight: 700; color: #1e2a5e;
            border-bottom: 2px solid #2f4d9e; padding-bottom: 4px;
        }
        table.detail { width: 100%; border-collapse: collapse; }
        table.detail th, table.detail td {
            padding: 9px 12px; text-align: left;
            border-bottom: 1px solid #e5e7eb;
            font-size: 11px;
        }
        table.detail th {
            background: #2f4d9e; color: #fff; font-weight: 700;
            font-size: 10.5px; letter-spacing: .03em;
        }
        .price-band {
            margin-top: 20px;
            background: #eff6ff;
            border: 1.5px solid #bfdbfe;
            border-radius: 8px;
            padding: 14px 18px;
            display: table; width: 100%;
        }
        .price-band-cell { display: table-cell; vertical-align: middle; }
        .price-band-label {
            font-size: 10px; font-weight: 700; color: #1e40af;
            text-transform: uppercase; letter-spacing: .08em;
        }
        .price-band-val {
            font-size: 24px; font-weight: 800; color: #1e2a5e; margin-top: 4px;
        }
        .price-band-cell-right { text-align: right; font-size: 10px; color: #475569; }
        .footer {
            position: fixed; bottom: 20px; left: 40px; right: 40px;
            font-size: 9px; color: #94a3b8; text-align: center;
            border-top: 1px solid #e5e7eb; padding-top: 8px;
        }
    </style>
</head>
<body>
    <div class="head">
        <div class="head-cell">
            <div class="head-title">QUOTATION</div>
            <div class="head-sub">Cross Border Command · Shared Price Receipt</div>
        </div>
        <div class="head-cell head-right">
            <span class="head-chip">Q-{{ str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT) }}</span>
            <div class="head-sub">{{ \Carbon\Carbon::parse($entry->shared_at)->format('d/m/Y H:i') }}</div>
        </div>
    </div>

    <div class="strip">
        <div class="strip-cell">
            <div class="strip-label">Opportunity</div>
            <div class="strip-val">{{ $entry->lead?->opp_code ?? $entry->lead?->unique_query_id ?? '—' }}</div>
        </div>
        <div class="strip-cell">
            <div class="strip-label">Customer</div>
            <div class="strip-val">{{ $entry->lead?->customer?->company_name ?? $entry->lead?->sender_name ?? '—' }}</div>
        </div>
        <div class="strip-cell">
            <div class="strip-label">Customer Code</div>
            <div class="strip-val">{{ $entry->lead?->customer?->customer_code ?? '—' }}</div>
        </div>
        <div class="strip-cell">
            <div class="strip-label">Issued By</div>
            <div class="strip-val">{{ $entry->creator?->name ?? '—' }}</div>
        </div>
    </div>

    <div class="section-title">Product</div>
    <table class="detail">
        <thead>
            <tr>
                <th>Product Code</th>
                <th>Product Name</th>
                <th>Quantity</th>
                <th>Target Price</th>
                <th>Currency</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>{{ $entry->leadProduct?->product?->product_code ?? '—' }}</td>
                <td>{{ $entry->leadProduct?->product?->name ?? '—' }}</td>
                <td>{{ $entry->leadProduct?->quantity !== null ? number_format((float) $entry->leadProduct->quantity, 0) : '—' }}</td>
                <td>{{ $entry->leadProduct?->target_price !== null ? number_format((float) $entry->leadProduct->target_price, 2) : '—' }}</td>
                <td>{{ $entry->leadProduct?->currency ?? '—' }}</td>
            </tr>
        </tbody>
    </table>

    <div class="price-band">
        <div class="price-band-cell">
            <div class="price-band-label">Quoted Price</div>
            <div class="price-band-val">{{ $entry->leadProduct?->currency ?? '' }} {{ number_format((float) $entry->quoted_price, 2) }}</div>
        </div>
        <div class="price-band-cell price-band-cell-right">
            Effective on {{ \Carbon\Carbon::parse($entry->shared_at)->format('d M Y, H:i') }}<br>
            Valid until withdrawn or replaced by a newer quotation
        </div>
    </div>

    <div class="footer">
        This quotation is generated by the Cross Border Command Sales Matrix · Entry ID {{ $entry->id }}
    </div>
</body>
</html>
