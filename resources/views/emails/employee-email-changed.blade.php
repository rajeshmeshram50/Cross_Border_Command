@php
  /* Branding — defaulted so a standalone preview (no Mailable context) still
     renders. BrandingResolver passes the client org's name through as
     $brandName; platform users fall back to the IGC defaults, same as every
     other HR template. */
  $brandName    = $brandName    ?? 'Inorbvict Group Of Companies';

  /* Header: the employee's own branch when we know it, the organisation
     otherwise. $branchName is passed by the Mailable; it is not part of the
     BrandingResolver array, which only resolves to the client. */
  $headerName = ($branchName ?? '') !== '' ? $branchName : $brandName;
  $headerNote = $headerNote ?? 'Account Notification';
  $appName      = $appName      ?? 'Cross Border Command';

  $employeeName = $employeeName ?? 'there';
  $oldEmail     = $oldEmail     ?? '';
  $newEmail     = $newEmail     ?? '';
  $changedAt    = $changedAt    ?? now('Asia/Kolkata')->format('d M Y, h:i A');
  $profileUrl   = $profileUrl   ?? (rtrim(config('app.frontend_url') ?: config('app.url') ?: 'http://localhost', '/') . '/profile');

  /* Two audiences, one design. The old address is being warned, so its copy
     leads with what changed and where mail goes now; the new address is being
     confirmed. */
  $toOldAddress = ($variant ?? 'new') === 'old';

  $heading    = $toOldAddress ? 'Your Email Address' : 'Your Email Has Been';
  $headingAlt = $toOldAddress ? 'Has Been Changed'   : 'Updated Successfully';
  $cardLabel  = $toOldAddress ? 'Mail Now Goes To'   : 'New Email Address';
@endphp
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{{ $heading }} {{ $headingAlt }} — {{ $appName }}</title>
</head>

