@php
  // Branding — currently fixed to the platform (super-admin → client admin flow).
  // To support client-org branding (client → branch / employee), pass these
  // through the PasswordResetOtpMail constructor and remove the defaults below.
  $brandName = $brandName ?? 'Inorbvict Group Of Companies';
  $brandShort = $brandShort ?? 'INORBVICT';
  $brandTagline = $brandTagline ?? 'GROUP OF COMPANIES';
  $logoUrl = $logoUrl ?? asset('images/igc-logo.png');
  $supportEmail = $supportEmail ?? 'support@crossbordercommand.com';
  $websiteUrl = $websiteUrl ?? 'https://www.crossbordercommand.com';
  $facebookUrl = $facebookUrl ?? '#';
  $linkedinUrl = $linkedinUrl ?? '#';
  $twitterUrl = $twitterUrl ?? '#';
  $youtubeUrl = $youtubeUrl ?? '#';
  $otpDigits = str_split((string) $otp);
@endphp
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Reset Your Password — {{ $brandName }}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>

<body
  style="margin:0;padding:0;background-color:#eef2f8;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#1f2937;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#eef2f8;padding:32px 16px;">
    <tr>
      <td align="center">

        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"
          style="max-width:480px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(30,58,138,0.10);">

          <!-- BRAND HEADER: wordmark only, centered -->
          <tr>
            <td style="padding:24px 28px 22px;background-color:#ffffff;text-align:center;border-bottom:2px solid #3b82f6;">
              <p style="margin:0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:800;color:#0b1530;letter-spacing:3px;line-height:1.1;">
                {{ $brandShort }}
              </p>
              @if(!empty($brandTagline))
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;"><tr>
                <td style="width:28px;height:1px;background-color:#3b82f6;font-size:0;line-height:0;">&nbsp;</td>
                <td style="padding:0 10px;font-size:10px;font-weight:700;color:#3b82f6;letter-spacing:5px;line-height:1;white-space:nowrap;">{{ $brandTagline }}</td>
                <td style="width:28px;height:1px;background-color:#3b82f6;font-size:0;line-height:0;">&nbsp;</td>
              </tr></table>
              @endif
            </td>
          </tr>

          <!-- HERO BANNER: pre-rendered PNG, embedded inline via $message->embed()
               so it renders inside Gmail / Outlook even when APP_URL is local.
               Source SVG lives at storage/app/email-hero.html — re-rasterize via
               `msedge --headless --window-size=960,300 --screenshot=...` if the
               artwork changes. -->
          <tr>
            <td style="padding:0;background-color:#ffffff;text-align:center;">
              @php
                // SVG hero — inline embed when sending so Apple Mail / iOS /
                // Thunderbird render it crisp; fall back to asset URL for
                // standalone preview. (Gmail / Outlook desktop may strip SVG
                // content — those recipients will see no banner.)
                $heroPath = public_path('images/email-icons/password-otp-banner.svg');
                $heroSrc  = (isset($message) && file_exists($heroPath))
                    ? $message->embed($heroPath)
                    : asset('images/email-icons/password-otp-banner.svg');
              @endphp
              <img src="{{ $heroSrc }}" alt="Password security" width="480"
                   style="display:block;width:100%;max-width:480px;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:30px 32px 4px;text-align:center;">
              <h1 style="margin:0;font-size:28px;font-weight:800;color:#0b1530;letter-spacing:-0.3px;line-height:1.15;">
                Reset Your Password</h1>
            </td>
          </tr>

          <!-- Subtitle (centered, no side rules) -->
          <tr>
            <td style="padding:8px 32px 0;text-align:center;">
              <p style="margin:0;font-size:10px;font-weight:800;color:#3b82f6;letter-spacing:2.5px;line-height:1.4;">
                ONE-TIME PASSWORD VERIFICATION
              </p>
            </td>
          </tr>

          <!-- Small clock icon centered -->
          <tr>
            <td style="padding:14px 32px 0;text-align:center;">
              <span
                style="display:inline-block;width:22px;height:22px;line-height:22px;color:#3b82f6;font-size:16px;">&#9201;</span>
            </td>
          </tr>

          <!-- Greeting + intro -->
          <tr>
            <td style="padding:18px 32px 18px;">
              <p style="margin:0 0 12px;font-size:14px;color:#2563eb;font-weight:700;">Hello,</p>
              <p style="margin:0 0 12px;font-size:13px;color:#4b5563;line-height:1.7;">
                We received a request to reset the password for your <span
                  style="color:#0b1530;font-weight:600;">{{ $brandName }}</span> account.
              </p>
              <p style="margin:0;font-size:13px;color:#4b5563;line-height:1.7;">
                Please use the one-time password below to verify your identity and continue.
              </p>
            </td>
          </tr>

          <!-- OTP card with individual digit boxes -->
          <tr>
            <td style="padding:0 32px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:linear-gradient(180deg,#eef4fc 0%,#dfeafa 100%);border-radius:14px;border:1px solid #dbe5f6;">
                <tr>
                  <td style="padding:18px 14px;text-align:center;">
                    <p style="margin:0 0 14px;font-size:10px;font-weight:800;color:#2563eb;letter-spacing:3px;">YOUR OTP
                      CODE</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        @foreach($otpDigits as $digit)
                          <td style="padding:0 4px;">
                            <div
                              style="width:50px;height:50px;line-height:50px;background-color:#ffffff;border:1.5px solid #cfdcf3;border-radius:10px;text-align:center;font-family:'Segoe UI',Arial,sans-serif;font-size:26px;font-weight:800;color:#1e3a8a;box-shadow:0 2px 6px rgba(30,58,138,0.06);">
                              {{ $digit }}
                            </div>
                          </td>
                        @endforeach
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Validity Notice -->
          <tr>
            <td style="padding:0 32px 16px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#6b7280;">
                <span style="color:#3b82f6;font-size:13px;vertical-align:-1px;">&#9201;</span>
                This OTP will expire in <strong style="color:#2563eb;">{{ $expiryMinutes }} minutes</strong>.
              </p>
            </td>
          </tr>

          <!-- "Didn't request this?" info card (with ? icon) -->
          <tr>
            <td style="padding:0 32px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#eef4fc;border-radius:12px;">
                <tr>
                  <td style="padding:14px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:38px;vertical-align:top;">
                          <div
                            style="width:32px;height:32px;background-color:#ffffff;border:1.5px solid #cfdcf3;border-radius:50%;text-align:center;line-height:32px;color:#2563eb;font-size:16px;font-weight:800;font-family:Georgia,serif;">
                            ?</div>
                        </td>
                        <td style="padding-left:12px;">
                          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1e3a8a;">Didn't request this?
                          </p>
                          <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.55;">
                            If you didn't request a password reset, please ignore this email. Your account is safe and
                            no changes will be made.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- "Protect your account" warning card (with ⚠ icon) -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#fdecec;border-radius:12px;">
                <tr>
                  <td style="padding:14px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:38px;vertical-align:top;">
                          <div
                            style="width:32px;height:32px;background-color:#ffffff;border:1.5px solid #f5c4c4;border-radius:50%;text-align:center;line-height:32px;color:#dc2626;font-size:16px;font-weight:800;">
                            &#9888;</div>
                        </td>
                        <td style="padding-left:12px;">
                          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#b91c1c;">Protect your account
                          </p>
                          <p style="margin:0;font-size:12px;color:#7a3030;line-height:1.55;">
                            For security reasons, never share this OTP with anyone.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:0 32px 18px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
                Thank you,<br />
                <span style="color:#1e3a8a;font-weight:800;font-size:14px;">{{ $brandName }} Team</span>
              </p>
            </td>
          </tr>

          <!-- Social icons (brand colors) -->
          <tr>
            <td style="padding:0 32px 14px;text-align:center;">
              <a href="{{ $facebookUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
                <span
                  style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#1877f2;color:#ffffff;font-weight:800;font-size:13px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">f</span>
              </a>
              <a href="{{ $linkedinUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
                <span
                  style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#0a66c2;color:#ffffff;font-weight:800;font-size:11px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">in</span>
              </a>
              <a href="{{ $twitterUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
                <span
                  style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#1da1f2;color:#ffffff;font-weight:800;font-size:12px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">&#120143;</span>
              </a>
              <a href="{{ $youtubeUrl }}" style="display:inline-block;margin:0 3px;text-decoration:none;">
                <span
                  style="display:inline-block;width:28px;height:28px;line-height:28px;background-color:#ff0000;color:#ffffff;font-weight:800;font-size:11px;border-radius:50%;text-align:center;font-family:Arial,sans-serif;">&#9654;</span>
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

      </td>
    </tr>
  </table>

</body>

</html>