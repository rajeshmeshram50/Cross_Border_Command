{{--
    SPI Stage 03 — temporary put-away box sticker.

    LAYOUT PORTED from the "Temporary Putaway Box" face. Its order is kept
    exactly:

        head         TEMPORARY PUTAWAY BOX  |  condition chip
        bar          BUSINESS REFERENCE      — 3 rows of three
        bar          BOX CONDITION & PRODUCT FLAGS — 3 rows of three
        bar          BOX LOCATION DETAILS    — a row of three, then four
        qr           the QR, large and centred
        caption      PUT-<box code>

    Two things the previous face carried are NOT on this one, by design, not
    by omission: the product name, and the QR's URL printed as text. The
    design leads with the carton's identity instead of its contents, and
    captions the QR with the put-away code. A damaged QR is therefore
    re-keyed from that code, not from the URL.

    PRINT TREATMENT, and where it departs from the mock. A thermal head has
    no grey: every tint is a dither pattern. That rules out a tint BEHIND THE
    QR — it stops the quiet zone being quiet and the put-away scanner starts
    failing on scuffed labels — and it rules out mid greys anywhere, which
    turn to mud. It does not rule out a light band: the section bars carry
    #ebebeb with a black left accent, as the design draws them, and scatter
    few enough dots to stay readable. The condition chip stays solid black,
    the tinted tiles are ruled boxes, and the frame is square.

    A4 PORTRAIT, FRAMED: a 3pt rule around the label, 9pt clear of the paper
    edge. The frame is the BODY's border, not a wrapper table — wrapping the
    sheet in a table cell would put every block one level deeper, and deep
    nesting is what dompdf measures badly (see below). The black bars run to
    the frame, which keeps them readable if the printer's head drifts.

    ONE PAGE, and it has to stay one page: a sticker that breaks is a sticker
    the printer spits out twice with half the data on the second sheet. Three
    rules keep it there, all learned the hard way:

      · NO percentage heights. dompdf resolves height:100% against the CONTENT
        box rather than the page, so a sheet built that way grew to three pages
        instead of filling one.
      · NO deep nesting. Tables inside cells inside cells get measured badly —
        the version with the receiving panel as a table-in-a-cell-in-a-cell
        reported ~550pt of content for ~280pt of actual rows. Every block below
        is a SIBLING table, one level deep, and the multi-column rows hold
        plain divs.
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
        /* The page margin is the gap OUTSIDE the frame; the frame itself is
           the body's border. A wrapper table would have added a nesting level
           to every block below it, which is what blew the page budget before. */
        @page { margin: 6pt; }

        body {
            margin: 0;
            padding: 0;
            font-family: DejaVu Sans, sans-serif;
            color: #000;
            font-size: 12pt;
            border: 3pt solid #000;
            border-radius: 10pt;
        }

        table { width: 100%; border-collapse: collapse; }
        td { vertical-align: top; }

        /* ── Head: title + condition chip ───────────────────────────────────
           The chip is a cell, not a floated span: dompdf gives a float no
           height and the row collapses behind it. */
        .head td { padding: 13pt 15.6pt 9pt; }
        .head .title {
            font-size: 19pt; line-height: 1.1; font-weight: bold;
            letter-spacing: 0.5pt;
        }
        .head .chipcell { text-align: right; width: 42%; }
        .head .chip {
            display: inline-block;
            background: #000; color: #fff;
            font-size: 13pt; line-height: 1.15; font-weight: bold;
            letter-spacing: 1pt;
            padding: 6pt 16pt;
            /* Rounded, like the frame around it. A square chip beside a 10pt
               corner was the one hard angle left on the sheet. */
            border-radius: 8pt;
        }

        /* ── Section bars ──
           A light band with a black left accent. The fill is #ebebeb, not a
           mid grey: a thermal head has no grey at all, so every tint is a
           dither pattern, and a light one scatters few enough dots to stay
           readable where a 50% would turn to mud. The accent carries the
           weight instead of the fill. */
        .bar td {
            background: #ebebeb; color: #000;
            border-left: 7pt solid #000;
            font-size: 11pt; font-weight: bold;
            letter-spacing: 1.1pt; line-height: 1.1;
            padding: 4.6pt 15.6pt;
        }

        /* ── Field grids ── */
        /* 22.6pt on the left, not 15.6: the section bar above carries a 7pt
           accent border PLUS its 15.6pt padding, so its text starts 7pt
           further in. Matching that puts every value directly under the
           heading it belongs to. The 7pt comes OFF the right so the cell's
           content width is unchanged — adding it outright narrowed every
           column and pushed the plain label onto a second page. */
        .grid td { padding: 5.6pt 8.6pt 5.6pt 22.6pt; }
        .grid .k {
            font-size: 8.8pt; line-height: 1.05;
            letter-spacing: 0.7pt; color: #3a3a3a;
        }
        .grid .v {
            font-size: 15pt; line-height: 1.12;
            font-weight: bold; padding-top: 1.6pt;
        }
        .grid .v--sm { font-size: 12.6pt; }
        .grid .dt {
            font-size: 9pt; line-height: 1.05;
            color: #3a3a3a; padding-top: 1.6pt;
        }
        /* A hairline between grid rows inside the same section, so three rows
           of three read as rows rather than as nine loose fields. */
        .grid--rule td { border-top: 0.8pt solid #9a9a9a; }

        /* ── QR + handling symbols ──
           The symbols share the QR's row rather than sitting under it: the
           row is the one place on the sheet with spare height, and a handler
           reads them at the same glance as the code. */
        .qrblock td { padding: 11pt 15.6pt 0; vertical-align: middle; }
        .qrblock .qrcell { text-align: center; }
        .qrblock .picto { text-align: center; padding: 0 4pt; }
        /* Two lines are RESERVED on both captions whether or not they are
           used. Without that, a one-line caption makes its tile shorter, and
           a middle-aligned short tile puts its icon above the others —
           four symbols on four different baselines. */
        .picto-t {
            font-size: 9pt; line-height: 1.1; font-weight: bold;
            letter-spacing: 0.4pt; padding-top: 5pt;
            height: 20pt;
        }
        .picto-s {
            font-size: 7.6pt; line-height: 1.1;
            letter-spacing: 0.3pt; color: #3a3a3a; padding-top: 1.4pt;
            height: 17pt;
        }
        .caption td {
            text-align: center;
            padding: 7pt 15.6pt 10pt;
            font-size: 26pt; line-height: 1.1;
            font-weight: bold; letter-spacing: 2pt;
        }
    </style>
</head>
<body>
@php
    // One dash everywhere a reference is absent — a blank cell reads as a bug.
    $or = fn ($v) => filled($v) ? $v : '—';
@endphp

{{-- ── Head ── --}}
<table class="head">
    <tr>
        <td class="title">TEMPORARY PUTAWAY BOX</td>
        <td class="chipcell"><span class="chip">{{ strtoupper($conditionLabel) }}</span></td>
    </tr>
</table>

{{-- ── Business reference ── --}}
<table class="bar"><tr><td>BUSINESS REFERENCE</td></tr></table>

<table class="grid">
    <tr>
        @foreach (['shp', 'opp', 'proc'] as $k)
            <td width="33%">
                <div class="v v--sm">{{ $or($refs[$k]['code']) }}</div>
                <div class="dt">DT: {{ $or($refs[$k]['date']) }}</div>
            </td>
        @endforeach
    </tr>
</table>

<table class="grid grid--rule">
    <tr>
        @foreach (['pi', 'po', 'spi'] as $k)
            <td width="33%">
                <div class="v v--sm">{{ $or($refs[$k]['code']) }}</div>
                <div class="dt">DT: {{ $or($refs[$k]['date']) }}</div>
            </td>
        @endforeach
    </tr>
</table>

<table class="grid grid--rule">
    <tr>
        <td width="33%"><div class="v v--sm">{{ $or($parties['customer']) }}</div></td>
        <td width="33%"><div class="v v--sm">{{ $or($parties['consignee']) }}</div></td>
        <td width="33%"><div class="v v--sm">{{ $or($parties['supplier']) }}</div></td>
    </tr>
</table>

{{-- ── Box condition & product flags ── --}}
<table class="bar"><tr><td>BOX CONDITION &amp; PRODUCT FLAGS</td></tr></table>

<table class="grid">
    <tr>
        <td width="33%">
            <div class="k">PUTAWAY BOX ID</div>
            <div class="v">{{ $putawayCode }}</div>
        </td>
        <td width="34%">
            <div class="k">BOX PACKING SCENARIO</div>
            <div class="v v--sm">{{ $scenarioLabel }}</div>
        </td>
        <td width="33%">
            <div class="k">BOX QTY</div>
            <div class="v">{{ $boxQty }}</div>
        </td>
    </tr>
</table>

<table class="grid grid--rule">
    <tr>
        <td width="33%">
            <div class="k">DIMENSIONS L&times;W&times;H (CM)</div>
            <div class="v v--sm">{{ $or($dims) }}</div>
        </td>
        <td width="34%">
            <div class="k">NET WT. / GROSS WT.</div>
            <div class="v v--sm">{{ $or($netWeight) }} / {{ $or($grossWeight) }}</div>
        </td>
        <td width="33%">
            <div class="k">BOX CONDITION</div>
            <div class="v v--sm">{{ $conditionLabel }}</div>
        </td>
    </tr>
</table>

<table class="grid grid--rule">
    <tr>
        <td width="33%">
            <div class="k">COLD CHAIN</div>
            <div class="v v--sm">{{ $coldChain }}</div>
        </td>
        <td width="34%">
            <div class="k">HAZARDOUS</div>
            <div class="v v--sm">{{ $hazardLabel }}</div>
        </td>
        <td width="33%">
            <div class="k">STACKING</div>
            <div class="v v--sm">{{ $flags['stacking'] }}</div>
        </td>
    </tr>
</table>

{{-- ── Box location ── --}}
<table class="bar"><tr><td>BOX LOCATION DETAILS</td></tr></table>

<table class="grid">
    <tr>
        <td width="33%">
            <div class="k">WAREHOUSE (ID / NAME)</div>
            <div class="v v--sm">{{ $or($place['warehouse']) }} / {{ $or($place['whName']) }}</div>
        </td>
        <td width="34%">
            <div class="k">PUTAWAY LOCATION</div>
            <div class="v v--sm">{{ $or($place['path']) }}</div>
        </td>
        <td width="33%">
            <div class="k">ALLOCATED DATE</div>
            <div class="v v--sm">{{ $or($place['allocatedOn']) }}</div>
        </td>
    </tr>
</table>

<table class="grid grid--rule">
    <tr>
        <td width="25%">
            <div class="k">WH TYPE</div>
            <div class="v v--sm">{{ $or($place['whType']) }}</div>
        </td>
        <td width="25%">
            <div class="k">ZONE</div>
            <div class="v v--sm">{{ $or($place['zone']) }}</div>
        </td>
        <td width="25%">
            <div class="k">RACK</div>
            <div class="v v--sm">{{ $or($place['rack']) }}</div>
        </td>
        <td width="25%">
            <div class="k">SHELF</div>
            <div class="v v--sm">{{ $or($place['shelf']) }}</div>
        </td>
    </tr>
</table>

{{-- ── QR + caption ── --}}
<table class="qrblock">
    <tr>
        @php
            // The QR yields width as symbols are added, so a caption has room
            // to sit on one line instead of breaking mid-word.
            $qrWidth = match (count($pictos)) { 0 => null, 1, 2 => '56%', default => '46%' };
            /* Each cell loses 31.2pt to its own padding, so these are the
               largest codes that still fit their column at A4 inside the
               frame. A QR wider than its cell is scaled DOWN by dompdf and
               stops being a whole number of modules, which is what makes a
               printed code scan badly. */
            $qrSize  = match (count($pictos)) { 0 => 330, 1, 2 => 300, default => 228 };
        @endphp
        <td class="qrcell" @if ($qrWidth) width="{{ $qrWidth }}" @endif>
            @if ($qr)
                <img src="{{ $qr }}" alt="{{ $box->box_code }}"
                     width="{{ $qrSize }}" height="{{ $qrSize }}">
            @endif
        </td>
        @foreach ($pictos as $p)
            <td class="picto">
                <img src="{{ $p['svg'] }}" alt="{{ $p['title'] }}" width="72" height="72">
                <div class="picto-t">{{ $p['title'] }}</div>
                <div class="picto-s">{{ $p['sub'] }}</div>
            </td>
        @endforeach
    </tr>
</table>

<table class="caption">
    <tr><td>{{ $putawayCode }}</td></tr>
</table>

</body>
</html>
