<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Complete your onboarding &mdash; {{ $orgName }}</title>
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
  You&rsquo;re invited to join {{ $orgName }} &mdash; complete your onboarding form
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

  {{-- ============ HERO (rocket illustration) ============ --}}
  <tr><td style="padding:14px 32px 0;text-align:center;">
    <img src="{{ asset('images/email-icons/rocket-launch.png') }}" alt="" width="170" height="auto"
         style="display:inline-block;border:0;outline:none;max-width:170px;height:auto;" />
  </td></tr>

  {{-- ============ HEADLINE ============ --}}
  <tr><td style="padding:6px 32px 2px;text-align:center;">
    <h1 style="margin:0;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.4px;line-height:1.2;">You&rsquo;re invited to join</h1>
    <div style="font-size:22px;font-weight:800;color:#7c3aed;letter-spacing:-0.4px;line-height:1.2;margin-top:4px;">{{ $orgName }}</div>
  </td></tr>

  {{-- ============ GREETING (letter-style: salutation → body → signoff) ============ --}}
  <tr><td style="padding:14px 40px 0;">
    <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">Hi {{ $candidateName }},</p>
    <p style="margin:8px 0 0;font-size:14px;color:#374151;line-height:1.65;">
      Welcome aboard! We&rsquo;re excited to have you join the team at
      <strong style="color:#7c3aed;font-weight:700;">{{ $orgName }}</strong>.
    </p>
    <p style="margin:8px 0 0;font-size:14px;color:#374151;line-height:1.65;">
      Please complete your employee profile using the form below so HR can finalize your onboarding.
    </p>
    <p style="margin:10px 0 0;font-size:14px;color:#374151;line-height:1.6;">
      Looking forward to working with you,<br/>
      <strong style="color:#111827;font-weight:700;">&mdash; The HR Team</strong>
    </p>
  </td></tr>

  {{-- ============ INVITATION SUMMARY CARD ============ --}}
  <tr><td style="padding:0 32px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafafa;border:1px solid #f3f4f6;border-radius:12px;overflow:hidden;">

      {{-- Card title --}}
      <tr><td style="padding:16px 22px 6px;font-size:11px;font-weight:800;color:#7c3aed;letter-spacing:1.6px;text-transform:uppercase;">
        Invitation Summary
      </td></tr>

      {{-- Email row --}}
      <tr><td style="padding:12px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:46px;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:36px;height:36px;background-color:#ede9fe;border-radius:50%;text-align:center;vertical-align:middle;">
                <img src="{{ asset('images/email-icons/mail-purple.png') }}" alt="" width="18" height="18"
                     style="display:inline-block;border:0;vertical-align:middle;"
                     onerror="this.style.display='none'" />
              </td>
            </tr></table>
          </td>
          <td style="padding-left:12px;font-size:13.5px;color:#374151;vertical-align:middle;">
            <strong style="color:#111827;font-weight:700;">Email:</strong> {{ $candidateEmail }}
          </td>
        </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 22px;"><div style="height:1px;background-color:#f3f4f6;font-size:0;line-height:0;">&nbsp;</div></td></tr>

      {{-- Department row --}}
      <tr><td style="padding:12px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:46px;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:36px;height:36px;background-color:#ede9fe;border-radius:50%;text-align:center;vertical-align:middle;">
                <img src="{{ asset('images/email-icons/briefcase.png') }}" alt="" width="18" height="18"
                     style="display:inline-block;border:0;vertical-align:middle;" />
              </td>
            </tr></table>
          </td>
          <td style="padding-left:12px;font-size:13.5px;color:#374151;vertical-align:middle;">
            <strong style="color:#111827;font-weight:700;">Department:</strong> {{ $departmentName }}
          </td>
        </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 22px;"><div style="height:1px;background-color:#f3f4f6;font-size:0;line-height:0;">&nbsp;</div></td></tr>

      {{-- Expected join date row --}}
      <tr><td style="padding:12px 22px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:46px;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:36px;height:36px;background-color:#ede9fe;border-radius:50%;text-align:center;vertical-align:middle;">
                <img src="{{ asset('images/email-icons/calendar-purple.png') }}" alt="" width="18" height="18"
                     style="display:inline-block;border:0;vertical-align:middle;"
                     onerror="this.style.display='none'" />
              </td>
            </tr></table>
          </td>
          <td style="padding-left:12px;font-size:13.5px;color:#374151;vertical-align:middle;">
            <strong style="color:#111827;font-weight:700;">Expected joining date:</strong> {{ $expectedJoinDate }}
          </td>
        </tr>
        </table>
      </td></tr>

    </table>
  </td></tr>

  {{-- ============ CTA ============ --}}
  <tr><td style="padding:6px 32px 8px;text-align:center;">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $onboardingUrl }}" style="height:52px;v-text-anchor:middle;width:300px;" arcsize="22%" stroke="f" fillcolor="#7c3aed">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Complete onboarding form</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background-color:#7c3aed;background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 100%);border-radius:11px;box-shadow:0 6px 18px rgba(124,58,237,0.30);">
      <a href="{{ $onboardingUrl }}" target="_blank" style="display:inline-block;padding:15px 44px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
        Complete onboarding form
      </a>
    </td></tr>
    </table>
    <!--<![endif]-->
  </td></tr>

  {{-- ============ EXPIRY + FALLBACK URL ============ --}}
  <tr><td style="padding:14px 40px 22px;text-align:center;">
    <p style="margin:0 0 8px;font-size:12px;color:#6b7280;line-height:1.5;">
      This link expires in <strong style="color:#7c3aed;font-weight:700;">{{ $expiryDays }} day{{ $expiryDays === 1 ? '' : 's' }}</strong>.
    </p>
    <p style="margin:0 0 6px;font-size:11.5px;color:#9ca3af;">
      If the button doesn&rsquo;t work, use this link instead:
    </p>
    <a href="{{ $onboardingUrl }}" target="_blank" style="font-size:12.5px;color:#7c3aed;text-decoration:underline;font-weight:700;">Complete Onboarding</a>
  </td></tr>

  {{-- ============ FOOTER ============ --}}
  <tr><td style="padding:18px 32px 22px;text-align:center;border-top:1px solid #f3f4f6;">
    <p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af;line-height:1.6;">
      You received this because someone at <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong><br/>
      invited you to onboard. If this wasn&rsquo;t you, ignore this email.
    </p>
  </td></tr>

</table>
{{-- /Container --}}

</td></tr>
</table>
{{-- /Wrapper --}}

</body>
</html>
