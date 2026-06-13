{{--
    Indian Non-Judicial Stamp Paper — visual reproduction for PDF (DomPDF).

    Renders the classic e-stamp / non-judicial stamp-paper HEADER band
    (Ashoka State Emblem, "INDIA NON JUDICIAL", the rupee denomination in
    Hindi + English) over a blank body where agreement / deed text is laid.

    Usage:
        $pdf = Pdf::loadView('pdf.stamp-paper', [
            'amount'      => 100,            // denomination (rupees)
            'amountWords' => 'ONE HUNDRED',  // shown on the right
            'amountHindi' => 'एक सौ रुपये',  // shown on the left (Devanagari)
            'content'     => $agreementHtml, // body HTML (optional)
        ]);

    NOTE on fonts: the Devanagari (Hindi) strings only render if a
    Devanagari-capable font is registered with DomPDF (e.g. Noto Sans
    Devanagari). Without one, DomPDF draws boxes for those glyphs — the
    English labels still render fine. Drop the emblem PNG at
    public/images/india-emblem.png (transparent background) for the crest.
--}}
@php
    $amount      = $amount      ?? 100;
    $amountWords = $amountWords ?? 'ONE HUNDRED';
    $amountHindi = $amountHindi ?? 'एक सौ रुपये';
    $content     = $content     ?? '';

    // Embed the emblem as a data-URI when present so the PDF is self-contained.
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

        /* ── The stamp-paper header band ─────────────────────────────── */
        .sp-band {
            width: 100%;
            border-collapse: collapse;
            background: #f3dce9;                 /* pale pink stamp tint   */
            border-bottom: 2px solid #8b2c5c;
        }
        .sp-band td { vertical-align: middle; padding: 6px 10px; }

        /* Left + right denomination cells. */
        .sp-denom { width: 34%; }
        .sp-denom-hi   { font-size: 13px; font-weight: 700; line-height: 1.3; color: #8b2c5c; }
        .sp-denom-rs   { font-size: 20px; font-weight: 800; color: #8b2c5c; }
        .sp-denom-en   { font-size: 12px; font-weight: 700; letter-spacing: .5px; color: #8b2c5c; text-align: right; }
        .sp-denom-rs-r { font-size: 22px; font-weight: 800; color: #8b2c5c; text-align: right; }
        .sp-right { text-align: right; }

        /* Centre — the State Emblem of India + the top Hindi title. */
        .sp-centre { width: 32%; text-align: center; }
        .sp-title-hi { font-size: 11px; font-weight: 700; color: #8b2c5c; margin-bottom: 2px; white-space: nowrap; }
        .sp-emblem { height: 46px; display: inline-block; }
        .sp-emblem-fallback {
            display: inline-block; width: 44px; height: 46px;
            border: 1px solid #8b2c5c; border-radius: 4px;
            font-size: 8px; color: #8b2c5c; line-height: 46px; text-align: center;
        }

        /* The "INDIA NON JUDICIAL" sub-band under the crest. */
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

        /* ── Blank deed body where the agreement text is placed ──────── */
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

    {{-- ── Top denomination band: Hindi (left) · Emblem (centre) · English (right) ── --}}
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

    {{-- ── INDIA NON JUDICIAL sub-band ── --}}
    <div class="sp-subband">
        <span class="sp-subband-in"><span class="hi">भारत</span> INDIA &nbsp;·&nbsp; INDIA NON JUDICIAL</span>
    </div>

    {{-- ── Deed body ── --}}
    <div class="sp-body">
        {!! $content !!}
    </div>

</body>
</html>
