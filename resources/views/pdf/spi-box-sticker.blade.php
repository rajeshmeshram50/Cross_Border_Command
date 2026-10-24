{{--
    SPI Stage 03 — temporary put-away box sticker.

    A4 PORTRAIT, FULL BLEED: the design owns the whole sheet. There is no page
    padding and no inset card — the black section bars run edge to edge, which
    is also what keeps them readable if the printer's head drifts.

    ONE PAGE, and it has to stay one page: a sticker that breaks is a sticker the
    printer spits out twice with half the data on the second sheet. The content
    measures ~775pt against A4's 841.9, so there is about 65pt of headroom — one
    more field row, no more. Three rules keep it on one page, all learned the
    hard way:

      · NO percentage heights. dompdf resolves height:100% against the CONTENT
        box rather than the page, so a sheet built that way grew to three pages
        instead of filling one.
      · NO deep nesting. Tables inside cells inside cells get measured badly —
        the version with the receiving panel as a table-in-a-cell-in-a-cell
        reported ~550pt of content for ~280pt of actual rows. Every block below
        is a SIBLING table, one level deep, and the only two-column row (scan)
        holds plain divs.

      · PIN line-height on every label/value pair. DejaVu's default line box
        is about 1.45, so each two-line field carried ~7pt of air it did not
        need; across the sheet that was most of a 70pt overrun.

    The QR is the donor for anything a new row needs. After ANY change here,
    re-render and COUNT THE PAGES.

    dompdf has no flexbox and no grid, so everything is tables. Measurements are
    in points because the page is set in points; mixing in mm or px makes dompdf
    round inconsistently between the screen and the printer.

    Mono-black on purpose: a tint that looks grey on screen prints as a muddy
    halftone, and the QR's quiet zone stops being quiet.

    The QR carries a SIGNED URL, not the box code — the same payload every
    Inventory label carries, so one scanner reads them all. Do not swap it for
    bare text: the put-away scanner matches on that URL.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 0; }

        body {
            margin: 0;
            padding: 0;
            font-family: DejaVu Sans, sans-serif;
            color: #000;
            font-size: 14.63pt;
        }

        table { width: 100%; border-collapse: collapse; }
        td { vertical-align: top; }

        /* ── Masthead ───────────────────────────────────────────────────────
           The rule between the mark and the title is a cell border, not a
           divider element: dompdf collapses an empty element of fixed width
           when the row beside it grows. */
        .mast td { padding: 7.8pt 15.6pt 5.85pt; }
        .mast .brandcell { border-right: 1.95pt solid #000; text-align: center; }
        .mast .logo img { height: 40.95pt; }
        .mast .org { font-size: 8.97pt; line-height: 1.1; letter-spacing: 0.98pt; padding-top: 3.9pt; }
        .mast .print { font-size: 9.75pt; line-height: 1.1; text-align: right; }
        .mast .title { font-size: 19.5pt; line-height: 1.15; font-weight: bold; letter-spacing: 0.39pt; text-align: center; padding-top: 1.95pt; }

        /* The condition is the one thing read from two metres away. It sits
           under the title rather than across the label so the mark keeps its
           own column. */
        .cond {
            background: #000;
            color: #fff;
            font-size: 18.53pt;
            line-height: 1.15;
            font-weight: bold;
            letter-spacing: 1.17pt;
            text-align: center;
            padding: 5.85pt 11.7pt;
            margin-top: 5.85pt;
        }

        /* ── Section bars ── */
        .bar td {
            background: #000;
            color: #fff;
            font-size: 10.53pt;
            font-weight: bold;
            letter-spacing: 1.17pt;
            line-height: 1.1;
            padding: 3.9pt 15.6pt;
        }
        .bar .note { text-align: right; font-weight: normal; letter-spacing: 0.78pt; }

        /* ── Field grids ── */
        .grid td { padding: 4.29pt 15.6pt; }
        .grid .k { font-size: 9.36pt; line-height: 1.05; letter-spacing: 0.78pt; color: #3a3a3a; }
        .grid .v { font-size: 15.6pt; line-height: 1.1; font-weight: bold; padding-top: 0.98pt; }
        .grid .v--sm { font-size: 13.65pt; }
        .grid .v--xs { font-size: 11.7pt; }
        .grid .dt { font-size: 9.36pt; line-height: 1.05; color: #3a3a3a; padding-top: 0.98pt; }
        .grid--rule td { border-top: 0.98pt solid #000; }

        /* ── Scan row: QR left, receiving check right. Plain divs inside the
             cells — a nested table here is what blew the page budget. ── */
        .scan td { padding: 0; }
        .scan .qrcell { text-align: center; padding: 9.75pt 11.7pt 0; }
        .scan .qrcell img { width: 195pt; height: 195pt; }
        .scan .rcvcell { width: 38%; border-left: 1.95pt solid #000; }

        .rcvbar {
            background: #000;
            color: #fff;
            font-size: 10.53pt;
            line-height: 1.1;
            font-weight: bold;
            letter-spacing: 1.17pt;
            padding: 3.9pt 13.65pt;
        }
        .rcv-f { padding: 4.29pt 13.65pt; }
        .rcv-f + .rcv-f { border-top: 0.98pt solid #000; }

        /* ── Footer ── */
        .foot td { border-top: 1.95pt solid #000; padding: 5.85pt 15.6pt 7.8pt; text-align: center; }
        .foot .code { font-size: 24.38pt; line-height: 1.1; font-weight: bold; letter-spacing: 1.95pt; }
        .foot .seq { font-size: 10.14pt; line-height: 1.1; letter-spacing: 0.98pt; padding-top: 2.93pt; }
        .foot .seq b { font-size: 14.63pt; letter-spacing: 0; }

        /* word-break, or a 60-char URL runs off the label. */
        .qr-url {
            font-family: 'DejaVu Sans Mono', monospace;
            font-size: 6.83pt;
            color: #555;
            line-height: 1.2;
            word-break: break-all;
            padding: 3.9pt 15.6pt 0;
        }
    </style>
</head>
<body>
@php
    // One dash everywhere a reference is absent — a blank cell reads as a bug.
    $or = fn ($v) => filled($v) ? $v : '—';
@endphp

{{-- ── Masthead ───────────────────────────────────────────────────────── --}}
<table class="mast">
    <tr>
        <td class="brandcell" style="width: 42%;">
            @if ($logo)
                <img src="{{ $logo }}" alt="" width="187" height="60">
            @endif
            <div class="org">{{ strtoupper($brand ?: '') }}</div>
        </td>
        <td>
            <div class="print">Print: {{ $printNo }}</div>
            <div class="title">TEMPORARY PUTAWAY BOX</div>
            <div class="cond">{{ strtoupper($conditionLabel) }}</div>
        </td>
    </tr>
</table>

{{-- ── Business reference ─────────────────────────────────────────────── --}}
<table class="bar">
    <tr>
        <td>BUSINESS REFERENCE</td>
        <td class="note">SYSTEM AUTO-PULLED</td>
    </tr>
</table>
<table class="grid">
    <tr>
        @foreach ([['PROCUREMENT', 'procurement'], ['PURCHASE ORDER', 'po'], ['SUPPLIER INVOICE', 'spi']] as [$label, $key])
            <td style="width: 33.33%;">
                <div class="k">{{ $label }}</div>
                <div class="v v--sm">{{ $or($refs[$key]['code']) }}</div>
                <div class="dt">DT: {{ $or($refs[$key]['date']) }}</div>
            </td>
        @endforeach
    </tr>
</table>

{{-- ── Box condition & product flags ──────────────────────────────────── --}}
<table class="bar"><tr><td colspan="2">BOX CONDITION &amp; PRODUCT FLAGS</td></tr></table>
<table class="grid">
    <tr>
        <td style="width: 31%;"><div class="k">PUTAWAY BOX ID</div><div class="v">{{ $putawayCode }}</div></td>
        <td style="width: 41%;"><div class="k">BOX PACKING SCENARIO</div><div class="v v--sm">{{ $scenarioLabel }}</div></td>
        <td><div class="k">BOX QTY</div><div class="v">{{ $boxQty }}</div></td>
    </tr>
</table>
<table class="grid grid--rule">
    <tr>
        <td style="width: 31%;"><div class="k">DIMENSIONS L×W×H (CM)</div><div class="v v--sm">{{ $or($dims) }}</div></td>
        <td style="width: 41%;"><div class="k">NET WT. / GROSS WT.</div><div class="v v--sm">{{ $or($netWeight) }} / {{ $or($grossWeight) }}</div></td>
        <td><div class="k">BOX CONDITION</div><div class="v v--sm">{{ $conditionLabel }}</div></td>
    </tr>
</table>
<table class="grid grid--rule">
    <tr>
        <td style="width: 31%;"><div class="k">STORAGE CONDITION</div><div class="v v--xs">{{ $flags['storage'] }}</div></td>
        <td style="width: 41%;"><div class="k">HAZARDOUS</div><div class="v v--sm">{{ $flags['hazardous'] }}</div></td>
        <td><div class="k">STACKING</div><div class="v v--sm">{{ $flags['stacking'] }}{{ $flags['fragile'] ? ' · Fragile' : '' }}</div></td>
    </tr>
</table>

{{-- ── Box location details ───────────────────────────────────────────── --}}
<table class="bar"><tr><td colspan="2">BOX LOCATION DETAILS</td></tr></table>
<table class="grid">
    <tr>
        <td style="width: 34%;">
            <div class="k">WAREHOUSE (ID / NAME)</div>
            <div class="v v--xs">{{ $or($place['warehouse']) }}@if ($place['whName']) / {{ $place['whName'] }}@endif</div>
        </td>
        <td style="width: 41%;"><div class="k">PUTAWAY LOCATION</div><div class="v v--xs">{{ $or($place['path']) }}</div></td>
        <td><div class="k">ALLOCATED DATE</div><div class="v v--xs">{{ $or($place['allocatedOn']) }}</div></td>
    </tr>
</table>
<table class="grid grid--rule">
    <tr>
        <td style="width: 25%;"><div class="k">WH TYPE</div><div class="v v--sm">{{ $or($place['whType']) }}</div></td>
        <td style="width: 25%;"><div class="k">ZONE</div><div class="v v--sm">{{ $or($place['zone']) }}</div></td>
        <td style="width: 25%;"><div class="k">RACK</div><div class="v v--sm">{{ $or($place['rack']) }}</div></td>
        <td><div class="k">SHELF</div><div class="v v--sm">{{ $or($place['shelf']) }}</div></td>
    </tr>
</table>

{{-- ── Scan + receiving check ─────────────────────────────────────────── --}}
<table class="scan">
    <tr>
        <td class="qrcell">
            @if ($qr)
                <img src="{{ $qr }}" alt="{{ $box->box_code }}" width="133" height="133">
            @endif
            {{-- The payload in text: a scuffed label can still be typed in. --}}
            <div class="qr-url">{{ $qrUrl }}</div>
        </td>
        <td class="rcvcell">
            <div class="rcvbar">RECEIVING CHECK</div>
            <div class="rcv-f">
                <div class="k" style="font-size: 4.8pt; line-height: 1.05; letter-spacing: .4pt; color: #3a3a3a;">RECEIVED ON</div>
                <div class="v v--xs" style="font-size: 6pt; line-height: 1.1; font-weight: bold; padding-top: .5pt;">{{ $or($receiving['onDate']) }}@if ($receiving['onTime']) | {{ $receiving['onTime'] }}@endif</div>
            </div>
            <div class="rcv-f">
                <div class="k" style="font-size: 4.8pt; line-height: 1.05; letter-spacing: .4pt; color: #3a3a3a;">RECEIVED BY</div>
                <div class="v v--xs" style="font-size: 6pt; line-height: 1.1; font-weight: bold; padding-top: .5pt;">{{ $or($receiving['by']) }}</div>
            </div>
            <div class="rcv-f">
                <div class="k" style="font-size: 4.8pt; line-height: 1.05; letter-spacing: .4pt; color: #3a3a3a;">SPI CHECK</div>
                <div class="v v--sm" style="font-size: 7pt; line-height: 1.1; font-weight: bold; padding-top: .5pt;">{{ $receiving['spiCheck'] }}</div>
            </div>
            <div class="rcv-f">
                <div class="k" style="font-size: 4.8pt; line-height: 1.05; letter-spacing: .4pt; color: #3a3a3a;">PHYSICAL CHECK</div>
                <div class="v v--sm" style="font-size: 7pt; line-height: 1.1; font-weight: bold; padding-top: .5pt;">{{ $receiving['physical'] }}</div>
            </div>
            <div class="rcv-f">
                <div class="k" style="font-size: 4.8pt; line-height: 1.05; letter-spacing: .4pt; color: #3a3a3a;">NEXT STAGE</div>
                <div class="v" style="font-size: 8pt; line-height: 1.1; font-weight: bold; padding-top: .5pt;">{{ $receiving['next'] }}</div>
            </div>
        </td>
    </tr>
</table>

{{-- ── Bottom edge ────────────────────────────────────────────────────── --}}
<table class="foot">
    <tr>
        <td>
            <div class="code">{{ $putawayCode }}</div>
            <div class="seq">BOX NO. / TOTAL BOXES &nbsp;<b>{{ $boxNo }} / {{ $totalBoxes }}</b></div>
        </td>
    </tr>
</table>

</body>
</html>
