<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Password Reset Code</title>
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
      <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">Cross Border Command</td>
    </tr>
    </table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:40px 40px 24px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:20px;">
    <tr><td style="width:72px;height:72px;background:linear-gradient(135deg,#FEF3C7,#FDE68A);border-radius:20px;text-align:center;vertical-align:middle;">
      <span style="font-size:32px;line-height:72px;">&#128274;</span>
    </td></tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">Password Reset Request</h1>
    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
      We received a request to reset your password.
    </p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:0 40px 24px;">
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;">
      Hi <strong style="color:#1e293b;">{{ $userName }}</strong>,<br/>
      Use the verification code below to reset your password. This code is valid for <strong style="color:#B45309;">{{ $expiryMinutes }} minutes</strong>.
    </p>
  </td></tr>

  <!-- OTP Code -->
  <tr><td style="padding:0 40px 28px;text-align:center;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:2px solid #E0E7FF;border-radius:14px;">
    <tr><td style="padding:28px 24px;">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;">Your Verification Code</p>
      <p style="margin:0;font-size:42px;font-weight:800;color:#4F46E5;font-family:'Courier New',monospace;letter-spacing:12px;">{{ $otp }}</p>
    </td></tr>
    </table>
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">
      Enter this code on the verification page to continue.
    </p>
  </td></tr>

  <!-- Expiry Info -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Expires In</p>
              <p style="margin:0;font-size:18px;font-weight:700;color:#1e293b;font-family:'Courier New',monospace;">{{ $expiryMinutes }}:00 <span style="font-size:12px;color:#94a3b8;font-family:'Segoe UI',Arial,sans-serif;font-weight:400;">minutes</span></p>
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <span style="display:inline-block;background:#EEF2FF;color:#4F46E5;font-size:10px;font-weight:700;padding:4px 12px;border-radius:6px;">One-Time Use</span>
            </td>
          </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="50%">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.2px;text-transform:uppercase;">Requested At</p>
              <p style="margin:0;font-size:13px;color:#475569;font-family:'Courier New',monospace;">{{ $requestedAt }}</p>
            </td>
            <td width="50%">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.2px;text-transform:uppercase;">Account Email</p>
              <p style="margin:0;font-size:13px;color:#475569;font-family:'Courier New',monospace;">{{ $userEmail }}</p>
            </td>
          </tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Security Warning -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border:1px solid #FECACA;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:24px;vertical-align:top;font-size:16px;">&#128680;</td>
        <td style="padding-left:10px;">
          <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.6;">
            <strong>Didn't request this?</strong> If you didn't request a password reset, please ignore this email or
            <a href="mailto:{{ config('mail.from.address') }}" style="color:#DC2626;font-weight:700;text-decoration:none;">contact support</a>
            immediately. Your account is safe.
          </p>
        </td>
      </tr></table>
    </td></tr>
    </table>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0 40px;"><div style="height:1px;background-color:#f0f0f5;"></div></td></tr>

  <!-- Password Tips -->
  <tr><td style="padding:28px 40px;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Tips for a Strong Password</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      @foreach([
        'Use at least <strong style="color:#1e293b;">8 characters</strong> with a mix of letters, numbers &amp; symbols.',
        '<strong style="color:#1e293b;">Avoid reusing</strong> old passwords or common words.',
        'Consider using a <strong style="color:#1e293b;">password manager</strong> to stay secure.'
      ] as $tip)
      <tr>
        <td style="padding-bottom:10px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;vertical-align:top;">
              <div style="width:20px;height:20px;background:#ECFDF5;border-radius:50%;text-align:center;line-height:20px;font-size:10px;color:#059669;">&#10003;</div>
            </td>
            <td style="padding-left:10px;">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">{!! $tip !!}</p>
            </td>
          </tr></table>
        </td>
      </tr>
      @endforeach
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background-color:#f8fafc;padding:28px 40px;text-align:center;border-top:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:12px;">
    <tr>
      <td style="width:32px;height:32px;background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:8px;text-align:center;vertical-align:middle;">
        <span style="font-size:16px;line-height:32px;color:#ffffff;">&#9889;</span>
      </td>
      <td style="padding-left:8px;font-size:14px;font-weight:700;color:#1e293b;">Cross Border Command</td>
    </tr>
    </table>

    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6;">
      Need help? <a href="mailto:{{ config('mail.from.address') }}" style="color:#4F46E5;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;line-height:1.6;">
      You received this because a password reset was requested for your account.<br/>
      &copy; {{ date('Y') }} Cross Border Command. All rights reserved.
    </p>
  </td></tr>

  <!-- Bottom Accent Bar -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#4F46E5,#7C3AED,#6366F1);font-size:0;line-height:0;">&nbsp;</td></tr>

</table>
</td></tr>
</table>

</body>
</html>
