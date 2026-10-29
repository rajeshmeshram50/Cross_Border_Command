{{--
    SPI Stage 03 — temporary put-away box sticker.

    LAYOUT PORTED from Atharv's prototype (SPI_With_PO_Flow_2, the "Temporary
    Putaway Sticker" face of the box sticker modal). Its order is kept exactly:

        strip        Box ID  |  SPI Number
        product      the box's product, "+N more" when it holds several
        scan row     QR beside the three figures a picker reads — L×W×H,
                     Qty, Gross Wt
        footrow      Temporary Location + the TEMPORARY PUTAWAY status

    Everything below that row is ours and has no equivalent on the prototype
    face: the packing scenario, the product flags, the business references,
    the full put-away path and the receiving check.

    PRINT TREATMENT IS NOT PORTED, deliberately. The prototype is a screen
    design — teal gradients, soft shadows, 9px radii. This sheet prints, and
    on a thermal head there is no grey: every tint dithers. A dithered panel
    behind the QR stops its quiet zone being quiet and the put-away scanner
    starts failing on scuffed labels. So the gradients become solid black
    bars, the tinted dim tiles become ruled boxes, and the status pill becomes
    a black chip. Same hierarchy, same reading order, no halftones.

    A4 PORTRAIT, FULL BLEED: the design owns the whole sheet. No page padding
    and no inset card — the black bars run edge to edge, which is also what
    keeps them readable if the printer's head drifts.

    ONE PAGE, and it has to stay one page: a sticker that breaks is a sticker
    the printer spits out twice with half the data on the second sheet. Three
    rules keep it there, all learned the hard way:

      · NO percentage heights. dompdf resolves height:100% against the CONTENT
        box rather than the page, so a sheet built that way grew to three pages
        instead of filling one.
      · NO deep nesting. Tables inside cells inside cells get measured badly —
        the version with the receiving panel as a table-in-a-cell-in-a-cell
        reported ~550pt of content for ~280pt of actual rows. Every block below
        is a SIBLING table, one level deep, and the two-column rows hold plain
        divs.
      · PIN line-height on every label/value pair. DejaVu's default line box
        is about 1.45, so each two-line field carried ~7pt of air it did not
        need; across the sheet that was most of a 70pt overrun.

    The QR is the donor for anything a new row needs. After ANY change here,
    re-render and COUNT THE PAGES.

    dompdf has no flexbox and no grid, so everything is tables. Measurements
    are in points because the page is set in points; mixing in mm or px makes
    dompdf round inconsistently between the screen and the printer.

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
        .mast td { padding: 6.8pt 15.6pt 4.9pt; }
        .mast .brandcell { border-right: 1.95pt solid #000; text-align: center; }
        .mast .org { font-size: 8.97pt; line-height: 1.1; letter-spacing: 0.98pt; padding-top: 3.9pt; }
        .mast .print { font-size: 9.75pt; line-height: 1.1; text-align: right; }
        .mast .title { font-size: 17.5pt; line-height: 1.15; font-weight: bold; letter-spacing: 0.39pt; text-align: center; padding-top: 1.95pt; }

        /* The condition is the one thing read from two metres away. It sits
           under the title rather than across the label so the mark keeps its
           own column. */
        .cond {
            background: #000;
            color: #fff;
            font-size: 16.5pt;
            line-height: 1.15;
            font-weight: bold;
            letter-spacing: 1.17pt;
            text-align: center;
            padding: 4.9pt 11.7pt;
            margin-top: 4.9pt;
        }

        /* ── Prototype strip: Box ID | SPI Number ───────────────────────────
           The prototype's teal gradient, as a solid bar. Both values are the
           ones a picker reads out loud, so they are the largest mono text on
           the sheet after the condition. */
        .strip td { background: #000; color: #fff; padding: 5.4pt 15.6pt; }
        .strip .sl { font-size: 7.8pt; line-height: 1.1; letter-spacing: 1.4pt; color: #d9d9d9; }
        .strip .sv { font-size: 17.5pt; line-height: 1.15; font-weight: bold; letter-spacing: 0.5pt; padding-top: 1.2pt; }
        .strip .right { text-align: right; }

        /* ── Product name ── */
        .pname {
            font-size: 14.5pt;
            line-height: 1.2;
            font-weight: bold;
            padding: 6.8pt 15.6pt 0;
        }
        .pname .more { font-size: 10.5pt; font-weight: normal; }

        /* ── Scan row: QR left, the three figures right. Plain divs inside the
             cells — a nested table here is what blew the page budget. ── */
        .scan td { padding: 0; }
        .scan .qrcell { text-align: center; padding: 7.8pt 11.7pt 0; width: 46%; }
        .scan .dimcell { padding: 9.75pt 15.6pt 0 0; }

        /* The prototype's three tinted tiles, ruled instead of filled. */
        .dims td { border: 0.98pt solid #000; padding: 5.4pt 4pt; text-align: center; }
        .dims .dl { font-size: 7.8pt; line-height: 1.05; letter-spacing: 0.7pt; color: #3a3a3a; }
        .dims .dv { font-size: 13.5pt; line-height: 1.1; font-weight: bold; padding-top: 2.4pt; }

        /* ── Footrow: temporary location + status chip ── */
        .footrow td { padding: 7.8pt 15.6pt 0; }
        .footrow .loc { font-size: 11.7pt; line-height: 1.15; font-weight: bold; }
        .footrow .loc span { font-size: 9.36pt; font-weight: normal; letter-spacing: 0.78pt; color: #3a3a3a; }
        .footrow .status {
            background: #000;
            color: #fff;
            font-size: 9.75pt;
            line-height: 1.1;
            font-weight: bold;
            letter-spacing: 1.17pt;
            padding: 4.4pt 11.7pt;
            text-align: center;
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
        .grid td { padding: 3.9pt 15.6pt; }
        .grid .k { font-size: 9.36pt; line-height: 1.05; letter-spacing: 0.78pt; color: #3a3a3a; }
        .grid .v { font-size: 15.6pt; line-height: 1.1; font-weight: bold; padding-top: 0.98pt; }
        .grid .v--sm { font-size: 13.65pt; }
        .grid .v--xs { font-size: 11.7pt; }
        .grid .dt { font-size: 9.36pt; line-height: 1.05; color: #3a3a3a; padding-top: 0.98pt; }
        .grid--rule td { border-top: 0.98pt solid #000; }

        .rcvbar {
            background: #000;
            color: #fff;
            font-size: 10.53pt;
            line-height: 1.1;
            font-weight: bold;
            letter-spacing: 1.17pt;
            padding: 3.9pt 13.65pt;
        }
        .rcv-f { padding: 3.4pt 13.65pt; }
        .rcv-f + .rcv-f { border-top: 0.98pt solid #000; }
        .rcv-f .rk { font-size: 7.8pt; line-height: 1.05; letter-spacing: 0.6pt; color: #3a3a3a; }
        .rcv-f .rv { font-size: 10.5pt; line-height: 1.1; font-weight: bold; padding-top: 0.8pt; }

        /* ── Footer ── */
        .foot td { border-top: 1.95pt solid #000; padding: 4.9pt 15.6pt 6.8pt; text-align: center; }
        .foot .code { font-size: 22pt; line-height: 1.1; font-weight: bold; letter-spacing: 1.95pt; }
        .foot .seq { font-size: 10.14pt; line-height: 1.1; letter-spacing: 0.98pt; padding-top: 2.93pt; }
        .foot .seq b { font-size: 14.63pt; letter-spacing: 0; }

        /* word-break, or a 60-char URL runs off the label. */
        .qr-url {
            font-family: 'DejaVu Sans Mono', monospace;
            font-size: 6.83pt;
            color: #555;
            line-height: 1.2;
            word-break: break-all;
            padding: 3.4pt 0 0;
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

{{-- ── Prototype strip ────────────────────────────────────────────────── --}}
<table class="strip">
    <tr>
        <td>
            <div class="sl">BOX ID</div>
            <div class="sv">{{ $putawayCode }}</div>
        </td>
        <td class="right">
            <div class="sl">SPI NUMBER</div>
            <div class="sv">{{ $or($refs['spi']['code']) }}</div>
        </td>
    </tr>
</table>

{{-- ── Product name, as the prototype leads with ──────────────────────── --}}
<div class="pname">
    {{ $or($productName) }}@if ($moreProducts > 0)<span class="more"> +{{ $moreProducts }} more</span>@endif
</div>

{{-- ── Scan + the three figures a picker reads ────────────────────────── --}}
<table class="scan">
    <tr>
        <td class="qrcell">
            @if ($qr)
                <img src="{{ $qr }}" alt="{{ $box->box_code }}" width="150" height="150">
            @endif
            {{-- The payload in text: a scuffed label can still be typed in. --}}
            <div class="qr-url">{{ $qrUrl }}</div>
        </td>
        <td class="dimcell">
            <table class="dims">
                <tr>
                    <td style="width: 40%;">
                        <div class="dl">L×W×H (CM)</div>
                        <div class="dv">{{ $or($dims) }}</div>
                    </td>
                    <td style="width: 30%;">
                        <div class="dl">QTY</div>
                        <div class="dv">{{ $boxQty }}</div>
                    </td>
                    <td>
                        <div class="dl">GROSS WT</div>
                        <div class="dv">{{ $or($grossWeight) }}</div>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>

{{-- ── Temporary location + status ────────────────────────────────────── --}}
<table class="footrow">
    <tr>
        <td>
            <div class="loc"><span>TEMPORARY LOCATION</span><br>{{ $or($place['path']) }}</div>
        </td>
        <td style="width: 38%;">
            <div class="status">TEMPORARY PUTAWAY</div>
        </td>
    </tr>
</table>

{{-- ── Packing scenario & product flags ───────────────────────────────── --}}
<table class="bar" style="margin-top: 7.8pt;">
    <tr>
        <td>PACKING SCENARIO &amp; PRODUCT FLAGS</td>
        <td class="note">BOX {{ $boxNo }} OF {{ $totalBoxes }}</td>
    </tr>
</table>
<table class="grid">
    <tr>
        <td style="width: 41%;"><div class="k">BOX PACKING SCENARIO</div><div class="v v--sm">{{ $scenarioLabel }}</div></td>
        <td style="width: 31%;"><div class="k">NET WT. / GROSS WT.</div><div class="v v--sm">{{ $or($netWeight) }} / {{ $or($grossWeight) }}</div></td>
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

{{-- ── Box location details ───────────────────────────────────────────── --}}
<table class="bar"><tr><td colspan="2">BOX LOCATION DETAILS</td></tr></table>
<table class="grid">
    <tr>
        <td style="width: 34%;">
            <div class="k">WAREHOUSE (ID / NAME)</div>
            <div class="v v--xs">{{ $or($place['warehouse']) }}@if ($place['whName']) / {{ $place['whName'] }}@endif</div>
        </td>
        <td style="width: 25%;"><div class="k">WH TYPE</div><div class="v v--xs">{{ $or($place['whType']) }}</div></td>
        <td><div class="k">ALLOCATED DATE</div><div class="v v--xs">{{ $or($place['allocatedOn']) }}</div></td>
    </tr>
</table>
<table class="grid grid--rule">
    <tr>
        <td style="width: 33.33%;"><div class="k">ZONE</div><div class="v v--sm">{{ $or($place['zone']) }}</div></td>
        <td style="width: 33.33%;"><div class="k">RACK</div><div class="v v--sm">{{ $or($place['rack']) }}</div></td>
        <td><div class="k">SHELF</div><div class="v v--sm">{{ $or($place['shelf']) }}</div></td>
    </tr>
</table>

{{-- ── Receiving check ────────────────────────────────────────────────── --}}
<table class="bar"><tr><td colspan="2">RECEIVING CHECK</td></tr></table>
<table class="grid">
    <tr>
        <td style="width: 33.33%;">
            <div class="k">RECEIVED ON</div>
            <div class="v v--xs">{{ $or($receiving['onDate']) }}@if ($receiving['onTime']) | {{ $receiving['onTime'] }}@endif</div>
        </td>
        <td style="width: 33.33%;"><div class="k">RECEIVED BY</div><div class="v v--xs">{{ $or($receiving['by']) }}</div></td>
        <td><div class="k">NEXT STAGE</div><div class="v v--xs">{{ $receiving['next'] }}</div></td>
    </tr>
</table>
<table class="grid grid--rule">
    <tr>
        <td style="width: 50%;"><div class="k">SPI CHECK</div><div class="v v--sm">{{ $receiving['spiCheck'] }}</div></td>
        <td><div class="k">PHYSICAL CHECK</div><div class="v v--sm">{{ $receiving['physical'] }}</div></td>
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
