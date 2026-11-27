@php
    $amount      = $amount      ?? 100;
    $amountWords = $amountWords ?? 'ONE HUNDRED';
    $amountHindi = $amountHindi ?? 'एक सौ रुपये';
    $content     = $content     ?? '';

    $emblemPath = public_path('images/india-emblem.png');
    $emblemSrc  = is_file($emblemPath)
        ? 'data:image/png;base64,' . base64_encode(file_get_contents($emblemPath))
        : null;
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 0; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: 'DejaVu Sans', sans-serif;
            color: #6d1f4b;
            -webkit-print-color-adjust: exact;
        }

        .sp-band {
            width: 100%;
            border-collapse: collapse;
            background: #f3dce9;
            border-bottom: 2px solid #8b2c5c;
        }
        .sp-band td { vertical-align: middle; padding: 6px 10px; }

        .sp-denom { width: 34%; }
        .sp-denom-hi   { font-size: 13px; font-weight: 700; line-height: 1.3; color: #8b2c5c; }
        .sp-denom-rs   { font-size: 20px; font-weight: 800; color: #8b2c5c; }
        .sp-denom-en   { font-size: 12px; font-weight: 700; letter-spacing: .5px; color: #8b2c5c; text-align: right; }
        .sp-denom-rs-r { font-size: 22px; font-weight: 800; color: #8b2c5c; text-align: right; }
        .sp-right { text-align: right; }

        .sp-centre { width: 32%; text-align: center; }
        .sp-title-hi { font-size: 11px; font-weight: 700; color: #8b2c5c; margin-bottom: 2px; white-space: nowrap; }
        .sp-emblem { height: 46px; display: inline-block; }
        .sp-emblem-fallback {
            display: inline-block; width: 44px; height: 46px;
            border: 1px solid #8b2c5c; border-radius: 4px;
            font-size: 8px; color: #8b2c5c; line-height: 46px; text-align: center;
        }

        .sp-subband {
            width: 100%;
            background: #d9b8cd;
            border-top: 1px solid #8b2c5c;
            border-bottom: 2px solid #8b2c5c;
            text-align: center;
            padding: 3px 0;
        }
        .sp-subband-in { font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #5c1b3e; }
        .sp-subband-in .hi { font-weight: 700; }

        .sp-body {
            min-height: 560px;
            padding: 28px 34px;
            font-family: 'DejaVu Sans', 'Helvetica', sans-serif;
            font-size: 12px;
            line-height: 1.6;
            color: #1f2937;
        }
    </style>
</head>
<body>

    <table class="sp-band">
        <tr>
            <td class="sp-denom">
                <div class="sp-denom-hi">भारतीय गैर न्यायिक</div>
                <div class="sp-denom-hi">{{ $amountHindi }}</div>
                <div class="sp-denom-rs">रु. {{ $amount }}</div>
            </td>

            <td class="sp-centre">
                <div class="sp-title-hi">सत्यमेव जयते</div>
                @if($emblemSrc)
                    <img src="{{ $emblemSrc }}" alt="State Emblem of India" class="sp-emblem">
                @else
                    <span class="sp-emblem-fallback">EMBLEM</span>
                @endif
            </td>

            <td class="sp-denom sp-right">
                <div class="sp-denom-en">Rs. {{ $amount }}</div>
                <div class="sp-denom-rs-r">Rs. {{ $amount }}</div>
                <div class="sp-denom-en">{{ strtoupper($amountWords) }} RUPEES</div>
            </td>
        </tr>
    </table>

    <div class="sp-subband">
        <span class="sp-subband-in"><span class="hi">भारत</span> INDIA &nbsp;·&nbsp; INDIA NON JUDICIAL</span>
    </div>

    <div class="sp-body">
        {!! \App\Support\PdfHighlight::fix($content) !!}
    </div>

</body>
</html>