<body
  style="margin:0;padding:0;background-color:#eef2f7;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#0f172a;">

  {{-- Preheader: the one line a crowded inbox shows next to the subject. --}}
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#eef2f7;">
    @if ($toOldAddress)
      Your {{ $brandName }} login email was changed to {{ $newEmail }}. If this wasn't you, tell HR now.
    @else
      Your email address is now {{ $newEmail }}. Use it for all notifications from here on.
    @endif
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,0.06);">

          {{-- The corner folds: stacked ellipses, top right and bottom right,
               so each edge reads as a curve rather than a diagonal cut. Each
               layer positions itself with `at`, so no background-position is
               set — one would move all four together.

               Gradients rather than an image, because a background image is
               stripped by most clients and a blocked <img> would leave a white
               hole where the artwork should be. Outlook's Word engine ignores
               both and falls back to the flat white card, which is the
               intended degradation. --}}
          <tr>
            <td
              style="padding:0;background:radial-gradient(86px 118px at 100% 0,#dbeafe 0,#dbeafe 100%,transparent 100%),radial-gradient(144px 196px at 100% 0,#eff6ff 0,#eff6ff 100%,transparent 100%);background-color:#ffffff;background-repeat:no-repeat;">

              {{-- HEADER — accent rule, the branch the employee belongs to,
                   and what this message is. Same shape as the sales document
                   email, which is the house pattern for a transactional
                   header. The branch is named rather than the client: an
                   employee answers to their own office, and that is the name
                   they will recognise in a crowded inbox. --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:32px 36px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:4px;background:#2563eb;border-radius:2px;font-size:0;line-height:0;">&nbsp;
                        </td>
                        <td style="padding-left:14px;vertical-align:middle;">
                          <div
                            style="font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;line-height:1.2;">
                            {{ $headerName }}</div>
                          <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">{{ $headerNote }}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              {{-- HERO --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:26px 36px 0;" valign="top">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="top">
                          <h1
                            style="margin:0;font-size:27px;font-weight:800;color:#0f172a;line-height:1.25;letter-spacing:-0.6px;">
                            {{ $heading }}<br />
                            <span style="color:#2563eb;">{{ $headingAlt }}</span>
                          </h1>
                        </td>
                        <td width="72" valign="top" align="right" style="padding-left:12px;">
                          {{-- Outlined envelope with a verified badge. Inline
                               SVG, not an <img>: images are blocked by default
                               in most desktop clients and this is the only mark
                               on the page, so a blocked one would read as a
                               broken message. Hidden from Outlook, which cannot
                               render SVG, and given a glyph instead. --}}
                          <!--[if !mso]><!-->
                          <svg xmlns="http://www.w3.org/2000/svg" width="62" height="48" viewBox="0 0 62 48"
                            style="display:block;" aria-hidden="true">
                            <rect x="2" y="4" width="48" height="34" rx="5" fill="#ffffff" stroke="#2563eb"
                              stroke-width="3" />
                            <path d="M5 9 26 25 47 9" fill="none" stroke="#2563eb" stroke-width="3"
                              stroke-linecap="round" stroke-linejoin="round" />
                            <circle cx="48" cy="34" r="12" fill="#ffffff" />
                            <circle cx="48" cy="34" r="9.5" fill="#2563eb" />
                            <path d="M43.6 34.2 46.7 37.2 52.4 31.2" fill="none" stroke="#ffffff" stroke-width="2.6"
                              stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                          <!--<![endif]-->
                          <!--[if mso]>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                            style="width:56px;height:40px;background-color:#2563eb;border-radius:7px;">
                            <tr><td align="center" valign="middle"
                              style="font-size:20px;line-height:40px;color:#ffffff;font-weight:700;">&#9993;</td></tr>
                          </table>
                          <![endif]-->
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              {{-- BODY --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:22px 36px 0;">
                    <div style="font-size:15px;font-weight:700;color:#0f172a;">Hi {{ $employeeName }},</div>

                    @if ($toOldAddress)
                      <p style="margin:10px 0 0;font-size:14px;color:#475569;line-height:1.65;">
                        The email address on your employee profile was changed, so this is the last message you will
                        receive at <strong style="color:#0f172a;">{{ $oldEmail }}</strong>.
                      </p>
                      <p style="margin:10px 0 0;font-size:14px;color:#475569;line-height:1.65;">
                        Every future notification goes to the address below. Your existing sessions have been signed
                        out and your password must be reset before you can sign in again.
                      </p>
                    @else
                      <p style="margin:10px 0 0;font-size:14px;color:#475569;line-height:1.65;">
                        We wanted to let you know that your email address has been updated in your employee profile.
                      </p>
                      <p style="margin:10px 0 0;font-size:14px;color:#475569;line-height:1.65;">
                        You can now use this email for all system notifications and communications.
                      </p>
                    @endif
                  </td>
                </tr>
              </table>

              {{-- THE ADDRESS CARD --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:20px 36px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                      style="background-color:#eef3fd;border-radius:14px;">
                      <tr>
                        <td style="padding:20px 22px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td width="62" valign="top">
                                {{-- Solid disc with a white envelope. SVG for
                                     the same reason as the hero mark: an <img>
                                     is blocked by default and would leave a
                                     hole in the middle of the card. --}}
                                <!--[if !mso]><!-->
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"
                                  style="display:block;" aria-hidden="true">
                                  <circle cx="24" cy="24" r="24" fill="#c7dcfb" />
                                  <circle cx="24" cy="24" r="17" fill="#2563eb" />
                                  <rect x="15" y="18.5" width="18" height="12.4" rx="2.2" fill="none" stroke="#ffffff"
                                    stroke-width="2" />
                                  <path d="M16.2 20 24 26 31.8 20" fill="none" stroke="#ffffff" stroke-width="2"
                                    stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                                <!--<![endif]-->
                                <!--[if mso]>
                                <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                                  style="width:48px;height:48px;background-color:#2563eb;border-radius:24px;">
                                  <tr><td align="center" valign="middle"
                                    style="font-size:20px;line-height:48px;color:#ffffff;">&#9993;</td></tr>
                                </table>
                                <![endif]-->
                              </td>
                              <td valign="top" style="padding-left:8px;">
                                <div style="font-size:13px;font-weight:500;color:#64748b;line-height:1.5;">
                                  {{ $cardLabel }}</div>
                                <div
                                  style="font-size:15px;font-weight:700;color:#0f172a;margin-top:2px;word-break:break-all;">
                                  {{ $newEmail }}</div>

                                <div style="font-size:13px;font-weight:500;color:#64748b;margin-top:16px;line-height:1.5;">
                                  Updated On</div>
                                <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:2px;">
                                  {{ $changedAt }}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              {{-- CTA --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:24px 36px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="background-color:#2563eb;border-radius:9px;">
                          <a href="{{ $profileUrl }}"
                            style="display:inline-block;padding:13px 30px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                            View Your Profile &nbsp;&rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              {{-- One quiet line, both variants. --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:22px 36px 0;">
                    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;text-align:center;">
                      If you did not make this change, please contact your HR team immediately.
                    </p>
                  </td>
                </tr>
              </table>

              {{-- SIGN-OFF --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:22px 36px 0;">
                    <div style="font-size:13px;color:#475569;line-height:1.6;">Regards,</div>
                    <div style="font-size:14px;font-weight:800;color:#0f172a;">{{ $headerName }} HR Team</div>
                  </td>
                </tr>
              </table>

              {{-- FOOTER — same shape as the sales document email. Opaque
                   white on purpose: the corner artwork must stop at the rule
                   above it, not run behind the address and cut the divider in
                   half. --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#ffffff;">
                <tr>
                  <td style="padding:20px 36px;text-align:center;border-top:1px solid #eef0f3;background-color:#ffffff;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;">
                      &copy; {{ date('Y') }} {{ $headerName }} &middot; All rights reserved
                    </p>
                  </td>
                </tr>
              </table>

              {{-- The closing fold, below the footer rather than behind it, so
                   it balances the one at the top without touching any text. --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td height="68"
                    style="height:68px;font-size:0;line-height:0;background:radial-gradient(84px 58px at 100% 100%,#dbeafe 0,#dbeafe 100%,transparent 100%),radial-gradient(138px 96px at 100% 100%,#eff6ff 0,#eff6ff 100%,transparent 100%);background-color:#ffffff;background-repeat:no-repeat;">
                    &nbsp;</td>
                </tr>
              </table>

            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>

</html>
