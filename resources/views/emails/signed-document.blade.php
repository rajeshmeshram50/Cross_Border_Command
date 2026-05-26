<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{{ $documentTitle }} &mdash; Signed</title>
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
  Your signed document {{ $documentTitle }} is attached.
</div>

{{-- ============ WRAPPER ============ --}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

{{-- ============ CONTAINER ============ --}}
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- ============ HEADER (stacked wordmark of CUSTOMER org) ============ --}}
  @php($_parts = explode(' ', $orgName, 2))
  @php($brandMain = strtoupper($_parts[0] ?? $orgName))
  @php($brandSub = strtoupper(trim($_parts[1] ?? '')))
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #a78bfa;">
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>
    @if($brandSub !== '')
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:10px;">
    <tr>
      <td style="width:34px;height:4px;background-color:#7c3aed;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 14px;font-size:10.5px;font-weight:700;color:#6d28d9;letter-spacing:3px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
      <td style="width:34px;height:4px;background-color:#7c3aed;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
    </table>
    @endif
  </td></tr>

  {{-- ============ HERO ICON (document + pen illustration) ============ --}}
  <tr><td style="padding:18px 32px 0;text-align:center;">
    <img src="{{ asset('images/email-icons/signed-document-icon.png') }}" alt="" width="160" height="auto"
         style="display:inline-block;border:0;outline:none;max-width:160px;height:auto;" />
  </td></tr>

  {{-- ============ HEADLINE ============ --}}
  <tr><td style="padding:14px 32px 4px;text-align:center;">
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.4px;line-height:1.2;">Your Signed Document</h1>
  </td></tr>
  <tr><td style="padding:6px 32px 18px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
      All required signatures have been collected &mdash;<br/>the final, fully-signed document is attached.
    </p>
  </td></tr>

  {{-- ============ GREETING (letter-style) ============ --}}
  <tr><td style="padding:0 40px 4px;">
    <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">Hi {{ $recipientName }},</p>
    <p style="margin:10px 0 0;font-size:14px;color:#374151;line-height:1.7;">
      The signing workflow for
      <strong style="color:#7c3aed;font-weight:700;">{{ $documentTitle }}</strong>
      @if($run->code)
        <span style="color:#6b7280;font-weight:500;">(ref. <code style="background:#f5f3ff;color:#6d28d9;padding:1px 6px;border-radius:4px;font-family:'SF Mono','Courier New',monospace;font-size:12px;">{{ $run->code }}</code>)</span>
      @endif
      is complete. The fully-executed copy is attached to this email for your records.
    </p>
  </td></tr>

  {{-- ============ SIGNERS LIST ============ --}}
  @php($signers = is_array($run->signers ?? null) ? $run->signers : [])
  @if(!empty($signers))
  <tr><td style="padding:18px 40px 4px;">
    <div style="font-size:10.5px;font-weight:800;color:#7c3aed;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:10px;">Signed By</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafafa;border:1px solid #f3f4f6;border-radius:12px;overflow:hidden;">
      @foreach($signers as $i => $s)
        @php($signerName = $s['name'] ?? ($s['role_name'] ?? 'Signer'))
        @php($signerRole = $s['role_name'] ?? null)
        @php($action = $s['action'] ?? 'Sign')
        @php($done = ($s['status'] ?? '') === 'Done')
        @php($actedAt = !empty($s['acted_at']) ? \Carbon\Carbon::parse($s['acted_at'])->format('d M Y') : null)
        <tr>
          <td style="width:38px;padding:14px 0 14px 18px;vertical-align:middle;@if($i < count($signers) - 1)border-bottom:1px solid #f3f4f6;@endif">
            @if($done)
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="width:24px;height:24px;background-color:#dcfce7;border-radius:50%;text-align:center;vertical-align:middle;line-height:24px;">
                  <span style="color:#16a34a;font-size:13px;font-weight:800;line-height:24px;">&#10003;</span>
                </td>
              </tr></table>
            @else
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="width:24px;height:24px;background-color:#f3f4f6;border-radius:50%;text-align:center;vertical-align:middle;line-height:24px;">
                  <span style="color:#9ca3af;font-size:11px;font-weight:700;line-height:24px;">&middot;</span>
                </td>
              </tr></table>
            @endif
          </td>
          <td style="padding:14px 12px;vertical-align:middle;@if($i < count($signers) - 1)border-bottom:1px solid #f3f4f6;@endif">
            <div style="font-size:13.5px;font-weight:700;color:#111827;letter-spacing:-0.1px;">{{ $signerName }}</div>
            @if($signerRole && $signerRole !== $signerName)
            <div style="font-size:11.5px;color:#6b7280;margin-top:2px;">{{ $signerRole }} &middot; {{ $action }}</div>
            @else
            <div style="font-size:11.5px;color:#6b7280;margin-top:2px;">{{ $action }}</div>
            @endif
          </td>
          <td align="right" style="padding:14px 18px 14px 12px;vertical-align:middle;@if($i < count($signers) - 1)border-bottom:1px solid #f3f4f6;@endif">
            @if($done && $actedAt)
              <span style="display:inline-block;background-color:#ecfdf5;color:#15803d;font-size:11px;font-weight:700;padding:4px 10px;border-radius:10px;letter-spacing:0.2px;">
                &#10003; {{ $actedAt }}
              </span>
            @elseif($done)
              <span style="font-size:11.5px;font-weight:700;color:#15803d;">Completed</span>
            @else
              <span style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Pending</span>
            @endif
          </td>
        </tr>
      @endforeach
    </table>
  </td></tr>
  @endif

  {{-- ============ ATTACHMENT NOTICE ============ --}}
  <tr><td style="padding:18px 40px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;">
    <tr><td style="padding:12px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle">
          <img src="{{ asset('images/email-icons/paperclip.png') }}" alt="" width="14" height="14"
               style="display:inline-block;border:0;outline:none;vertical-align:middle;" />
        </td>
        <td valign="middle" style="padding-left:10px;font-size:12.5px;color:#5b21b6;line-height:1.5;">
          The signed document is attached as <strong style="color:#4c1d95;font-weight:700;">{{ $documentTitle }}.docx</strong>
        </td>
      </tr></table>
    </td></tr>
    </table>
  </td></tr>

  {{-- ============ SIGN-OFF + FOOTER ============ --}}
  <tr><td style="padding:14px 40px 0;">
    <p style="margin:0;font-size:13.5px;color:#374151;line-height:1.6;">
      Please retain this copy for your records. If you have any questions, reply to this email and our team will be happy to help.
    </p>
    <p style="margin:14px 0 0;font-size:13.5px;color:#374151;line-height:1.6;">
      Best regards,<br/>
      <strong style="color:#111827;font-weight:700;">&mdash; The HR Team</strong>
    </p>
  </td></tr>

  <tr><td style="padding:22px 32px 20px;text-align:center;border-top:1px solid #f3f4f6;margin-top:18px;">
    <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      &copy; {{ date('Y') }} <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong>. All rights reserved.
    </p>
  </td></tr>

</table>
{{-- /Container --}}

</td></tr>
</table>
{{-- /Wrapper --}}

</body>
</html>
