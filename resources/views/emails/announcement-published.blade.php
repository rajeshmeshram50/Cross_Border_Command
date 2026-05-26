<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{{ $announcement->title ?: 'New Announcement' }}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#111827;">

{{-- Preheader --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  New announcement: {{ $announcement->title ?: 'A new announcement' }} &mdash; from {{ $publisherName }}
</div>

{{-- ============ WRAPPER ============ --}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

{{-- ============ CONTAINER ============ --}}
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- ============ HEADER (stacked wordmark of CUSTOMER org name) ============ --}}
  {{-- Announcements are FROM the customer's org TO their employees, so the
       brand mark at the top is the recipient's own org (varies per client),
       NOT the platform vendor name (which is reserved for billing emails). --}}
  @php($_parts = explode(' ', $orgName, 2))
  @php($brandMain = strtoupper($_parts[0] ?? $orgName))
  @php($brandSub  = strtoupper(trim($_parts[1] ?? '')))
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #a78bfa;">

    {{-- Big main word --}}
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>

    @if($brandSub !== '')
    {{-- Subtitle: purple bar · REMAINING ORG NAME · purple bar --}}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:10px;">
    <tr>
      <td style="width:34px;height:4px;background-color:#7c3aed;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 14px;font-size:10.5px;font-weight:700;color:#6d28d9;letter-spacing:3px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
      <td style="width:34px;height:4px;background-color:#7c3aed;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
    </table>
    @endif

  </td></tr>

  {{-- ============ HERO (envelope + megaphone illustration) ============ --}}
  <tr><td style="padding:16px 32px 0;text-align:center;">
    <img src="{{ asset('images/email-icons/envelope-open.png') }}" alt="New announcement"
         width="200" height="auto"
         style="display:inline-block;border:0;outline:none;max-width:200px;height:auto;" />
  </td></tr>

  {{-- ============ HEADLINE ============ --}}
  <tr><td style="padding:8px 32px 4px;text-align:center;">
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#111827;letter-spacing:-0.5px;line-height:1.2;">New Announcement</h1>
  </td></tr>

  <tr><td style="padding:6px 32px 16px;text-align:center;">
    <p style="margin:0;font-size:13.5px;color:#6b7280;line-height:1.6;">
      A new company wide announcement<br/>has been published.
    </p>
  </td></tr>

  {{-- ============ GREETING ============ --}}
  <tr><td style="padding:0 32px 10px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      Hi <span style="color:#7c3aed;font-weight:700;">{{ $recipientName }}</span>,
    </p>
    <p style="margin:10px 0 0;font-size:14px;color:#374151;line-height:1.7;">
      <strong style="color:#7c3aed;font-weight:700;">{{ $publisherName }}</strong> has published a new announcement under <strong style="color:#111827;">{{ $orgName }}</strong>. Please review the details below.
    </p>
  </td></tr>

  {{-- ============ TITLE CARD ============ --}}
  <tr><td style="padding:14px 32px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f3ff;border-left:3px solid #7c3aed;border-radius:8px;">
    <tr><td style="padding:14px 18px;">
      <div style="font-size:10.5px;font-weight:800;color:#7c3aed;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:6px;">Title</div>
      <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.4;letter-spacing:-0.2px;">{{ $announcement->title ?: 'Announcement' }}</div>
    </td></tr>
    </table>
  </td></tr>

  {{-- ============ DETAILS CARD ============ --}}
  @if(!empty($announcement->description))
  <tr><td style="padding:0 32px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f3ff;border-left:3px solid #a78bfa;border-radius:8px;">
    <tr><td style="padding:14px 18px;">
      <div style="font-size:10.5px;font-weight:800;color:#7c3aed;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:8px;">Details</div>
      <div style="font-size:13px;color:#374151;line-height:1.7;">
        {!! $announcement->description !!}
      </div>
    </td></tr>
    </table>
  </td></tr>
  @endif

  {{-- ============ ATTACHMENT NOTICE ============ --}}
  @if(!empty($announcement->attachment_path))
  <tr><td style="padding:0 32px 14px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td valign="middle">
        <img src="{{ asset('images/email-icons/paperclip.png') }}" alt="" width="14" height="14"
             style="display:inline-block;border:0;outline:none;vertical-align:middle;" />
      </td>
      <td valign="middle" style="padding-left:8px;font-size:12px;color:#6b7280;line-height:1.5;">
        An attachment is included with this email:
        <strong style="color:#111827;font-weight:700;">{{ $announcement->attachment_original_name ?: basename($announcement->attachment_path) }}</strong>
      </td>
    </tr>
    </table>
  </td></tr>
  @endif

  {{-- ============ POSTED DATE STRIP ============ --}}
  @php($postedAt = $announcement->created_at?->format('d M Y, h:i A'))
  @if($postedAt)
  <tr><td style="padding:4px 32px 18px;text-align:center;">
    <span style="font-size:11px;color:#9ca3af;">Posted</span>
    <span style="font-size:11px;color:#374151;font-weight:600;">&nbsp;{{ $postedAt }}</span>
  </td></tr>
  @endif

  {{-- ============ FOOTER ============ --}}
  <tr><td style="padding:14px 32px 20px;text-align:center;border-top:1px solid #f3f4f6;">
    <p style="margin:12px 0 6px;font-size:11.5px;color:#6b7280;line-height:1.6;">
      You received this because you&rsquo;re a recipient of announcements<br/>at <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong>.
    </p>
    <p style="margin:6px 0 0;font-size:10.5px;color:#9ca3af;line-height:1.5;">
      &copy; {{ date('Y') }} {{ $appName }}. All rights reserved.
    </p>
  </td></tr>

</table>
{{-- /Container --}}

</td></tr>
</table>
{{-- /Wrapper --}}

</body>
</html>
