<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Subscription Renewal &mdash; {{ $serviceName }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
@php
  $vendorName = config('app.vendor_name', 'Inorbvict Group of Companies');
  $urgent = $expired || $daysLeft <= 7;
  if ($expired) {
      $pillText = 'EXPIRED'; $pillBg = '#fef2f2'; $pillFg = '#dc2626';
      $headline = ($serviceName) . ' has expired';
      $lead     = 'This service is past its renewal date. Renew it to avoid an interruption.';
  } elseif ($daysLeft === 0) {
      $pillText = 'EXPIRES TODAY'; $pillBg = '#fef2f2'; $pillFg = '#dc2626';
      $headline = ($serviceName) . ' expires today';
      $lead     = 'Today is the renewal date for this service.';
  } else {
      $pillText = $daysLeft . ' DAYS LEFT'; $pillBg = $urgent ? '#fef2f2' : '#fef3c7'; $pillFg = $urgent ? '#dc2626' : '#b45309';
      $headline = 'Renewal due soon';
      $lead     = 'This subscription is approaching its renewal date.';
  }
@endphp
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#111827;">

{{-- Preheader --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  {{ $headline }} &mdash; {{ $serviceName }} · {{ $expiresOn }}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- Header --}}
  <tr><td style="padding:24px 32px 20px;text-align:center;border-bottom:2px solid #6366f1;background:linear-gradient(135deg,#eef2ff 0%,#ffffff 100%);">
    <div style="font-size:20px;font-weight:800;color:#312e81;letter-spacing:0.5px;">Subscription Reminder</div>
    <div style="margin-top:4px;font-size:11px;font-weight:700;color:#6366f1;letter-spacing:2px;text-transform:uppercase;">{{ $appName }}</div>
  </td></tr>

  {{-- Status pill + headline --}}
  <tr><td style="padding:24px 32px 6px;text-align:center;">
    <span style="display:inline-block;padding:6px 14px;border-radius:999px;background:{{ $pillBg }};color:{{ $pillFg }};font-size:11px;font-weight:800;letter-spacing:1px;">{{ $pillText }}</span>
    <h1 style="margin:14px 0 0;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2;">{{ $headline }}</h1>
    <p style="margin:8px 0 0;font-size:13.5px;color:#475569;line-height:1.55;">Hi {{ $ownerName }}, {{ $lead }}</p>
  </td></tr>

  {{-- Details card --}}
  <tr><td style="padding:20px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eef0f6;border-radius:14px;overflow:hidden;">
      <tr><td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:800;color:#6366f1;letter-spacing:1.4px;text-transform:uppercase;">Service Details</td></tr>
      @php
        $rows = [
          ['Service', $serviceName],
          ['Provider', $provider !== '' ? $provider : '—'],
          ['Renews / expires on', $expiresOn],
          ['Days remaining', $expired ? 'Past due' : ($daysLeft === 0 ? 'Today' : $daysLeft . ' day' . ($daysLeft === 1 ? '' : 's'))],
        ];
        if ($amount) $rows[] = ['Renewal amount', $amount];
      @endphp
      @foreach($rows as $i => $row)
      <tr>
        <td style="padding:13px 20px;font-size:13px;color:#374151;@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">{{ $row[0] }}</td>
        <td align="right" style="padding:13px 20px;font-size:13px;font-weight:700;color:#111827;@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">{{ $row[1] }}</td>
      </tr>
      @endforeach
    </table>
  </td></tr>

  @if($notes !== '')
  {{-- Notes --}}
  <tr><td style="padding:6px 32px 8px;">
    <div style="background:#f8fafc;border:1px solid #eef0f6;border-radius:12px;padding:14px 16px;font-size:12.5px;color:#475569;line-height:1.55;">
      <strong style="color:#334155;">Notes:</strong> {{ $notes }}
    </div>
  </td></tr>
  @endif

  {{-- Action note --}}
  <tr><td style="padding:8px 32px 24px;text-align:center;">
    <p style="margin:0;font-size:12.5px;color:#6b7280;line-height:1.55;">
      Please renew this service with the provider before the date above.
      If it is already renewed or set to auto-renew, you can ignore this email.
    </p>
  </td></tr>

  {{-- Footer --}}
  <tr><td style="padding:20px 32px;text-align:center;background-color:#fafafa;border-top:1px solid #f3f4f6;">
    <div style="font-size:13px;font-weight:800;color:#111827;">{{ $vendorName }}</div>
    <div style="margin-top:6px;font-size:11px;color:#9ca3af;">&copy; {{ date('Y') }} {{ $vendorName }}. Automated reminder &mdash; do not reply.</div>
  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>
