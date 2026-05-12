<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{{ $announcement->title ?? 'New Announcement' }}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <!-- Top accent -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#0EA5E9,#38BDF8,#7DD3FC);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr>
      <td style="width:40px;height:40px;background:linear-gradient(135deg,#0EA5E9,#38BDF8);border-radius:12px;text-align:center;vertical-align:middle;">
        <span style="font-size:20px;line-height:40px;color:#ffffff;">&#128227;</span>
      </td>
      <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">{{ $appName }}</td>
    </tr>
    </table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:36px 40px 16px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:16px;">
    <tr><td style="width:64px;height:64px;background:linear-gradient(135deg,#E0F2FE,#BAE6FD);border-radius:18px;text-align:center;vertical-align:middle;">
      <span style="font-size:28px;line-height:64px;">&#128231;</span>
    </td></tr>
    </table>
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#1e293b;letter-spacing:-0.4px;">New Announcement</h1>
    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
      A new company-wide announcement has been published.
    </p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:18px 40px 8px;">
    <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">
      Hi <strong style="color:#1e293b;">{{ $recipientName }}</strong>,<br/>
      <strong style="color:#1e293b;">{{ $publisherName }}</strong> has published a new announcement under
      <strong>{{ $orgName }}</strong>. Please review the details below.
    </p>
  </td></tr>

  <!-- Title + description card -->
  <tr><td style="padding:14px 40px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 3px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.4px;text-transform:uppercase;">Title</p>
          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:700;">{{ $announcement->title ?: '—' }}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.4px;text-transform:uppercase;">Details</p>
          <p style="margin:0;font-size:13px;color:#475569;line-height:1.7;white-space:pre-wrap;">{{ $announcement->description ?: '—' }}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  @if($announcement->attachment_path)
  <tr><td style="padding:8px 40px 8px;">
    <p style="margin:0;font-size:12px;color:#64748b;">
      &#128206; An attachment is included with this email: <strong>{{ $announcement->attachment_original_name ?: 'attachment' }}</strong>
    </p>
  </td></tr>
  @endif

  <!-- CTA -->
  <tr><td style="padding:24px 40px 28px;text-align:center;">
    <a href="{{ rtrim(config('app.frontend_url'), '/') }}/hr/broadcast" style="display:inline-block;background:linear-gradient(135deg,#0EA5E9,#38BDF8);color:#ffffff;font-size:14px;font-weight:700;padding:11px 26px;border-radius:10px;text-decoration:none;letter-spacing:0.2px;">Go to Announcement Center</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background-color:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #f0f0f5;">
    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6;">
      You received this because you're a recipient of announcements at {{ $orgName }}.
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;">
      &copy; {{ date('Y') }} {{ $appName }}. All rights reserved.
    </p>
  </td></tr>

  <tr><td style="height:4px;background:linear-gradient(90deg,#0EA5E9,#38BDF8,#7DD3FC);font-size:0;line-height:0;">&nbsp;</td></tr>

</table>
</td></tr>
</table>

</body>
</html>
