<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Plan Renewal Reminder</title>
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
@php
  $isExpired = $remainingDays <= 0;
  $isUrgent  = $remainingDays > 0 && $remainingDays <= 7;

  if ($isExpired) {
      $badgeBg = '#FEF2F2'; $badgeFg = '#DC2626'; $badgeText = 'Expired';
      $heroGrad = 'linear-gradient(135deg,#DC2626,#B91C1C)';
      $title = 'Your Plan Has Expired';
      $subtitle = 'Your subscription has expired. Renew now to continue using all features.';
      $ctaLabel = 'Renew Now';
  } elseif ($isUrgent) {
      $badgeBg = '#FFFBEB'; $badgeFg = '#B45309'; $badgeText = $remainingDays . ' Days Left';
      $heroGrad = 'linear-gradient(135deg,#D97706,#B45309)';
      $title = 'Plan Expiring Soon';
      $subtitle = 'Your subscription is about to expire. Renew today to avoid interruption.';
      $ctaLabel = 'Renew Subscription';
  } else {
      $badgeBg = '#EEF2FF'; $badgeFg = '#4F46E5'; $badgeText = $remainingDays . ' Days Left';
      $heroGrad = 'linear-gradient(135deg,#4F46E5,#7C3AED)';
      $title = 'Plan Renewal Reminder';
      $subtitle = 'This is a friendly reminder about your upcoming subscription renewal.';
      $ctaLabel = 'Manage Subscription';
  }
@endphp
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

<!-- Wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<!-- Container -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <!-- Top Accent Bar -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#4F46E5,#7C3AED,#6366F1);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #f0f0f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:40px;height:40px;background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:12px;text-align:center;vertical-align:middle;">
            <span style="font-size:20px;line-height:40px;color:#ffffff;">&#9889;</span>
          </td>
          <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">Cross Border Command</td>
        </tr>
        </table>
      </td>
      <td style="text-align:right;vertical-align:middle;">
        <span style="display:inline-block;background:{{ $badgeBg }};color:{{ $badgeFg }};font-size:11px;font-weight:700;padding:5px 14px;border-radius:8px;text-transform:uppercase;letter-spacing:0.5px;">{{ $badgeText }}</span>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 40px 20px;">
    <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1e293b;">Hello {{ $clientName }},</p>
    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">{{ $subtitle }}</p>
  </td></tr>

  <!-- Hero Card -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{{ $heroGrad }};border-radius:14px;">
    <tr><td style="padding:28px 24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">
        {{ $isExpired ? 'Plan Expired' : 'Renewal Amount' }}
      </p>
      <p style="margin:0;font-size:38px;font-weight:800;color:#ffffff;letter-spacing:-1px;">
        &#8377;{{ number_format((float)$payment->total, 2) }}
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">
        {{ $planName }} Plan &middot; {{ ucfirst($payment->billing_cycle ?? 'Subscription') }}
      </p>
    </td></tr>
    </table>
  </td></tr>

  <!-- Title -->
  <tr><td style="padding:0 40px 8px;text-align:center;">
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">{{ $title }}</h1>
    @if(!$isExpired)
      <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
        Your subscription will expire in
        <strong style="color:{{ $isUrgent ? '#B45309' : '#4F46E5' }};">{{ $remainingDays }} day{{ $remainingDays !== 1 ? 's' : '' }}</strong>
        on <strong style="color:#1e293b;">{{ $expiryDate }}</strong>.
      </p>
    @endif
  </td></tr>

  <!-- Remaining Days Big Counter -->
  @if(!$isExpired)
  <tr><td style="padding:20px 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{{ $isUrgent ? '#FFFBEB' : '#EEF2FF' }};border:1px solid {{ $isUrgent ? '#FDE68A' : '#C7D2FE' }};border-radius:12px;">
    <tr><td style="padding:20px 24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:{{ $isUrgent ? '#B45309' : '#4F46E5' }};letter-spacing:1.5px;text-transform:uppercase;">Remaining Days</p>
      <p style="margin:0;font-size:42px;font-weight:800;color:{{ $isUrgent ? '#B45309' : '#4F46E5' }};line-height:1;letter-spacing:-1.5px;">{{ $remainingDays }}</p>
      <p style="margin:6px 0 0;font-size:12px;color:{{ $isUrgent ? '#92400E' : '#475569' }};">day{{ $remainingDays !== 1 ? 's' : '' }} until expiry</p>
    </td></tr>
    </table>
  </td></tr>
  @endif

  <!-- Subscription Details -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td colspan="2" style="background-color:#f8fafc;padding:14px 20px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #e2e8f0;">
          Subscription Details
        </td>
      </tr>
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#94a3b8;border-bottom:1px solid #f1f5f9;width:40%;">Plan</td>
        <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">{{ $planName }} Plan</td>
      </tr>
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#94a3b8;border-bottom:1px solid #f1f5f9;">Amount</td>
        <td style="padding:12px 20px;font-size:13px;color:#4F46E5;font-weight:700;border-bottom:1px solid #f1f5f9;">&#8377;{{ number_format((float)$payment->total, 2) }}</td>
      </tr>
      @if($payment->valid_from)
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#94a3b8;border-bottom:1px solid #f1f5f9;">Valid From</td>
        <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">{{ $payment->valid_from->format('d M Y') }}</td>
      </tr>
      @endif
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#94a3b8;border-bottom:1px solid #f1f5f9;">Expires On</td>
        <td style="padding:12px 20px;font-size:13px;color:{{ $isExpired || $isUrgent ? '#DC2626' : '#1e293b' }};font-weight:700;border-bottom:1px solid #f1f5f9;">{{ $expiryDate }}</td>
      </tr>
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#94a3b8;border-bottom:1px solid #f1f5f9;">Invoice Reference</td>
        <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">{{ $payment->invoice_number }}</td>
      </tr>
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#94a3b8;">Payment Method</td>
        <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;">{{ str_replace('_', ' ', ucfirst($payment->method)) }}</td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 40px 28px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:10px;">
      <a href="{{ config('app.url') }}" target="_blank" style="display:inline-block;padding:14px 40px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
        {{ $ctaLabel }} &rarr;
      </a>
    </td></tr>
    </table>
  </td></tr>

  <!-- Urgent Info Banner -->
  @if($isUrgent)
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:1px;">Important</p>
      <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
        Once your plan expires, branch users will be blocked from accessing the platform and client admins will only see the renewal page. Please renew before <strong>{{ $expiryDate }}</strong> to avoid service interruption.
      </p>
    </td></tr>
    </table>
  </td></tr>
  @endif

  <!-- Expired Info Banner -->
  @if($isExpired)
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border:1px solid #FECACA;border-radius:10px;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:1px;">Action Required</p>
      <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.6;">
        Your plan has expired and branch users are currently blocked from accessing the platform. Please renew your subscription now to restore full access for your team.
      </p>
    </td></tr>
    </table>
  </td></tr>
  @endif

  <!-- Note -->
  <tr><td style="padding:0 40px 28px;">
    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;text-align:center;">
      This is a reminder based on your current subscription. If you have already renewed, you can ignore this email.
    </p>
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

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1e293b;">We appreciate your continued business!</p>
    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6;">
      Need help? <a href="mailto:{{ config('mail.from.address') }}" style="color:#4F46E5;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;line-height:1.6;">
      This is an automated email. Please do not reply directly.<br/>
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
