<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>Congratulations &mdash; {{ $orgName }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;color:#111827;">

<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  Great news about your application{{ $jobTitle ? ' for ' . $jobTitle : '' }} at {{ $orgName }}.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  @php($_parts = explode(' ', $orgName, 2))
  @php($brandMain = strtoupper($_parts[0] ?? $orgName))
  @php($brandSub = strtoupper(trim($_parts[1] ?? '')))
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #34d399;">
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>
    @if($brandSub !== '')
    <div style="margin-top:8px;font-size:10.5px;font-weight:700;color:#059669;letter-spacing:3px;text-transform:uppercase;">{{ $brandSub }}</div>
    @endif
  </td></tr>

  <tr><td style="padding:30px 32px 10px;text-align:center;">
    <div style="font-size:46px;line-height:1;">&#127881;</div>
    <h1 style="margin:14px 0 0;font-size:24px;font-weight:800;color:#047857;line-height:1.15;">You're Selected!</h1>
    <p style="margin:8px 0 0;font-size:13.5px;color:#6b7280;line-height:1.6;">
      Congratulations on clearing the selection process{{ $jobTitle ? ' for ' . $jobTitle : '' }}.
    </p>
  </td></tr>

  <tr><td style="padding:14px 32px 6px;">
    <p style="margin:0;font-size:14.5px;font-weight:700;color:#111827;">Hi {{ $candidate->name }},</p>
  </td></tr>
  <tr><td style="padding:6px 32px 18px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      We're delighted to let you know that you have been <strong style="color:#047857;">selected</strong>
      @if($jobTitle) for the role of <strong style="color:#111827;">{{ $jobTitle }}</strong> @endif
      at <strong style="color:#059669;">{{ $orgName }}</strong>. Our team will be in touch shortly with the next steps.
    </p>
  </td></tr>

  @if(!empty($notes))
  <tr><td style="padding:0 32px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ecfdf5;border:1px solid #d1fae5;border-radius:12px;">
      <tr><td style="padding:14px 18px;">
        <div style="font-size:10.5px;font-weight:800;color:#047857;letter-spacing:1.4px;text-transform:uppercase;">A note from the team</div>
        <p style="margin:6px 0 0;font-size:13px;color:#374151;line-height:1.6;">{{ $notes }}</p>
      </td></tr>
    </table>
  </td></tr>
  @endif

  <tr><td style="padding:6px 32px 24px;text-align:center;border-top:1px solid #f3f4f6;">
    <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">
      &copy; {{ date('Y') }} <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong>. All rights reserved.
    </p>
  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>
