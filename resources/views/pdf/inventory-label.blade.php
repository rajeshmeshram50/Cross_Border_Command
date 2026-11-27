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
            border: 3pt solid #000;
            border-radius: 10pt;
        }

        table { width: 100%; border-collapse: collapse; }
        td { vertical-align: top; }

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

        .coderow td {
            text-align: center;
            padding: 18pt 22pt 0;
            font-size: 42pt;
            font-weight: bold;
            letter-spacing: 3pt;
            line-height: 1.05;
        }

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

<table class="qrrow">
    <tr>
        <td>
            @if ($qr)
                <img class="qr" src="{{ $qr }}" alt="{{ $code }}">
            @else
                <div class="fallback">QR UNAVAILABLE</div>
            @endif
        </td>
    </tr>
</table>

<table class="coderow">
    <tr><td>{{ $code }}</td></tr>
</table>

@php
    $pathCells = collect($path ?? [])->filter(fn ($p) => filled($p['code'] ?? null))->values();
    if (($kind ?? null) === 'SHELF') {
        $pathCells = $pathCells->reject(fn ($p) => ($p['code'] ?? null) === ($code ?? null))->values();
    }
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
