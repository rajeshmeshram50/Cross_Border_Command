<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Welcome to {{ $appName }}</title>
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

<body
  style="margin:0;padding:0;background-color:#eef2f7;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#0f172a;">

  {{-- Preheader --}}
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#eef2f7;">
    Welcome to {{ $orgName }} on {{ $appName }}. Your account is ready.
  </div>

  {{-- ============ WRAPPER ============ --}}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">

        {{-- ============ CONTAINER ============ --}}
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"
          style="max-width:640px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,0.06);">

          {{-- ============ TOP DECORATIVE BAND (corner-fold approximation) ============ --}}
          <tr>
            <td
              style="padding:0;background:linear-gradient(225deg,#2563eb 0%,#2563eb 70px,transparent 70px),linear-gradient(225deg,#3b82f6 0%,#3b82f6 110px,transparent 110px);background-color:#ffffff;background-repeat:no-repeat;background-position:top right;">

              {{-- HEADER --- org name as text wordmark --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:30px 40px 16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:6px;background-color:#2563eb;border-radius:3px;font-size:0;line-height:0;">
                          &nbsp;</td>
                        <td style="padding-left:12px;vertical-align:middle;">
                          <div
                            style="font-size:20px;font-weight:900;color:#0f172a;letter-spacing:-0.4px;line-height:1.2;">
                            {{ $orgName }}
                          </div>
                          <div
                            style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:0.4px;margin-top:2px;">
                            Powered by {{ $appName }}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              {{-- HERO --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 40px 16px;">
                    <h1
                      style="margin:0;font-size:42px;font-weight:900;color:#0f172a;line-height:1.05;letter-spacing:-1px;text-transform:uppercase;">
                      Welcome<br />
                      To The <span style="color:#2563eb;">Team</span>
                    </h1>
                    <div
                      style="width:42px;height:3px;background-color:#2563eb;border-radius:2px;margin:16px 0 28px;font-size:0;line-height:0;">
                      &nbsp;</div>

                    <div style="font-size:15px;font-weight:700;color:#0f172a;">Hi {{ $userName }},</div>
                    <p style="margin:8px 0 6px;font-size:14px;color:#475569;line-height:1.6;">
                      Your account on <strong style="color:#2563eb;font-weight:700;">{{ $orgName }}</strong> is ready.
                    </p>
                    <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
                      Use the credentials below to access your account.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          {{-- ============ CREDENTIALS ROWS ============ --}}
          <tr>
            <td style="padding:28px 40px 0;">

              {{-- Email card --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#f3f4f6;border-radius:14px;margin-bottom:14px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:54px;vertical-align:middle;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td
                                style="width:44px;height:44px;background-color:#dbeafe;border-radius:50%;text-align:center;vertical-align:middle;">
                                <img src="{{ asset('images/email-icons/avatar.png') }}" alt="" width="22" height="22"
                                  style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left:14px;vertical-align:middle;">
                          <div style="font-size:12px;color:#64748b;line-height:1.3;">Email / Username</div>
                          {{-- user-select:all makes a single click/tap select the
                               whole value in browser-based webmail (Gmail web etc.)
                               so it's quick to copy. A clickable copy BUTTON can't
                               work in email (no JavaScript). --}}
                          <div
                            style="font-size:15px;font-weight:800;color:#0f172a;margin-top:4px;letter-spacing:-0.2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;user-select:all;-webkit-user-select:all;-moz-user-select:all;">
                            {{ $userEmail }}
                          </div>
                        </td>
                        <td valign="middle" align="right" style="width:28px;">
                          <img src="{{ asset('images/email-icons/copy.png') }}" alt="" width="20" height="20"
                            style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              @if (!empty($password))
                {{-- Password card --}}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                  style="background-color:#f3f4f6;border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="width:54px;vertical-align:middle;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                              <tr>
                                <td
                                  style="width:44px;height:44px;background-color:#dbeafe;border-radius:50%;text-align:center;vertical-align:middle;">
                                  <img src="{{ asset('images/email-icons/lock.png') }}" alt="" width="20" height="20"
                                    style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td style="padding-left:14px;vertical-align:middle;">
                            <div style="font-size:12px;color:#64748b;line-height:1.3;">Temporary Password</div>
                            <div
                              style="font-size:15px;font-weight:800;color:#0f172a;margin-top:4px;letter-spacing:-0.2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;user-select:all;-webkit-user-select:all;-moz-user-select:all;">
                              {{ $password }}
                            </div>
                          </td>
                          <td valign="middle" align="right" style="padding-right:10px;">
                            <span
                              style="display:inline-block;background-color:#dbeafe;color:#2563eb;font-size:11px;font-weight:700;padding:5px 12px;border-radius:8px;letter-spacing:0.2px;">Temporary</span>
                          </td>
                          <td valign="middle" align="right" style="width:28px;">
                            <img src="{{ asset('images/email-icons/copy.png') }}" alt="" width="20" height="20"
                              style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              @endif

            </td>
          </tr>

          {{-- ============ CTA ============ --}}
          <tr>
            <td style="padding:32px 40px 8px;text-align:center;">
              <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $loginUrl }}" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="20%" stroke="f" fillcolor="#2563eb">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Access Your Account &nbsp; &rarr;</center>
    </v:roundrect>
    <![endif]-->
              <!--[if !mso]><!-- -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td style="background-color:#2563eb;border-radius:10px;box-shadow:0 6px 20px rgba(37,99,235,0.30);">
                    <a href="{{ $loginUrl }}" target="_blank"
                      style="display:inline-block;padding:16px 60px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Access Your Account &nbsp;&nbsp;&rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->
              <p style="margin:14px 0 0;font-size:13px;color:#475569;">
                Or visit: <a href="{{ $loginUrl }}"
                  style="color:#2563eb;text-decoration:none;font-weight:700;">{{ str_replace(['http://', 'https://'], '', $loginUrl) }}</a>
              </p>
            </td>
          </tr>

          {{-- ============ 3 FEATURE CARDS ============ --}}
          <tr>
            <td style="padding:32px 40px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>

                  {{-- Card 1 --}}
                  <td valign="top" align="center" width="33%" style="padding:0 10px;border-right:1px solid #e2e8f0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td align="center" style="padding-bottom:12px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                            <tr>
                              <td
                                style="width:54px;height:54px;background-color:#dbeafe;border-radius:50%;text-align:center;vertical-align:middle;">
                                <img src="{{ asset('images/email-icons/key.png') }}" alt="" width="24" height="24"
                                  style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center"
                          style="font-size:13.5px;font-weight:800;color:#0f172a;line-height:1.3;padding-bottom:5px;letter-spacing:-0.2px;">
                          Change your<br />password</td>
                      </tr>
                      <tr>
                        <td align="center" style="font-size:11.5px;color:#94a3b8;line-height:1.5;">On first login</td>
                      </tr>
                    </table>
                  </td>

                  {{-- Card 2 --}}
                  <td valign="top" align="center" width="33%" style="padding:0 10px;border-right:1px solid #e2e8f0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td align="center" style="padding-bottom:12px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                            <tr>
                              <td
                                style="width:54px;height:54px;background-color:#dbeafe;border-radius:50%;text-align:center;vertical-align:middle;">
                                <img src="{{ asset('images/email-icons/shield-lock.png') }}" alt="" width="24"
                                  height="24"
                                  style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center"
                          style="font-size:13.5px;font-weight:800;color:#0f172a;line-height:1.3;padding-bottom:5px;letter-spacing:-0.2px;">
                          Keep credentials<br />private</td>
                      </tr>
                      <tr>
                        <td align="center" style="font-size:11.5px;color:#94a3b8;line-height:1.5;">Never share them</td>
                      </tr>
                    </table>
                  </td>

                  {{-- Card 3 --}}
                  <td valign="top" align="center" width="33%" style="padding:0 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td align="center" style="padding-bottom:12px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                            <tr>
                              <td
                                style="width:54px;height:54px;background-color:#dbeafe;border-radius:50%;text-align:center;vertical-align:middle;">
                                <img src="{{ asset('images/email-icons/grid.png') }}" alt="" width="24" height="24"
                                  style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center"
                          style="font-size:13.5px;font-weight:800;color:#0f172a;line-height:1.3;padding-bottom:5px;letter-spacing:-0.2px;">
                          Explore the<br />dashboard</td>
                      </tr>
                      <tr>
                        <td align="center" style="font-size:11.5px;color:#94a3b8;line-height:1.5;">Set up your profile
                        </td>
                      </tr>
                    </table>
                  </td>

                </tr>
              </table>
            </td>
          </tr>

          {{-- ============ NEED HELP ============ --}}
          <tr>
            <td style="padding:32px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#f3f4f6;border-radius:14px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:54px;vertical-align:middle;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td
                                style="width:44px;height:44px;background-color:#dbeafe;border-radius:50%;text-align:center;vertical-align:middle;">
                                <img src="{{ asset('images/email-icons/headset.png') }}" alt="" width="20" height="20"
                                  style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left:14px;vertical-align:middle;">
                          <div style="font-size:14px;font-weight:800;color:#0f172a;letter-spacing:-0.2px;">Need help?
                          </div>
                          <div style="font-size:12px;color:#475569;line-height:1.5;margin-top:3px;">
                            Contact our <a href="mailto:{{ config('mail.from.address') }}"
                              style="color:#2563eb;text-decoration:none;font-weight:700;">support team</a>.
                          </div>
                        </td>
                        <td valign="middle" align="right" style="width:24px;">
                          <img src="{{ asset('images/email-icons/chevron-right.png') }}" alt="" width="18" height="18"
                            style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          {{-- ============ FOOTER (with bottom-left corner fold + dot grid) ============ --}}
          <tr>
            <td
              style="padding:0;background:linear-gradient(45deg,#2563eb 0%,#2563eb 60px,transparent 60px),linear-gradient(45deg,#3b82f6 0%,#3b82f6 95px,transparent 95px);background-color:#ffffff;background-repeat:no-repeat;background-position:bottom left;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" align="center" style="padding:36px 40px 30px;">
                    <p style="margin:0;font-size:12px;color:#94a3b8;letter-spacing:0.2px;">
                      &copy; {{ date('Y') }} {{ $orgName }}. All rights reserved.
                    </p>
                  </td>
                </tr>
                <tr>
                  {{-- Dot grid in bottom-right --}}
                  <td align="right" style="padding:0 28px 22px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right">
                      @for ($r = 0; $r < 5; $r++)
                        <tr>
                          @for ($c = 0; $c < 5; $c++)
                            <td style="width:7px;height:7px;padding:2px;font-size:0;line-height:0;">
                              <div
                                style="width:4px;height:4px;background-color:#2563eb;border-radius:50%;font-size:0;line-height:0;">
                                &nbsp;</div>
                            </td>
                          @endfor
                        </tr>
                      @endfor
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        {{-- /Container --}}

      </td>
    </tr>
  </table>
  {{-- /Wrapper --}}

</body>

</html>