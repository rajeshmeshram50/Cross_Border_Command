{{--
    SPI Stage 03 - box sticker, 4in x 6in (the standard shipping-label stock).

    dompdf has no flexbox and no grid, so the layout is tables throughout. Every
    measurement is in points because the page is set in points; mixing in mm or
    px makes dompdf round inconsistently between the screen and the printer.

    The QR carries the BOX CODE and nothing else - that is the exact string the
    put-away scanner matches on (SpiPutawayController, scan_type 'box'). Putting
    a URL or a json blob in it would break the scan.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 0; }

        body {
            margin: 0;
            padding: 10pt;
            font-family: DejaVu Sans, sans-serif;
            color: #0f172a;
            font-size: 8pt;
        }

        table { width: 100%; border-collapse: collapse; }
        td { vertical-align: top; }

        .card { border: 1.5pt solid #0e7490; border-radius: 4pt; }

        /* Header strip: the two numbers the floor reads first. */
        .strip td {
            background: #0e7490;
            color: #fff;
            padding: 6pt 8pt;
        }
        .strip .lbl { font-size: 6pt; letter-spacing: .6pt; opacity: .85; }
        .strip .val { font-size: 11pt; font-weight: bold; }
        .strip .box { font-size: 15pt; font-weight: bold; }

        .sec { padding: 7pt 8pt; border-bottom: .75pt solid #cbd5e1; }

        .product { font-size: 10pt; font-weight: bold; line-height: 1.25; }
        .supplier { font-size: 7.5pt; color: #475569; padding-top: 2pt; }

        .tag {
            display: inline-block;
            border: .75pt solid #0e7490;
            border-radius: 8pt;
            padding: 1.5pt 6pt;
            font-size: 6.5pt;
            font-weight: bold;
            color: #0e7490;
            margin-right: 3pt;
        }
        .tag--warn { border-color: #b45309; color: #b45309; }

        .qr img { width: 118pt; height: 118pt; }
        .qr-cap { font-size: 6pt; letter-spacing: .5pt; color: #64748b; padding-top: 3pt; }

        .dl td { padding: 2.5pt 0; font-size: 7.5pt; }
        .dl .k { color: #64748b; width: 42%; }
        .dl .v { font-weight: bold; text-align: right; }

        .items td { padding: 2.5pt 4pt; border-bottom: .5pt solid #e2e8f0; font-size: 7pt; }
        .items th {
            padding: 3pt 4pt;
            background: #f1f5f9;
            font-size: 6pt;
            letter-spacing: .4pt;
            text-align: left;
            color: #475569;
        }
        .items .num { text-align: right; }

        .foot td {
            padding: 5pt 8pt;
            background: #f8fafc;
            font-size: 7pt;
            color: #475569;
        }
        .foot .code { font-weight: bold; color: #0f172a; }
    </style>
</head>
<body>
<div class="card">

    <table class="strip">
        <tr>
            <td>
                <div class="lbl">SPI NUMBER</div>
                <div class="val">{{ $spi->code }}</div>
            </td>
            <td style="text-align: right;">
                <div class="lbl">BOX NO.</div>
                <div class="box">{{ $box->box_code }}</div>
            </td>
        </tr>
    </table>

    <div class="sec">
        <div class="product">{{ $headline }}</div>
        @if ($supplier)
            <div class="supplier">{{ $supplier }}</div>
        @endif
        <div style="padding-top: 5pt;">
            <span class="tag">{{ $scenarioLabel }}</span>
            <span class="tag {{ $box->condition === 'perfect' ? '' : 'tag--warn' }}">
                {{ ucfirst($box->condition) }}
            </span>
            @if ($spi->document_type)
                <span class="tag">{{ ucfirst($spi->document_type) }}</span>
            @endif
        </div>
    </div>

    {{-- QR on the left, the figures that matter beside it. --}}
    <table class="sec">
        <tr>
            <td class="qr" style="width: 128pt;">
                @if ($qr)
                    <img src="{{ $qr }}" alt="{{ $box->box_code }}">
                @endif
                <div class="qr-cap">SCAN TO VERIFY</div>
            </td>
            <td style="padding-left: 8pt;">
                <table class="dl">
                    <tr><td class="k">Products</td><td class="v">{{ $box->items->count() }}</td></tr>
                    <tr><td class="k">Total Qty</td><td class="v">{{ $totalQty }}</td></tr>
                    @if ($box->gross_weight_kg)
                        <tr><td class="k">Gross Wt</td><td class="v">{{ (float) $box->gross_weight_kg }} kg</td></tr>
                    @endif
                    @if ($dims)
                        <tr><td class="k">Dimensions</td><td class="v">{{ $dims }}</td></tr>
                    @endif
                    @if ($volumetric)
                        <tr><td class="k">Volumetric</td><td class="v">{{ $volumetric }} kg</td></tr>
                    @endif
                    <tr><td class="k">Packed</td><td class="v">{{ $packedOn }}</td></tr>
                </table>
            </td>
        </tr>
    </table>

    {{-- Contents. Capped, because a sticker that spills onto page 2 is useless
         on a carton - the count above still reports the true total. --}}
    <table class="items">
        <tr>
            <th>CONTENTS</th>
            <th style="width: 58pt;">BATCH</th>
            <th class="num" style="width: 44pt;">QTY</th>
        </tr>
        @foreach ($lines as $line)
            <tr>
                <td>{{ $line['description'] }}</td>
                <td>{{ $line['batch'] }}</td>
                <td class="num">{{ $line['qty'] }} {{ $line['uom'] }}</td>
            </tr>
        @endforeach
        @if ($hidden > 0)
            <tr>
                <td colspan="3" style="color: #64748b; font-style: italic;">
                    + {{ $hidden }} more product(s) - see {{ $spi->code }}
                </td>
            </tr>
        @endif
    </table>

    <table class="foot">
        <tr>
            <td><span class="code">{{ $box->box_code }}</span></td>
            <td style="text-align: right;">{{ $printedOn }}</td>
        </tr>
    </table>

</div>
</body>
</html>
