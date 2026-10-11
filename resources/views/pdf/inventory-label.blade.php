{{--
    Inventory location label - 4in x 3in, the stock that fits a rack upright.

    The QR and the code it carries, nothing else. The details (title, parent,
    area, flags) still come back from the /preview endpoint for the on-screen
    modal; they are deliberately not printed here, because the label is scanned,
    not read.

    The code stays under the QR on purpose: a scuffed or torn QR leaves someone
    on the floor holding a carton with no way to say where it belongs. It is the
    QR's own content, not extra data.

    dompdf has no flexbox and no grid, so the centring is a table with a fixed
    height and vertical-align, measured in points because the page is in points.
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
            color: #0f172a;
        }

        table { width: 100%; border-collapse: collapse; }

        /* 216pt is the full 3in page height, so the cell centres on the sheet. */
        .sheet td {
            height: 216pt;
            text-align: center;
            vertical-align: middle;
        }

        .qr { width: 150pt; height: 150pt; }

        .code {
            font-size: 15pt;
            font-weight: bold;
            letter-spacing: 1.2pt;
            padding-top: 6pt;
        }

        .fallback {
            font-size: 9pt;
            color: #b91c1c;
            padding-top: 4pt;
        }
    </style>
</head>
<body>
<table class="sheet">
    <tr>
        <td>
            @if ($qr)
                <img class="qr" src="{{ $qr }}" alt="{{ $code }}">
            @else
                {{-- The QR could not be built; the code alone still identifies it. --}}
                <div class="fallback">QR unavailable</div>
            @endif
            <div class="code">{{ $code }}</div>
        </td>
    </tr>
</table>
</body>
</html>
