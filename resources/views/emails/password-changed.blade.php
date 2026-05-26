@php
  // Branding — currently fixed to the platform (super-admin → client admin flow).
  // To support client-org branding (client → branch / employee), pass these
  // through the PasswordChangedMail constructor and remove the defaults below.
  $brandName    = $brandName    ?? 'Inorbvict Group Of Companies';
  $brandShort   = $brandShort   ?? 'INORBVICT';
  $brandTagline = $brandTagline ?? 'GROUP OF COMPANIES';
  $logoUrl      = $logoUrl      ?? asset('images/igc-logo.png');
  $supportEmail = $supportEmail ?? 'support@crossbordercommand.com';
  $websiteUrl   = $websiteUrl   ?? 'https://www.crossbordercommand.com';
  $facebookUrl  = $facebookUrl  ?? '#';
  $linkedinUrl  = $linkedinUrl  ?? '#';
  $twitterUrl   = $twitterUrl   ?? '#';
  $youtubeUrl   = $youtubeUrl   ?? '#';
@endphp
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Password Changed Successfully — {{ $brandName }}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#eef2f8;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#1f2937;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f8;padding:32px 16px;">
<tr><td align="center">

<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(16,185,129,0.10);">

  <!-- BRAND HEADER: wordmark only, centered -->
  <tr>
    <td style="padding:24px 28px 22px;background-color:#ffffff;text-align:center;border-bottom:2px solid #10b981;">
      <p style="margin:0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:800;color:#0b1530;letter-spacing:3px;line-height:1.1;">
        {{ $brandShort }}
      </p>
      @if(!empty($brandTagline))
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;"><tr>
        <td style="width:28px;height:1px;background-color:#10b981;font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:0 10px;font-size:10px;font-weight:700;color:#10b981;letter-spacing:5px;line-height:1;white-space:nowrap;">{{ $brandTagline }}</td>
        <td style="width:28px;height:1px;background-color:#10b981;font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>
      @endif
    </td>
  </tr>

  <!-- HERO BANNER: SVG (inline-embedded when sending; URL when previewing) -->
  <tr>
    <td style="padding:0;background-color:#ffffff;text-align:center;">
      @php
        // SVG hero — inline embed when sending so Apple Mail / iOS / Thunderbird
        // render it crisp; fall back to asset URL for standalone preview.
        // (Gmail / Outlook desktop may strip SVG content — those recipients
        // will see no banner.)
        $heroPath = public_path('images/email-icons/password-changed-banner.svg');
        $heroSrc  = (isset($message) && file_exists($heroPath))
            ? $message->embed($heroPath)
            : asset('images/email-icons/password-changed-banner.svg');
      @endphp
      <img src="{{ $heroSrc }}" alt="Password updated" width="480"
           style="display:block;width:100%;max-width:480px;height:auto;border:0;outline:none;text-decoration:none;" />
    </td>
  </tr>

  <!-- Title -->
  <tr>
    <td style="padding:30px 32px 4px;text-align:center;">
      <h1 style="margin:0;font-size:26px;font-weight:800;color:#0b1530;letter-spacing:-0.3px;line-height:1.2;">
        Password Changed Successfully
      </h1>
    </td>
  </tr>

  <!-- Subtitle -->
  <tr>
    <td style="padding:8px 32px 0;text-align:center;">
      <p style="margin:0;font-size:10px;font-weight:800;color:#10b981;letter-spacing:2.5px;line-height:1.4;">
        SECURITY CONFIRMATION
      </p>
    </td>
  </tr>

  <!-- Greeting + intro -->
  <tr>
    <td style="padding:24px 32px 18px;">
      <p style="margin:0 0 12px;font-size:14px;color:#10b981;font-weight:700;">Hello,</p>
      <p style="margin:0 0 10px;font-size:13px;color:#4b5563;line-height:1.7;">
        Great! Your password has been successfully updated for your
        <span style="color:#0b1530;font-weight:600;">{{ $brandName }}</span> account.
      </p>
      <p style="margin:0;font-size:13px;color:#4b5563;line-height:1.7;">
        If you made this change, you can safely ignore this email.
      </p>
    </td>
  </tr>

  <!-- Account details card (3 rows) -->
  <tr>
    <td style="padding:0 32px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e5edf8;border-radius:12px;">
        <!-- Row 1: Account Email -->
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5fb;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
              <td style="width:34px;vertical-align:middle;">
                <div style="width:30px;height:30px;background-color:#ecfdf5;border-radius:50%;text-align:center;line-height:30px;color:#10b981;font-size:14px;">&#128100;</div>
              </td>
              <td style="padding-left:12px;vertical-align:middle;">
                <p style="margin:0;font-size:9px;font-weight:800;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;line-height:1;">Account Email</p>
                <p style="margin:4px 0 0;font-size:13px;color:#0b1530;font-weight:600;font-family:'Courier New',monospace;line-height:1.2;">{{ $userEmail }}</p>
              </td>
            </tr></table>
          </td>
        </tr>
        <!-- Row 2: Status -->
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5fb;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
              <td style="width:34px;vertical-align:middle;">
                <div style="width:30px;height:30px;background-color:#ecfdf5;border-radius:50%;text-align:center;line-height:30px;color:#10b981;font-size:14px;font-weight:800;">&#10003;</div>
              </td>
              <td style="padding-left:12px;vertical-align:middle;">
                <p style="margin:0;font-size:9px;font-weight:800;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;line-height:1;">Status</p>
                <p style="margin:4px 0 0;font-size:13px;color:#0b1530;font-weight:600;line-height:1.2;">Password Updated</p>
              </td>
            </tr></table>
          </td>
        </tr>
        <!-- Row 3: Changed At -->
        <tr>
          <td style="padding:12px 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
              <td style="width:34px;vertical-align:middle;">
                <div style="width:30px;height:30px;background-color:#ecfdf5;border-radius:50%;text-align:center;line-height:30px;color:#10b981;font-size:14px;">&#128197;</div>
              </td>
              <td style="padding-left:12px;vertical-align:middle;">
                <p style="margin:0;font-size:9px;font-weight:800;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;line-height:1;">Changed At</p>
                <p style="margin:4px 0 0;font-size:13px;color:#0b1530;font-weight:600;font-family:'Courier New',monospace;line-height:1.2;">{{ $changedAt }}</p>
              </td>
            </tr></table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- "Didn't request this?" info card -->
  <tr>
    <td style="padding:0 32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ecfdf5;border-radius:12px;">
        <tr><td style="padding:14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:38px;vertical-align:top;">
              <div style="width:32px;height:32px;background-color:#ffffff;border:1.5px solid #bbf0d6;border-radius:50%;text-align:center;line-height:32px;color:#10b981;font-size:16px;font-weight:800;font-family:Georgia,serif;">?</div>
            </td>
            <td style="padding-left:12px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#047857;">Didn't request this?</p>
              <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.55;">
                If you didn't change your password, please contact our
                <a href="mailto:{{ $supportEmail }}" style="color:#047857;text-decoration:none;font-weight:600;">support team</a>
                right away.
              </p>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- "Protect your account" warning card -->
  <tr>
    <td style="padding:0 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fdecec;border-radius:12px;">
        <tr><td style="padding:14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:38px;vertical-align:top;">
              <div style="width:32px;height:32px;background-color:#ffffff;border:1.5px solid #f5c4c4;border-radius:50%;text-align:center;line-height:32px;color:#dc2626;font-size:16px;font-weight:800;">&#9888;</div>
            </td>
            <td style="padding-left:12px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#b91c1c;">Protect your account</p>
              <p style="margin:0;font-size:12px;color:#7a3030;line-height:1.55;">
                Never share your password or OTP with anyone. {{ $brandName }} will never ask for your credentials.
              </p>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- Sign-off -->
  <tr>
    <td style="padding:0 32px 18px;text-align:center;">
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
        Thank you,<br/>
        <span style="color:#10b981;font-weight:800;font-size:14px;">{{ $brandName }} Team</span>
      </p>
    </td>
  </tr>

  <!-- Social icons (brand colors) -->
  <tr>
    <td style="padding:0 32px 14px;text-align:center;">
      <a href="{{ $facebookUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#1877f2;color:#ffffff;font-weight:800;font-size:13px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">f</span>
      </a>
      <a href="{{ $linkedinUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#0a66c2;color:#ffffff;font-weight:800;font-size:11px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">in</span>
      </a>
      <a href="{{ $twitterUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#1da1f2;color:#ffffff;font-weight:800;font-size:12px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">&#120143;</span>
      </a>
      <a href="{{ $youtubeUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#ff0000;color:#ffffff;font-weight:800;font-size:11px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">&#9654;</span>
      </a>
    </td>
  </tr>

  <!-- Copyright -->
  <tr>
    <td style="padding:0 32px 22px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        &copy; {{ date('Y') }} {{ $brandName }}. All rights reserved.
      </p>
    </td>
  </tr>

</table>

</td></tr>
</table>

</body>
</html>
