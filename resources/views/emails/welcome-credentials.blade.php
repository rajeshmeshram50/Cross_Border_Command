<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Welcome — Your Login Credentials</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

<!-- Wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<!-- Container -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <!-- Top Accent Bar -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#4F46E5,#7C3AED,#6366F1);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr>
      <td style="width:40px;height:40px;background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:12px;text-align:center;vertical-align:middle;">
        <span style="font-size:20px;line-height:40px;color:#ffffff;">&#9889;</span>
      </td>
      <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">{{ $appName }}</td>
    </tr>
    </table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:40px 40px 24px;text-align:center;">
    <!-- Icon -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:20px;">
    <tr><td style="width:72px;height:72px;background:linear-gradient(135deg,#EEF2FF,#E0E7FF);border-radius:20px;text-align:center;vertical-align:middle;">
      <span style="font-size:32px;line-height:72px;">&#128075;</span>
    </td></tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">Welcome aboard!</h1>
    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
      Your account on <strong style="color:#4F46E5;">{{ $appName }}</strong> is ready.
    </p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:0 40px 24px;">
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;">
      Hi <strong style="color:#1e293b;">{{ $userName }}</strong>,<br/>
      You've been added to <strong style="color:#1e293b;">{{ $orgName }}</strong> as a
      <span style="display:inline-block;background:#EEF2FF;color:#4F46E5;font-size:12px;font-weight:700;padding:2px 10px;border-radius:6px;margin:0 2px;">{{ str_replace('_', ' ', ucwords($userType, '_')) }}</span>.
      Use the credentials below to sign in.
    </p>
  </td></tr>

  <!-- Credentials Card -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <!-- Email -->
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Email / Username</p>
              <p style="margin:0;font-size:16px;font-weight:600;color:#1e293b;font-family:'Courier New',monospace;">{{ $userEmail }}</p>
            </td>
          </tr>
          </table>
        </td>
      </tr>
      <!-- Password -->
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Temporary Password</p>
              <p style="margin:0;font-size:16px;font-weight:600;color:#1e293b;font-family:'Courier New',monospace;letter-spacing:2px;">{{ $password }}</p>
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <span style="display:inline-block;background:#FEF3C7;color:#B45309;font-size:10px;font-weight:700;padding:4px 10px;border-radius:6px;">Temporary</span>
            </td>
          </tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA Button -->
  <tr><td style="padding:0 40px 32px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:10px;">
      <a href="{{ $loginUrl }}" target="_blank" style="display:inline-block;padding:14px 40px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
        Sign In to Your Account &rarr;
      </a>
    </td></tr>
    </table>
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">
      Or visit: <a href="{{ $loginUrl }}" style="color:#4F46E5;text-decoration:none;">{{ str_replace(['http://','https://'], '', $loginUrl) }}</a>
    </p>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0 40px;"><div style="height:1px;background-color:#f0f0f5;"></div></td></tr>

  <!-- Getting Started Tips -->
  <tr><td style="padding:28px 40px;">
    <p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Getting Started</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding-bottom:14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:32px;vertical-align:top;">
              <div style="width:28px;height:28px;background:#EEF2FF;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#128273;</div>
            </td>
            <td style="padding-left:12px;">
              <p style="margin:0;font-size:13px;color:#475569;line-height:1.6;"><strong style="color:#1e293b;">Change your password</strong> on first login — this one is temporary.</p>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:32px;vertical-align:top;">
              <div style="width:28px;height:28px;background:#FEF2F2;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#128274;</div>
            </td>
            <td style="padding-left:12px;">
              <p style="margin:0;font-size:13px;color:#475569;line-height:1.6;"><strong style="color:#1e293b;">Keep credentials private</strong> — never share them with anyone.</p>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:32px;vertical-align:top;">
              <div style="width:28px;height:28px;background:#ECFDF5;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#127919;</div>
            </td>
            <td style="padding-left:12px;">
              <p style="margin:0;font-size:13px;color:#475569;line-height:1.6;"><strong style="color:#1e293b;">Explore the dashboard</strong> — set up your profile and get started.</p>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Security Note -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:24px;vertical-align:top;font-size:16px;">&#9888;&#65039;</td>
        <td style="padding-left:10px;">
          <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
            <strong>Didn't expect this?</strong> If you didn't request this account, please
            <a href="mailto:{{ config('mail.from.address') }}" style="color:#B45309;font-weight:700;text-decoration:none;">contact us</a> immediately.
          </p>
        </td>
      </tr></table>
    </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background-color:#f8fafc;padding:28px 40px;text-align:center;border-top:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:12px;">
    <tr>
      <td style="width:32px;height:32px;background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:8px;text-align:center;vertical-align:middle;">
        <span style="font-size:16px;line-height:32px;color:#ffffff;">&#9889;</span>
      </td>
      <td style="padding-left:8px;font-size:14px;font-weight:700;color:#1e293b;">{{ $appName }}</td>
    </tr>
    </table>

    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6;">
      Need help? <a href="mailto:{{ config('mail.from.address') }}" style="color:#4F46E5;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;line-height:1.6;">
      You received this email because an account was created for you.<br/>
      &copy; {{ date('Y') }} {{ $appName }}. All rights reserved.
    </p>
  </td></tr>

  <!-- Bottom Accent Bar -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#4F46E5,#7C3AED,#6366F1);font-size:0;line-height:0;">&nbsp;</td></tr>

</table>
<!-- /Container -->

</td></tr>
</table>
<!-- /Wrapper -->

</body>
</html>
