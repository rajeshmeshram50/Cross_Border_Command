{{--
    Inventory location label — A4 portrait, and it uses the whole sheet.

    STRUCTURE, top to bottom:

        header   WHAT THIS IS (left)          handling flags (right)
        qr       the code, centred and as large as the sheet allows
        code     the location's own code, under the QR
        path     the full address in ids — for a shelf that is
                 WAREHOUSE / ZONE / RACK / SHELF, each one labelled

    IT WAS 4in x 3in. That stock fit a rack upright and nothing else: the
    address had to shrink to the point of being unreadable across an aisle,
    which is the one thing a location label exists to be. A4 is what every
    printer here already holds, and at this size the code reads from the end
    of the row.

    The PATH is the point of the bottom half. A shelf label that says only
    "SH-003" names a shelf in every warehouse the client has; the chain above
    it is what makes the sticker mean one place. Each level prints its own id
    under its own heading rather than as one slashed string, so a picker can
    read off the level they need without parsing.

    The header's right side carries the flags — COLD CHAIN, HAZARDOUS,
    INACTIVE — and nothing else. No logo: a mark costs the width the flags
    need, and the flags are what change how a box is handled. "NORMAL" prints
    when there are none, so a blank corner never reads as a label that failed
    to render.

    The code stays under the QR on purpose: a scuffed or torn QR leaves
    someone on the floor holding a carton with no way to say where it belongs.
    It is the QR's own content, not extra data.

    PRINT TREATMENT: a thermal head has no grey, so every tint is a dither
    pattern. Nothing is tinted behind the QR — a dithered quiet zone is what
    makes a scuffed label stop scanning — and the flags are solid black
    rather than shaded.

    dompdf has no flexbox and no grid, so every row is a table and the
    measurements are in points, because the page is set in points. Mixing in
    mm or px makes dompdf round inconsistently between screen and printer.

    ONE PAGE. A label that breaks prints half an address on a sheet nobody
    sticks to the rack. Re-render all four kinds after ANY change here and
    count the pages.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 6pt; }

        body {
            margin: 0;
            padding: 0;
            font-family: DejaVu Sans, sans-serif;
            color: #000;
            /* The frame is the body's border, not a wrapper table: wrapping
               the sheet in a table cell would put every block one level
               deeper, and deep nesting is what dompdf measures badly. */
            border: 3pt solid #000;
            border-radius: 10pt;
        }

        table { width: 100%; border-collapse: collapse; }
        td { vertical-align: top; }

        /* ── Header ── */
        .head td {
            padding: 16pt 22pt 14pt;
            border-bottom: 2pt solid #000;
        }

        .head .kind {
            font-size: 30pt;
            font-weight: bold;
            letter-spacing: 2pt;
            line-height: 1.05;
        }

        .head .flagcell {
            text-align: right;
            /* Capped, or three flags push the kind onto a second line. */
            width: 46%;
            vertical-align: middle;
        }

        .flag {
            display: inline-block;
            background: #000;
            color: #fff;
            font-size: 11pt;
            font-weight: bold;
            letter-spacing: 1pt;
            line-height: 1;
            padding: 7pt 11pt;
            margin-left: 5pt;
        }

        .flag--none {
            background: #fff;
            color: #000;
            border: 1.5pt solid #000;
        }

        /* ── QR ── */
        .qrrow td {
            text-align: center;
            padding: 30pt 22pt 0;
        }

        .qr { width: 510pt; height: 510pt; }

        .fallback {
            font-size: 16pt;
            font-weight: bold;
            color: #000;
            padding: 150pt 0;
        }

        /* ── Code ── */
        .coderow td {
            text-align: center;
            padding: 18pt 22pt 0;
            font-size: 42pt;
            font-weight: bold;
            letter-spacing: 3pt;
            line-height: 1.05;
        }

        /* ── Path ── */
        .pathrow {
            margin-top: 22pt;
        }

        .pathrow td {
            padding: 16pt 6pt 18pt;
            text-align: center;
            border-top: 2pt solid #000;
        }

        .pathrow .pk {
            font-size: 10pt;
            font-weight: bold;
            letter-spacing: 1.1pt;
            color: #3a3a3a;
            line-height: 1.05;
        }

        .pathrow .pv {
            font-size: 19pt;
            font-weight: bold;
            line-height: 1.1;
            padding-top: 5pt;
        }
    </style>
</head>
<body>

{{-- ── Header: what this is, and how it must be handled ── --}}
<table class="head">
    <tr>
        <td class="kind">{{ $kind }}</td>
        <td class="flagcell">
            @forelse ($flags as $f)
                <span class="flag">{{ is_array($f) ? ($f['label'] ?? $f['text'] ?? '') : $f }}</span>
            @empty
                <span class="flag flag--none">NORMAL</span>
            @endforelse
        </td>
    </tr>
</table>

{{-- ── The code itself ── --}}
<table class="qrrow">
    <tr>
        <td>
            @if ($qr)
                <img class="qr" src="{{ $qr }}" alt="{{ $code }}">
            @else
                {{-- The QR could not be built; the code alone still identifies it. --}}
                <div class="fallback">QR UNAVAILABLE</div>
            @endif
        </td>
    </tr>
</table>

<table class="coderow">
    <tr><td>{{ $code }}</td></tr>
</table>

{{-- ── The full address, one column per level ── --}}
@php
    /* Older callers pass no path. Rather than print an empty strip, the
       label simply leaves it off — which is what it showed before. */
    $pathCells = collect($path ?? [])->filter(fn ($p) => filled($p['code'] ?? null))->values();
@endphp
@if ($pathCells->isNotEmpty())
    <table class="pathrow">
        <tr>
            @foreach ($pathCells as $p)
                <td width="{{ (int) floor(100 / $pathCells->count()) }}%">
                    <div class="pk">{{ $p['label'] }}</div>
                    <div class="pv">{{ $p['code'] }}</div>
                </td>
            @endforeach
        </tr>
    </table>
@endif

</body>
</html>
