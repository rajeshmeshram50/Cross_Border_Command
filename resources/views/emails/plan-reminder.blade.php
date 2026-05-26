<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Renewal Reminder &mdash; {{ $planName }}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
@php
  $vendorName = config('app.vendor_name', 'Inorbvict Group of Companies');
  $isExpired  = $remainingDays <= 0;
  $isUrgent   = $remainingDays > 0 && $remainingDays <= 7;

  // Three-state pill in the top-right + matching headline copy.
  if ($isExpired) {
      $pillText   = 'EXPIRED';
      $pillBg     = '#fef2f2'; $pillFg = '#dc2626';
      $headline   = 'Plan Expired';
      $ctaLabel   = 'Renew Now';
  } elseif ($isUrgent) {
      $pillText   = $remainingDays . ' DAYS LEFT';
      $pillBg     = '#fef2f2'; $pillFg = '#dc2626';
      $headline   = 'Renewal Due Soon';
      $ctaLabel   = 'Renew Subscription';
  } else {
      $pillText   = $remainingDays . ' DAYS LEFT';
      $pillBg     = '#fef3c7'; $pillFg = '#b45309';
      $headline   = 'Renewal Due Soon';
      $ctaLabel   = 'Manage Subscription';
  }
@endphp
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#111827;">

{{-- Preheader --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  {{ $headline }} &mdash; {{ $planName }} expires {{ $expiryDate }}
</div>

{{-- ============ WRAPPER ============ --}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

{{-- ============ CONTAINER ============ --}}
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- ============ HEADER (stacked wordmark + bars subtitle) ============ --}}
  @php
    // Split vendor name → first word becomes the big title, rest is subtitle.
    $parts     = explode(' ', $vendorName, 2);
    $brandMain = strtoupper($parts[0] ?? $vendorName);
    $brandSub  = strtoupper(trim($parts[1] ?? ''));
  @endphp
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #fbbf24;">

    {{-- Big main word --}}
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>

    @if($brandSub !== '')
    {{-- Subtitle: amber bar · GROUP OF COMPANIES · amber bar --}}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:10px;">
    <tr>
      <td style="width:34px;height:4px;background-color:#f59e0b;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 14px;font-size:10.5px;font-weight:700;color:#b45309;letter-spacing:3.5px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
      <td style="width:34px;height:4px;background-color:#f59e0b;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
    </table>
    @endif

  </td></tr>

  {{-- ============ HERO (compact: icon → headline → subtitle) ============ --}}
  <tr><td style="padding:24px 32px 18px;text-align:center;">

    {{-- Warning triangle (no circle) --}}
    <img src="{{ asset('images/email-icons/warning-triangle.png') }}" alt="Renewal due"
         width="84" height="84"
         style="display:inline-block;border:0;outline:none;width:84px;height:84px;margin-bottom:14px;" />

    <h1 style="margin:0;font-size:24px;font-weight:800;color:#0f172a;line-height:1.15;letter-spacing:-0.5px;">{{ $headline }}</h1>
    <p style="margin:6px 0 0;font-size:13.5px;color:#475569;line-height:1.55;">
      @if($isExpired)
        Your subscription has expired. Renew now to continue using all features.
      @else
        Your subscription will expire in
        <strong style="color:{{ $pillFg }};font-weight:800;">{{ $remainingDays }} day{{ $remainingDays === 1 ? '' : 's' }}</strong>.
      @endif
    </p>
  </td></tr>

  {{-- ============ RENEWAL AMOUNT CARD (cream/amber) ============ --}}
  <tr><td style="padding:6px 32px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fef9e7;background:linear-gradient(135deg,#fef9e7 0%,#fef3c7 100%);border-radius:14px;">
    <tr><td style="padding:20px 24px;text-align:center;">
      <div style="font-size:11px;font-weight:800;color:#b45309;letter-spacing:1.6px;text-transform:uppercase;">Renewal Amount</div>
      <div style="font-size:36px;font-weight:800;color:#f59e0b;letter-spacing:-1px;margin-top:10px;line-height:1.1;">&#8377;{{ number_format((float) $payment->total, 2) }}</div>
      <div style="font-size:13px;color:#92400e;margin-top:8px;font-weight:500;">
        {{ $planName }}@if(!empty($payment->billing_cycle)) &nbsp;&middot;&nbsp; {{ ucfirst($payment->billing_cycle) }}@endif
      </div>
    </td></tr>
    </table>
  </td></tr>

  {{-- ============ SUBSCRIPTION DETAILS ============ --}}
  <tr><td style="padding:0 32px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #f3f4f6;border-radius:14px;overflow:hidden;">

      {{-- Card title --}}
      <tr><td colspan="3" style="padding:14px 20px;border-bottom:1px solid #f3f4f6;font-size:11px;font-weight:800;color:#f59e0b;letter-spacing:1.6px;text-transform:uppercase;">
        Subscription Details
      </td></tr>

      @php
      $rows = [
          ['icon' => 'crown',           'label' => 'Plan',              'value' => $planName],
          ['icon' => 'money-bag',       'label' => 'Amount',            'value' => '&#8377;' . number_format((float) $payment->total, 2), 'valueColor' => '#f59e0b', 'isHtml' => true],
          ['icon' => 'calendar-amber',  'label' => 'Valid From',        'value' => $payment->valid_from ? $payment->valid_from->format('d M Y') : '—'],
          ['icon' => 'clock-amber',     'label' => 'Expires On',        'value' => $expiryDate],
          ['icon' => 'file-text',       'label' => 'Invoice Reference', 'value' => $payment->invoice_number ?: '—'],
          ['icon' => 'credit-card',     'label' => 'Payment Method',    'value' => $payment->method ? str_replace('_', ' ', ucwords($payment->method, '_')) : '—'],
      ];
      @endphp

      @foreach($rows as $i => $row)
      <tr>
        <td style="width:60px;padding:14px 0 14px 20px;vertical-align:middle;@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">
          <img src="{{ asset('images/email-icons/' . $row['icon'] . '.png') }}" alt="" width="22" height="22"
               style="display:inline-block;border:0;outline:none;vertical-align:middle;" />
        </td>
        <td style="padding:14px 16px 14px 12px;font-size:13px;color:#374151;@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">{{ $row['label'] }}</td>
        <td align="right" style="padding:14px 20px;font-size:13px;font-weight:700;color:{{ $row['valueColor'] ?? '#111827' }};@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">
          @if(!empty($row['isHtml']))
            {!! $row['value'] !!}
          @else
            {{ $row['value'] }}
          @endif
        </td>
      </tr>
      @endforeach

    </table>
  </td></tr>

  {{-- ============ CTA ============ --}}
  <tr><td style="padding:8px 32px 8px;text-align:center;">
    @php($manageUrl = config('app.url') . '/payments')
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $manageUrl }}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="22%" stroke="f" fillcolor="#f59e0b">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;">{{ $ctaLabel }} &rarr;</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background-color:#f59e0b;background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%);border-radius:11px;box-shadow:0 6px 18px rgba(245,158,11,0.30);">
      <a href="{{ $manageUrl }}" target="_blank" style="display:inline-block;padding:14px 40px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
        {{ $ctaLabel }} &nbsp;&rarr;
      </a>
    </td></tr>
    </table>
    <!--<![endif]-->
  </td></tr>

  {{-- ============ IGNORE NOTE ============ --}}
  <tr><td style="padding:14px 32px 28px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr>
      <td valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:28px;height:28px;background-color:#f3f4f6;border-radius:50%;text-align:center;vertical-align:middle;">
            <img src="{{ asset('images/email-icons/bell.png') }}" alt="" width="14" height="14"
                 style="display:inline-block;border:0;outline:none;vertical-align:middle;" />
          </td>
        </tr></table>
      </td>
      <td valign="middle" style="padding-left:10px;font-size:12px;color:#6b7280;">
        If you have already renewed, you can ignore this email.
      </td>
    </tr>
    </table>
  </td></tr>

  {{-- ============ FOOTER ============ --}}
  <tr><td style="padding:22px 32px 18px;text-align:center;background-color:#fafafa;border-top:1px solid #f3f4f6;">
    {{-- Brand --}}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:14px;">
    <tr>
      <td style="width:28px;height:28px;background-color:#f59e0b;border-radius:7px;text-align:center;vertical-align:middle;line-height:28px;">
        <span style="color:#ffffff;font-size:14px;line-height:28px;">&#9733;</span>
      </td>
      <td style="padding-left:10px;font-size:13px;font-weight:800;color:#111827;letter-spacing:-0.2px;vertical-align:middle;">{{ $vendorName }}</td>
    </tr>
    </table>

    {{-- Contact --}}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:14px;">
    <tr>
      <td valign="middle" style="padding:0 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle"><img src="{{ asset('images/email-icons/mail-gray.png') }}" alt="" width="14" height="14" style="display:inline-block;border:0;outline:none;vertical-align:middle;" /></td>
          <td valign="middle" style="padding-left:8px;font-size:12px;color:#374151;">
            <a href="mailto:{{ config('mail.from.address') }}" style="color:#374151;text-decoration:none;">{{ config('mail.from.address') }}</a>
          </td>
        </tr></table>
      </td>
      <td valign="middle" style="padding:0 6px;color:#d1d5db;font-size:14px;">|</td>
      <td valign="middle" style="padding:0 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle"><img src="{{ asset('images/email-icons/phone.png') }}" alt="" width="14" height="14" style="display:inline-block;border:0;outline:none;vertical-align:middle;" /></td>
          <td valign="middle" style="padding-left:8px;font-size:12px;color:#374151;">+91 98765 43210</td>
        </tr></table>
      </td>
    </tr>
    </table>

    {{-- Copyright --}}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-top:1px solid #f3f4f6;padding-top:14px;">
    <tr>
      <td valign="middle" style="padding-top:12px;">
        <img src="{{ asset('images/email-icons/shield-gray.png') }}" alt="" width="12" height="12" style="display:inline-block;border:0;outline:none;vertical-align:middle;" />
      </td>
      <td valign="middle" style="padding:12px 0 0 8px;font-size:11px;color:#9ca3af;">
        &copy; {{ date('Y') }} {{ $vendorName }}. All rights reserved.
      </td>
    </tr>
    </table>

  </td></tr>

</table>
{{-- /Container --}}

</td></tr>
</table>
{{-- /Wrapper --}}

</body>
</html>
