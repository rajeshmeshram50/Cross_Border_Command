<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>Welcome — Your Login Credentials</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background-color:#020b18;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<!-- Wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#020b18;padding:40px 16px;">
<tr><td align="center">

<!-- Card -->
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background-color:#0a1628;border-radius:24px;overflow:hidden;border:1px solid rgba(0,212,255,0.15);box-shadow:0 30px 80px rgba(0,0,0,0.5);">

  <!-- Top Strip -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#00d4ff,#0ea5e9,#6366f1,#2dd4bf,#00d4ff);background-size:200%;"></td></tr>

  <!-- Hero Section -->
  <tr><td style="background:linear-gradient(170deg,#020d1f 0%,#071a33 60%,#0a1e38 100%);padding:50px 40px 40px;text-align:center;">

    <!-- Status Pill -->
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-bottom:24px;">
    <tr><td style="background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.25);border-radius:30px;padding:7px 18px 7px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:10px;height:10px;background:#00d4ff;border-radius:50%;box-shadow:0 0 10px #00d4ff;"></td>
        <td style="padding-left:10px;font-size:10px;font-weight:800;color:#7dd3fc;letter-spacing:2px;text-transform:uppercase;">ACCOUNT ACTIVATED</td>
      </tr></table>
    </td></tr>
    </table>

    <!-- Icon -->
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-bottom:24px;">
    <tr><td style="width:80px;height:80px;background:linear-gradient(135deg,#0ea5e9,#00d4ff,#2dd4bf);border-radius:22px;text-align:center;vertical-align:middle;font-size:36px;box-shadow:0 14px 40px rgba(0,212,255,0.4);">
      &#128273;
    </td></tr>
    </table>

    <!-- Title -->
    <h1 style="font-size:28px;font-weight:800;color:#f0f9ff;letter-spacing:-0.5px;margin:0 0 10px;">Welcome — You're In! &#127881;</h1>
    <p style="font-size:14px;color:#7fb3d3;line-height:1.8;margin:0;">
      Your <strong style="color:#00d4ff;">{{ $appName }}</strong> account is live &amp; ready.<br/>
      Your login credentials are below — keep them safe.
    </p>

  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:30px 40px 10px;background-color:#0a1628;">
    <p style="font-size:14px;color:#7fb3d3;line-height:1.8;margin:0;">
      Hey <strong style="color:#f0f9ff;">{{ $userName }}</strong> &#x1F44B;,<br/>
      You have been added to <strong style="color:#f0f9ff;">{{ $orgName }}</strong> on <strong style="color:#00d4ff;">{{ $appName }}</strong>.
      Use the credentials below to sign in.
    </p>

    <!-- Role Badge -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
    <tr><td style="background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.22);border-radius:20px;padding:5px 16px;font-size:11px;font-weight:700;color:#7dd3fc;letter-spacing:0.5px;">
      {{ str_replace('_', ' ', ucwords($userType, '_')) }}
    </td></tr>
    </table>
  </td></tr>

  <!-- Credentials Box -->
  <tr><td style="padding:20px 40px 30px;background-color:#0a1628;">

    <!-- Outer gradient border -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;background:linear-gradient(135deg,#00d4ff,#0ea5e9,#6366f1,#2dd4bf);padding:2px;">
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#030a14;border-radius:14px;overflow:hidden;">

        <!-- Email Row -->
        <tr><td style="padding:22px 26px;border-bottom:1px solid rgba(14,165,233,0.12);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;">
              <p style="font-size:10px;font-weight:800;color:#38bdf8;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 8px;">&#128100; &nbsp;EMAIL / USERNAME</p>
              <p style="font-family:'Courier New',monospace;font-size:16px;font-weight:500;color:#f0f9ff;letter-spacing:0.3px;margin:0;">{{ $userEmail }}</p>
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="display:inline-block;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.28);border-radius:20px;padding:5px 14px;font-size:11px;font-weight:700;color:#38bdf8;">
                &#x2713; Verified
              </span>
            </td>
          </tr></table>
        </td></tr>

        <!-- Password Row -->
        <tr><td style="padding:22px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;">
              <p style="font-size:10px;font-weight:800;color:#2dd4bf;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 8px;">&#128274; &nbsp;PASSWORD</p>
              <p style="font-family:'Courier New',monospace;font-size:16px;font-weight:500;color:#f0f9ff;letter-spacing:3px;margin:0;">{{ $password }}</p>
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="display:inline-block;background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.28);border-radius:20px;padding:5px 14px;font-size:11px;font-weight:700;color:#2dd4bf;">
                &#x23F3; Temporary
              </span>
            </td>
          </tr></table>
        </td></tr>

      </table>
    </td></tr>
    </table>

  </td></tr>

  <!-- CTA Button -->
  <tr><td style="padding:0 40px 35px;text-align:center;background-color:#0a1628;">
    <table role="presentation" cellpadding="0" cellspacing="0" align="center">
    <tr><td style="background:linear-gradient(135deg,#0284c7,#0ea5e9,#00d4ff);border-radius:50px;box-shadow:0 8px 30px rgba(14,165,233,0.45);">
      <a href="{{ $loginUrl }}" style="display:inline-block;padding:16px 52px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
        Sign In to Your Account &nbsp;&#8594;
      </a>
    </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:#475569;">
      Or open: <a href="{{ $loginUrl }}" style="color:#38bdf8;text-decoration:none;">{{ str_replace(['http://','https://'], '', $loginUrl) }}</a>
    </p>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0 40px;background-color:#0a1628;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(14,165,233,0.2),transparent);"></div></td></tr>

  <!-- Tips -->
  <tr><td style="padding:28px 40px;background-color:#0a1628;">
    <p style="font-size:10px;font-weight:800;color:#475569;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 18px;">GETTING STARTED</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
    <tr>
      <td style="width:34px;vertical-align:top;"><div style="width:30px;height:30px;background:rgba(14,165,233,0.1);border-radius:9px;text-align:center;line-height:30px;font-size:14px;">&#9997;&#65039;</div></td>
      <td style="padding-left:12px;font-size:13px;color:#7fb3d3;line-height:1.65;"><strong style="color:#f0f9ff;">Change your password</strong> immediately on first login — this one is temporary.</td>
    </tr></table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
    <tr>
      <td style="width:34px;vertical-align:top;"><div style="width:30px;height:30px;background:rgba(239,68,68,0.1);border-radius:9px;text-align:center;line-height:30px;font-size:14px;">&#128683;</div></td>
      <td style="padding-left:12px;font-size:13px;color:#7fb3d3;line-height:1.65;"><strong style="color:#f0f9ff;">Never share</strong> your credentials with anyone — not even support staff.</td>
    </tr></table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="width:34px;vertical-align:top;"><div style="width:30px;height:30px;background:rgba(99,102,241,0.1);border-radius:9px;text-align:center;line-height:30px;font-size:14px;">&#128640;</div></td>
      <td style="padding-left:12px;font-size:13px;color:#7fb3d3;line-height:1.65;"><strong style="color:#f0f9ff;">Explore the dashboard</strong> — check your profile and get up and running fast.</td>
    </tr></table>
  </td></tr>

  <!-- Warning -->
  <tr><td style="padding:0 40px 28px;background-color:#0a1628;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);border-radius:14px;padding:16px 18px;">
    <tr>
      <td style="width:30px;vertical-align:top;font-size:18px;">&#9888;&#65039;</td>
      <td style="padding-left:10px;font-size:13px;color:#fde68a;line-height:1.65;">
        <strong style="color:#fbbf24;">Didn't expect this?</strong> If you didn't request this account, please
        <a href="mailto:{{ config('mail.from.address') }}" style="color:#fbbf24;text-decoration:none;font-weight:700;">contact us</a>
        immediately.
      </td>
    </tr></table>
  </td></tr>

  <!-- Help Strip -->
  <tr><td style="background-color:#050d1a;border-top:1px solid rgba(255,255,255,0.04);padding:18px 40px;">
    <p style="font-size:13px;color:#475569;margin:0;">
      Need help? <a href="mailto:{{ config('mail.from.address') }}" style="color:#38bdf8;text-decoration:none;font-weight:700;">{{ config('mail.from.address') }}</a>
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background-color:#020810;padding:26px 40px 22px;text-align:center;border-top:1px solid rgba(255,255,255,0.03);">

    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-bottom:10px;">
    <tr>
      <td style="width:28px;height:28px;background:linear-gradient(135deg,#0ea5e9,#00d4ff,#2dd4bf);border-radius:8px;text-align:center;vertical-align:middle;font-size:14px;">&#9889;</td>
      <td style="padding-left:8px;font-size:15px;font-weight:800;color:#38bdf8;letter-spacing:0.5px;">{{ $appName }}</td>
    </tr></table>

    <p style="font-size:11px;color:#1e3a52;line-height:1.7;margin:0;">
      You received this email because an account was created for you on {{ $appName }}.<br/>
      &copy; {{ date('Y') }} {{ $appName }}. All rights reserved.
    </p>

    <!-- Dots -->
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-top:14px;">
    <tr>
      <td style="width:5px;height:5px;background:#00d4ff;border-radius:50%;"></td>
      <td style="width:7px;"></td>
      <td style="width:5px;height:5px;background:#0ea5e9;border-radius:50%;"></td>
      <td style="width:7px;"></td>
      <td style="width:5px;height:5px;background:#6366f1;border-radius:50%;"></td>
      <td style="width:7px;"></td>
      <td style="width:5px;height:5px;background:#2dd4bf;border-radius:50%;"></td>
      <td style="width:7px;"></td>
      <td style="width:5px;height:5px;background:#00d4ff;border-radius:50%;"></td>
    </tr></table>

  </td></tr>

  <!-- Bottom Strip -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#00d4ff,#0ea5e9,#6366f1,#2dd4bf,#00d4ff);background-size:200%;"></td></tr>

</table>
<!-- /Card -->

</td></tr>
</table>
<!-- /Wrapper -->

</body>
</html>
