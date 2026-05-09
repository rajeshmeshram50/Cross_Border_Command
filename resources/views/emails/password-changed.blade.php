<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Password Changed Successfully</title>
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

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <!-- Top accent (success green) -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#059669,#10B981,#34D399);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr>
      <td style="width:40px;height:40px;background:linear-gradient(135deg,#059669,#10B981);border-radius:12px;text-align:center;vertical-align:middle;">
        <span style="font-size:20px;line-height:40px;color:#ffffff;">&#9889;</span>
      </td>
      <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">{{ $appName }}</td>
    </tr>
    </table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:40px 40px 24px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:20px;">
    <tr><td style="width:72px;height:72px;background:linear-gradient(135deg,#D1FAE5,#A7F3D0);border-radius:20px;text-align:center;vertical-align:middle;">
      <span style="font-size:32px;line-height:72px;color:#059669;">&#10004;</span>
    </td></tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">Password Changed Successfully</h1>
    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
      Your account password has been updated.
    </p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:0 40px 24px;">
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;">
      Hi <strong style="color:#1e293b;">{{ $userName }}</strong>,<br/>
      The password for your <strong>{{ $appName }}</strong> account was just changed via the Forgot Password flow. Your new sign-in credentials are below.
    </p>
  </td></tr>

  <!-- Credentials Card -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Account Email</p>
          <p style="margin:0;font-size:14px;color:#1e293b;font-family:'Courier New',monospace;font-weight:600;">{{ $userEmail }}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">New Password</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#059669;font-family:'Courier New',monospace;letter-spacing:1px;">{{ $newPassword }}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Changed At</p>
          <p style="margin:0;font-size:13px;color:#475569;font-family:'Courier New',monospace;">{{ $changedAt }}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 40px 28px;text-align:center;">
    <a href="{{ $loginUrl }}" style="display:inline-block;background:linear-gradient(135deg,#059669,#10B981);color:#ffffff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">Sign In Now</a>
  </td></tr>

  <!-- Security Warning -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border:1px solid #FECACA;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:24px;vertical-align:top;font-size:16px;">&#128680;</td>
        <td style="padding-left:10px;">
          <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.6;">
            <strong>Didn't change your password?</strong> Someone may have access to your account.
            <a href="mailto:{{ config('mail.from.address') }}" style="color:#DC2626;font-weight:700;text-decoration:none;">Contact support</a>
            immediately and reset your password again.
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
      <td style="width:32px;height:32px;background:linear-gradient(135deg,#059669,#10B981);border-radius:8px;text-align:center;vertical-align:middle;">
        <span style="font-size:16px;line-height:32px;color:#ffffff;">&#9889;</span>
      </td>
      <td style="padding-left:8px;font-size:14px;font-weight:700;color:#1e293b;">{{ $appName }}</td>
    </tr>
    </table>

    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6;">
      Need help? <a href="mailto:{{ config('mail.from.address') }}" style="color:#059669;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;line-height:1.6;">
      You received this because your account password was changed.<br/>
      &copy; {{ date('Y') }} {{ $appName }}. All rights reserved.
    </p>
  </td></tr>

  <!-- Bottom accent -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#059669,#10B981,#34D399);font-size:0;line-height:0;">&nbsp;</td></tr>

</table>
</td></tr>
</table>

</body>
</html>
