<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0d0d;font-family:'Segoe UI',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(160deg,#0d0d0d 0%,#111827 100%);padding:50px 0;">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" border="0" style="border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.07);">

          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b 0%,#ef4444 50%,#ec4899 100%);padding:3px 0 0 0;line-height:0;font-size:0;">&nbsp;</td>
          </tr>

          <tr>
            <td style="background:linear-gradient(180deg,#1c1008 0%,#111827 100%);padding:50px 48px 36px;text-align:center;">
              <div style="display:inline-block;width:72px;height:72px;background:linear-gradient(135deg,#f59e0b,#ef4444);border-radius:20px;line-height:72px;text-align:center;margin-bottom:24px;box-shadow:0 8px 28px rgba(245,158,11,0.45);font-size:32px;">
                &#x1F510;
              </div>
              <h1 style="margin:0 0 10px;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                Password Reset Request
              </h1>
              <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.6;">
                We received a request to reset the password for your <strong style="color:#fbbf24;">Cross Border Command</strong> account.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:10px 48px 20px;">
              <p style="margin:0;font-size:15px;color:#cbd5e1;line-height:1.7;">
                Hey <strong style="color:#e2e8f0;">{{ $userName }}</strong> &#x1F44B;,<br/>
                No worries — it happens to the best of us! Use the OTP code below to reset your password. This code is valid for <strong style="color:#fbbf24;">{{ $expiryMinutes }} minutes</strong> only.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:10px 48px 32px;text-align:center;">
              <div style="display:inline-block;background:#0f172a;border:2px solid rgba(245,158,11,0.4);border-radius:16px;padding:24px 48px;">
                <p style="margin:0 0 8px;font-size:11px;color:#f59e0b;letter-spacing:3px;text-transform:uppercase;font-weight:600;">Your Verification Code</p>
                <p style="margin:0;font-size:42px;color:#fde68a;font-family:'Courier New',monospace;font-weight:800;letter-spacing:12px;">{{ $otp }}</p>
              </div>
              <p style="margin:14px 0 0;font-size:12px;color:#4b5563;">
                Enter this code on the verification page to continue.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:0 48px;">
              <div style="height:1px;background:linear-gradient(to right,transparent,rgba(245,158,11,0.4),transparent);"></div>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:28px 48px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border:1px solid rgba(245,158,11,0.25);border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:40px;vertical-align:middle;">
                          <span style="font-size:22px;">&#x23F1;</span>
                        </td>
                        <td style="padding-left:12px;vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:12px;color:#f59e0b;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Code Expires In</p>
                          <p style="margin:0;font-size:20px;color:#fde68a;font-family:'Courier New',monospace;font-weight:700;letter-spacing:2px;">{{ $expiryMinutes }} : 00 &nbsp;<span style="font-size:13px;color:#6b7280;font-family:'Segoe UI',Arial,sans-serif;font-weight:400;">minutes</span></p>
                        </td>
                        <td align="right">
                          <span style="display:inline-block;background:rgba(245,158,11,0.12);color:#fbbf24;font-size:11px;padding:5px 14px;border-radius:20px;border:1px solid rgba(245,158,11,0.3);font-family:Arial,sans-serif;">
                            One-Time Use
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="50%" style="padding-right:10px;">
                          <p style="margin:0 0 4px;font-size:11px;color:#4b5563;letter-spacing:1.5px;text-transform:uppercase;">Requested At</p>
                          <p style="margin:0;font-size:13px;color:#94a3b8;font-family:'Courier New',monospace;">{{ $requestedAt }}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0 0 4px;font-size:11px;color:#4b5563;letter-spacing:1.5px;text-transform:uppercase;">Account Email</p>
                          <p style="margin:0;font-size:13px;color:#94a3b8;font-family:'Courier New',monospace;">{{ $userEmail }}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:0 48px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:14px;padding:0;">
                <tr>
                  <td style="padding:18px 22px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:32px;vertical-align:top;">
                          <span style="font-size:20px;">&#x1F6A8;</span>
                        </td>
                        <td style="padding-left:12px;vertical-align:top;">
                          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#f87171;">Didn't request this?</p>
                          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
                            If you didn't request a password reset, please ignore this email or
                            <a href="mailto:{{ config('mail.from.address') }}" style="color:#ef4444;text-decoration:none;font-weight:600;">contact our security team</a>
                            immediately. Your account may be at risk.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:0 48px;">
              <div style="height:1px;background:linear-gradient(to right,transparent,rgba(255,255,255,0.08),transparent);"></div>
            </td>
          </tr>

          <tr>
            <td style="background:#111827;padding:28px 48px;">
              <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Tips for a Strong Password</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                @foreach(['Use at least <strong style="color:#fbbf24;">8 characters</strong> with a mix of letters, numbers & symbols.', '<strong style="color:#fbbf24;">Avoid reusing</strong> old passwords or common words.', 'Consider using a <strong style="color:#fbbf24;">password manager</strong> to stay secure.'] as $tip)
                <tr>
                  <td style="padding:0 0 11px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <span style="display:inline-block;width:20px;height:20px;background:rgba(245,158,11,0.15);border-radius:50%;text-align:center;font-size:11px;line-height:20px;">&#x2705;</span>
                        </td>
                        <td style="padding-left:10px;">
                          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5;">{!! $tip !!}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                @endforeach
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#0f172a;padding:20px 48px;border-top:1px solid rgba(255,255,255,0.05);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:13px;color:#4b5563;">
                      Need help? &nbsp;
                      <a href="mailto:{{ config('mail.from.address') }}" style="color:#fbbf24;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#0a0f1a;padding:24px 48px;text-align:center;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#f59e0b;letter-spacing:1px;">
                &#x26A1; Cross Border Command
              </p>
              <p style="margin:0 0 12px;font-size:12px;color:#374151;">
                {{ config('app.url') }}
              </p>
              <p style="margin:0;font-size:11px;color:#1f2937;line-height:1.7;">
                You're receiving this because a password reset was requested for your account.<br/>
                If this wasn't you, <a href="mailto:{{ config('mail.from.address') }}" style="color:#fbbf24;text-decoration:none;">contact us immediately</a>.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b 0%,#ef4444 50%,#ec4899 100%);padding:3px 0 0 0;line-height:0;font-size:0;">&nbsp;</td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
