<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>Complete your onboarding — {{ $orgName }}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <tr><td style="height:4px;background:linear-gradient(90deg,#7c5cfc,#a78bfa,#5a3fd1);font-size:0;line-height:0;">&nbsp;</td></tr>

  <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr>
      <td style="width:40px;height:40px;background:linear-gradient(135deg,#7c5cfc,#a78bfa);border-radius:12px;text-align:center;vertical-align:middle;">
        <span style="font-size:20px;line-height:40px;color:#ffffff;">&#9989;</span>
      </td>
      <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">{{ $appName }}</td>
    </tr>
    </table>
  </td></tr>

  <tr><td style="padding:40px 40px 24px;text-align:center;">
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">You're invited to join {{ $orgName }}</h1>
    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
      Hi {{ $candidateName }} — please complete your employee profile so HR can finalize your onboarding.
    </p>
  </td></tr>

  <tr><td style="padding:0 40px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0ff;border:1px solid #d6c9ff;border-radius:12px;padding:18px 20px;">
    <tr><td style="font-size:13px;color:#5a3fd1;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:6px;">Invitation summary</td></tr>
    <tr><td style="font-size:13.5px;color:#1f2937;line-height:1.7;">
      <strong>Email:</strong> {{ $candidateEmail }}<br />
      <strong>Department:</strong> {{ $departmentName }}<br />
      <strong>Expected joining date:</strong> {{ $expectedJoinDate }}
    </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:24px 40px 8px;text-align:center;">
    <a href="{{ $onboardingUrl }}"
       style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c5cfc,#a78bfa);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;letter-spacing:0.02em;">
      Complete onboarding form
    </a>
  </td></tr>

  <tr><td style="padding:8px 40px 32px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      This link expires in <strong>{{ $expiryDays }} day{{ $expiryDays === 1 ? '' : 's' }}</strong>.
      If the button doesn't work, copy and paste:<br />
      <span style="word-break:break-all;color:#5a3fd1;">{{ $onboardingUrl }}</span>
    </p>
  </td></tr>

  <tr><td style="padding:16px 40px 24px;border-top:1px solid #f0f0f5;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">
      You received this because someone at {{ $orgName }} invited you to onboard.
      If this wasn't you, ignore this email.
    </p>
  </td></tr>

</table>

</td></tr>
</table>

</body>
</html>
