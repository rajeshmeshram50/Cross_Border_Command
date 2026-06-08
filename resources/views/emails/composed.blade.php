<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>{{ $subjectLine ?: 'Message' }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#111827;">

{{-- Preheader --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  {{ $subjectLine ?: 'A new message' }}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- Header — sending org wordmark --}}
  @php($_parts = explode(' ', $orgName, 2))
  @php($brandMain = strtoupper($_parts[0] ?? $orgName))
  @php($brandSub  = strtoupper(trim($_parts[1] ?? '')))
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #f7b84b;">
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>
    @if($brandSub !== '')
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:10px;">
    <tr>
      <td style="width:34px;height:4px;background-color:#f59e0b;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 14px;font-size:10.5px;font-weight:700;color:#b45309;letter-spacing:3px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
      <td style="width:34px;height:4px;background-color:#f59e0b;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
    </table>
    @endif
  </td></tr>

  {{-- Subject --}}
  <tr><td style="padding:22px 32px 4px;">
    <h1 style="margin:0;font-size:20px;font-weight:800;color:#111827;letter-spacing:-0.3px;line-height:1.3;">{{ $subjectLine ?: 'Message' }}</h1>
  </td></tr>

  {{-- Greeting --}}
  <tr><td style="padding:10px 32px 0;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      Hi <span style="color:#b45309;font-weight:700;">{{ $recipientName }}</span>,
    </p>
  </td></tr>

  {{-- Body (user-composed) --}}
  <tr><td style="padding:14px 32px 18px;">
    <div style="font-size:14px;color:#374151;line-height:1.75;">
      {!! $bodyHtml !!}
    </div>
  </td></tr>

  {{-- Footer --}}
  <tr><td style="padding:14px 32px 22px;text-align:center;border-top:1px solid #f3f4f6;">
    @if($senderName)
    <p style="margin:12px 0 6px;font-size:12px;color:#6b7280;line-height:1.6;">
      Sent by <strong style="color:#111827;font-weight:700;">{{ $senderName }}</strong>
      @if($orgName) at <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong>@endif
    </p>
    @endif
    <p style="margin:6px 0 0;font-size:10.5px;color:#9ca3af;line-height:1.5;">
      &copy; {{ date('Y') }} {{ $appName }}. All rights reserved.
    </p>
  </td></tr>

</table>

</td></tr>
</table>

</body>
</html>
