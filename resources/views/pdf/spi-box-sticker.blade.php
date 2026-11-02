{{--
SPI Stage 03 — temporary put-away box sticker.

LAYOUT PORTED from the "Temporary Putaway Box" face. Its order is kept
exactly:

head TEMPORARY PUTAWAY BOX | condition chip
bar BUSINESS REFERENCE — 3 rows of three
bar BOX CONDITION & PRODUCT FLAGS — 3 rows of three
bar BOX LOCATION DETAILS — a row of three, then three (no shelf on a box)
qr the QR, large and centred
caption PUT-<box code>

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
            /* Roboto Condensed (bundled TTFs, latin subset). DejaVu stays in the
           stack as the glyph fallback — Roboto's subset has no arrow (→), so
           the packing scenario borrows it from DejaVu. */
            @font-face {
                font-family: 'Roboto Condensed';
                font-weight: 400;
                src: url("{{ public_path('fonts/RobotoCondensed-Regular.ttf') }}") format('truetype');
            }

            @font-face {
                font-family: 'Roboto Condensed';
                font-weight: 700;
                src: url("{{ public_path('fonts/RobotoCondensed-Bold.ttf') }}") format('truetype');
            }

            @font-face {
                font-family: 'Roboto Condensed';
                font-weight: 800;
                src: url("{{ public_path('fonts/RobotoCondensed-ExtraBold.ttf') }}") format('truetype');
            }

            /* The page margin is the gap OUTSIDE the frame; the frame itself is
           the body's border. A wrapper table would have added a nesting level
           to every block below it, which is what blew the page budget before. */
            @page {
                margin: 8px;
            }

            body {
                margin: 0;
                padding: 0;
                font-family: 'Roboto Condensed', 'DejaVu Sans', sans-serif;
                color: #000;
                font-size: 16px;
                border: 4px solid #000;
                border-radius: 13.3333px;
            }

            table {
                width: 100%;
                border-collapse: collapse;
            }

            td {
                vertical-align: top;
            }

            /* ── Head: title + condition chip ───────────────────────────────────
           The chip is a cell, not a floated span: dompdf gives a float no
           height and the row collapses behind it. */
            .head td {
                padding: 17.3333px 20.8px 12px;
            }

            .head .title {
                font-size: 24px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.2px;
            }

            .head .chipcell {
                text-align: right;
                width: 42%;
            }

            .head .chip {
                display: inline-block;
                background: #000;
                color: #fff;
                font-size: 17.3333px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.3px;
                padding: 14px 32px;
                /* Rounded, like the frame around it. A square chip beside a 10pt
               corner was the one hard angle left on the sheet. */
                border-radius: 10.6667px;
            }

            /* ── Section bars ──
           A light band with a black left accent. The fill is #ebebeb, not a
           mid grey: a thermal head has no grey at all, so every tint is a
           dither pattern, and a light one scatters few enough dots to stay
           readable where a 50% would turn to mud. The accent carries the
           weight instead of the fill. */

            .bar {
                margin: 0.5px;
            }

            .bar td {
                background: #ebebeb;
                color: #000;
                border-left: 8px solid #000;
                font-size: 18px;
                font-weight: bold;
                letter-spacing: 0.2px;
                line-height: 1.15;
                padding: 3px 20.8px;
            }

            /* ── Field grids ── */
            /* 22.6pt on the left, not 15.6: the section bar above carries a 7pt
           accent border PLUS its 15.6pt padding, so its text starts 7pt
           further in. Matching that puts every value directly under the
           heading it belongs to. The 7pt comes OFF the right so the cell's
           content width is unchanged — adding it outright narrowed every
           column and pushed the plain label onto a second page. */
            .grid td {
                padding: 2px 11.4667px 2px 30.1333px;
            }

            .grid .k {
                font-size: 16px;
                line-height: 1.15;
                letter-spacing: 0;
                color: #000000;
            }

            .grid .v {
                font-size: 20px;
                line-height: 1.15;
                font-weight: bold;
                letter-spacing: 0;
                /* padding-top: 2.1333px; */
            }

            .grid .v--sm {
                font-size: 18px;
            }

            .grid .dt {
                font-size: 16px;
                line-height: 1.2;
                letter-spacing: 0;
                color: #000000;
                /* padding-top: 1px; */
            }

            /* No hairline between grid rows — the section bars alone separate the
           groups; the in-between rules read as clutter. (.grid--rule kept on the
           rows as a grouping marker, now with no border.) */

            /* ── QR + handling symbols ──
           The QR fills the left; the symbols wrap into a 2-wide grid on the
           right, with the box code in the bottom-right corner. */
            .qrblock td {
                padding: 1.3333px 20.8px 2px;
            }

            .qrblock .qrcell {
                /* Left-hung. The QR PNG carries its own quiet zone, so a small
                   left pad already clears the frame; a larger one over-insets it. */
                text-align: left;
                padding-left: 10px;
                vertical-align: top;
            }

            /* The right column stacks the symbols (top) over the box code
               (bottom), so the code sits in the bottom-right corner. */
            .qrblock .rightcol {
                vertical-align: bottom;
                text-align: right;
                padding-left: 5.3333px;
            }

            .qrblock .codebig {
                font-size: 30px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.2px;
                text-align: right;
                /* One line always — never split "PUT-B-001" across two rows. */
                white-space: nowrap;
                padding: 10.6667px 2.6667px 0 0;
            }

            /* Nested in the right column — must not inherit the global 100%. */
            .qrblock .pictos {
                width: auto;
            }

            .qrblock .picto {
                text-align: center;
                padding: 0 5.3333px;
            }

            /* Two lines are RESERVED on both captions whether or not they are
           used. Without that, a one-line caption makes its tile shorter, and
           a middle-aligned short tile puts its icon above the others —
           four symbols on four different baselines. */
            .picto-t {
                font-size: 12px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.5333px;
                padding-top: 6.6667px;
                height: 26.6667px;
            }

            .picto-s {
                font-size: 12px;
                line-height: 1.1;
                letter-spacing: 0.4px;
                color: #3a3a3a;
                /* padding-top: 1.8667px; */
                height: 22.6667px;
            }
        </style>
    </head>

    <body>
        @php
            // One dash everywhere a reference is absent — a blank cell reads as a bug.
            $or = fn($v) => filled($v) ? $v : '—';
        @endphp

        {{-- ── Head ── --}}
        <table class="head">
            <tr>
                <td class="title">TEMPORARY PUTAWAY BOX</td>
                <td class="chipcell"><span class="chip">{{ strtoupper($conditionLabel) }}</span></td>
            </tr>
        </table>

        {{-- ── Business reference ── --}}
        <table class="bar">
            <tr>
                <td>BUSINESS REFERENCE</td>
            </tr>
        </table>

        <table class="grid">
            <tr>
                @foreach (['shp' => 'SHIPMENT ID', 'opp' => 'OPPORTUNITY ID', 'proc' => 'PROCUREMENT ID'] as $k => $label)
                    <td width="33%">
                        <div class="k">{{ $label }}</div>
                        <div class="v v--sm">{{ $or($refs[$k]['code']) }}</div>
                        <div class="dt">DT: {{ $or($refs[$k]['date']) }}</div>
                    </td>
                @endforeach
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                @foreach (['pi' => 'PROFORMA INVOICE', 'po' => 'PURCHASE ORDER', 'spi' => 'SUPPLIER INVOICE'] as $k => $label)
                    <td width="33%">
                        <div class="k">{{ $label }}</div>
                        <div class="v v--sm">{{ $or($refs[$k]['code']) }}</div>
                        <div class="dt">DT: {{ $or($refs[$k]['date']) }}</div>
                    </td>
                @endforeach
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                <td width="33%">
                    <div class="k">CUSTOMER</div>
                    <div class="v v--sm">{{ $or($parties['customer']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">CONSIGNEE</div>
                    <div class="v v--sm">{{ $or($parties['consignee']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">SUPPLIER</div>
                    <div class="v v--sm">{{ $or($parties['supplier']) }}</div>
                </td>
            </tr>
        </table>

        {{-- ── Box condition & product flags ── --}}
        <table class="bar">
            <tr>
                <td>BOX CONDITION &amp; PRODUCT FLAGS</td>
            </tr>
        </table>

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
        <table class="bar">
            <tr>
                <td>BOX LOCATION DETAILS</td>
            </tr>
        </table>

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

        {{-- A box is put away only to rack level — no shelf on the box sticker. --}}
        <table class="grid grid--rule">
            <tr>
                <td width="33%">
                    <div class="k">WH TYPE</div>
                    <div class="v v--sm">{{ $or($place['whType']) }}</div>
                </td>
                <td width="34%">
                    <div class="k">ZONE</div>
                    <div class="v v--sm">{{ $or($place['zone']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">RACK</div>
                    <div class="v v--sm">{{ $or($place['rack']) }}</div>
                </td>
            </tr>
        </table>

        {{-- ── QR + handling symbols + box code ──
             The QR fills the left; the symbols wrap into a 2-wide grid on the
             right, with the box code in the bottom-right corner. The QR grows
             as symbols drop away. --}}
        @php
            $rightCol = match (count($pictos)) {
                0 => '200px',   // just the code
                1, 2 => '253.3333px',   // one/two symbols in a row, code under
                default => '150px',   // 3-4 symbols wrap to a 2-wide grid (icon + title only)
            };
            $qrSize = match (count($pictos)) {
                0 => 390,
                1, 2 => 384,
                default => 365,
            };
            /* 3+ symbols wrap two-per-row so they do not eat the QR's width;
               1-2 stay on one line. */
            $pictoRows = array_chunk($pictos, count($pictos) > 2 ? 2 : max(1, count($pictos)));
        @endphp
        <table class="qrblock">
            <tr>
                <td class="qrcell">
                    @if ($qr)
                        <img src="{{ $qr }}" alt="{{ $box->box_code }}" width="{{ $qrSize }}" height="{{ $qrSize }}">
                    @endif
                </td>
                <td class="rightcol" width="{{ $rightCol }}">
                    @if (count($pictos))
                        <table class="pictos" align="right">
                            @foreach ($pictoRows as $row)
                                <tr>
                                    @foreach ($row as $p)
                                        {{-- Icon + title only; the detail is in the flag rows above. --}}
                                        <td class="picto">
                                            <img src="{{ $p['svg'] }}" alt="{{ $p['title'] }}" width="68" height="68">
                                            <div class="picto-t">{{ $p['title'] }}</div>
                                        </td>
                                    @endforeach
                                </tr>
                            @endforeach
                        </table>
                    @endif
                    <div class="codebig">{{ $putawayCode }}</div>
                </td>
            </tr>
        </table>

    </body>

    </html>