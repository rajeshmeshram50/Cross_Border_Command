{{--
  Expense Management export — the PDF behind "Export ▸ PDF". (#166)

  The screen used to open a print window and call window.print(), which hands
  the user a print dialog and asks them to pick "Save as PDF" themselves. This
  renders the same table through dompdf so the browser receives a finished file,
  the way every other PDF in the app is produced.

  The controller passes already-formatted strings — this view only escapes and
  lays out. Landscape A4 with a repeating header row, so a long claim list
  carries its column names onto every page.
--}}
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{ $title }}</title>
  <style>
    @page { margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: DejaVu Sans, Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; }
    h1 { font-size: 15px; margin: 0 0 4px; }
    .meta { font-size: 10px; color: #6b7280; margin: 0 0 14px; }
    table { border-collapse: collapse; width: 100%; font-size: 8.5px; }
    th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
    thead th { background: #f3f4f6; font-weight: 700; }
    /* Repeat the header on every page — dompdf honours this on thead. */
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .empty { font-size: 11px; color: #6b7280; padding: 12px 0; }
  </style>
</head>
<body>
  <h1>{{ $title }}</h1>
  <p class="meta">{{ $meta }}</p>

  @if (empty($rows))
    <div class="empty">Nothing to report for this selection.</div>
  @else
    <table>
      <thead>
        <tr>
          @foreach ($headers as $h)
            <th>{{ $h }}</th>
          @endforeach
        </tr>
      </thead>
      <tbody>
        @foreach ($rows as $row)
          <tr>
            @foreach ($row as $cell)
              <td>{{ $cell }}</td>
            @endforeach
          </tr>
        @endforeach
      </tbody>
    </table>
  @endif
</body>
</html>
