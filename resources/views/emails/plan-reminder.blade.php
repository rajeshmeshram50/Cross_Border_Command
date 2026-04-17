<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Plan Reminder</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <!-- Top Bar -->
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
    <tr><td style="width:72px;height:72px;background:{{ $remainingDays <= 0 ? '#FEF2F2' : ($remainingDays <= 7 ? '#FFFBEB' : '#EEF2FF') }};border-radius:20px;text-align:center;vertical-align:middle;">
      <span style="font-size:32px;line-height:72px;">{{ $remainingDays <= 0 ? '&#9888;' : ($remainingDays <= 7 ? '&#9200;' : '&#128276;') }}</span>
    </td></tr>
    </table>

    <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">
      @if($remainingDays <= 0)
        Your Plan Has Expired
      @elseif($remainingDays <= 7)
        Plan Expiring Soon!
      @else
        Plan Renewal Reminder
      @endif
    </h1>
    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
      @if($remainingDays <= 0)
        Your subscription has expired. Renew now to continue using all features.
      @else
        Your subscription will expire in <strong style="color:#B45309;">{{ $remainingDays }} day{{ $remainingDays !== 1 ? 's' : '' }}</strong>.
      @endif
    </p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:0 40px 24px;">
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;">
      Hi <strong style="color:#1e293b;">{{ $clientName }}</strong>,<br/>
      This is a reminder about your subscription plan.
    </p>
  </td></tr>

  <!-- Plan Details Card -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="50%">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Plan</p>
              <p style="margin:0;font-size:16px;font-weight:700;color:#1e293b;">{{ $planName }} Plan</p>
            </td>
            <td width="50%" style="text-align:right;">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Amount</p>
              <p style="margin:0;font-size:16px;font-weight:700;color:#4F46E5;">&#8377;{{ number_format((float)$payment->total, 2) }}</p>
            </td>
          </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="50%">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Valid From</p>
              <p style="margin:0;font-size:13px;font-weight:600;color:#1e293b;">{{ $payment->valid_from ? $payment->valid_from->format('d M Y') : 'N/A' }}</p>
            </td>
            <td width="50%">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Expires On</p>
              <p style="margin:0;font-size:13px;font-weight:600;color:{{ $remainingDays <= 7 ? '#DC2626' : '#1e293b' }};">{{ $expiryDate }}</p>
            </td>
          </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 24px;text-align:center;">
          <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Remaining Days</p>
          <p style="margin:0;font-size:36px;font-weight:800;color:{{ $remainingDays <= 0 ? '#DC2626' : ($remainingDays <= 7 ? '#B45309' : '#4F46E5') }};">
            {{ $remainingDays <= 0 ? 'EXPIRED' : $remainingDays }}
          </p>
          @if($remainingDays > 0)
            <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">day{{ $remainingDays !== 1 ? 's' : '' }} remaining</p>
          @endif
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 40px 32px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:10px;">
      <a href="{{ config('app.url') }}" target="_blank" style="display:inline-block;padding:14px 40px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">
        {{ $remainingDays <= 0 ? 'Renew Now' : 'Manage Subscription' }} &rarr;
      </a>
    </td></tr>
    </table>
  </td></tr>

  <!-- Info -->
  @if($remainingDays > 0 && $remainingDays <= 7)
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
        <strong>Important:</strong> Once your plan expires, branch users will be blocked from accessing the platform.
        Client admins will only see the plan renewal page. Renew before <strong>{{ $expiryDate }}</strong> to avoid interruption.
      </p>
    </td></tr>
    </table>
  </td></tr>
  @endif

  @if($remainingDays <= 0)
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border:1px solid #FECACA;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.6;">
        <strong>Your plan has expired.</strong> Branch users are currently blocked from accessing the platform.
        Please renew your subscription to restore full access for your team.
      </p>
    </td></tr>
    </table>
  </td></tr>
  @endif

  <!-- Invoice ref -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;">Invoice Reference</p>
          <p style="margin:0;font-size:13px;font-weight:600;color:#1e293b;">{{ $payment->invoice_number }}</p>
        </td>
        <td style="text-align:right;">
          <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;">Payment Method</p>
          <p style="margin:0;font-size:13px;font-weight:600;color:#1e293b;">{{ str_replace('_', ' ', ucfirst($payment->method)) }}</p>
        </td>
      </tr>
      </table>
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
      <td style="padding-left:8px;font-size:14px;font-weight:700;color:#1e293b;">Cross Border Command</td>
    </tr>
    </table>
    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">
      Need help? <a href="mailto:{{ config('mail.from.address') }}" style="color:#4F46E5;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;">
      &copy; {{ date('Y') }} Cross Border Command. All rights reserved.
    </p>
  </td></tr>

  <tr><td style="height:4px;background:linear-gradient(90deg,#4F46E5,#7C3AED,#6366F1);font-size:0;line-height:0;">&nbsp;</td></tr>

</table>
</td></tr>
</table>

</body>
</html>
