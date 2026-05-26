<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Payment Invoice #{{ $payment->invoice_number }}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    /* Inter loaded for clients that support web fonts (Apple Mail, iOS Mail,
       browser preview). Falls back to Segoe UI / system sans elsewhere. */
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
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
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#111827;">

{{-- Vendor/platform brand. Constant across all tenants. --}}
@php($vendorName = config('app.vendor_name', 'Inorbvict Group of Companies'))

{{-- Preheader --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  Payment received: &#8377;{{ number_format((float) $payment->total, 2) }} for invoice #{{ $payment->invoice_number }}
</div>

{{-- ============ WRAPPER ============ --}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

{{-- ============ CONTAINER ============ --}}
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- ============ HEADER (stacked wordmark + bars subtitle) ============ --}}
  {{-- Split vendor name: first word = big title, rest = subtitle. --}}
  @php($_parts = explode(' ', $vendorName, 2))
  @php($brandMain = strtoupper($_parts[0] ?? $vendorName))
  @php($brandSub = strtoupper(trim($_parts[1] ?? '')))
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #34d399;">

    {{-- Big main word --}}
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>

    @if($brandSub !== '')
    {{-- Subtitle: green bar · GROUP OF COMPANIES · green bar --}}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:10px;">
    <tr>
      <td style="width:34px;height:4px;background-color:#10b981;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 14px;font-size:10.5px;font-weight:700;color:#047857;letter-spacing:3.5px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
      <td style="width:34px;height:4px;background-color:#10b981;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
    </table>
    @endif

  </td></tr>

  {{-- ============ HERO (balanced layered confetti around seal) ============ --}}
  <tr><td style="padding:18px 24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

      {{-- TIER 1 (far top — wide spread, larger pieces) --}}
      <tr><td style="text-align:center;font-size:0;line-height:0;padding-bottom:6px;">
        <span style="color:#10b981;font-size:8px;padding:0 22px;">&#9670;</span>
        <span style="color:#fbbf24;font-size:6px;padding:0 26px;">&#9679;</span>
        <span style="color:#34d399;font-size:9px;padding:0 22px;">&#9670;</span>
        <span style="color:#fde68a;font-size:6px;padding:0 26px;">&#9679;</span>
        <span style="color:#10b981;font-size:8px;padding:0 22px;">&#9670;</span>
      </td></tr>

      {{-- TIER 2 (close above seal — smaller pieces, denser) --}}
      <tr><td style="text-align:center;font-size:0;line-height:0;padding-bottom:6px;">
        <span style="color:#a7f3d0;font-size:5px;padding:0 12px;">&#9679;</span>
        <span style="color:#fbbf24;font-size:6px;padding:0 16px;">&#9670;</span>
        <span style="color:#34d399;font-size:5px;padding:0 14px;">&#9679;</span>
        <span style="color:#fde68a;font-size:7px;padding:0 16px;">&#9670;</span>
        <span style="color:#10b981;font-size:5px;padding:0 14px;">&#9679;</span>
        <span style="color:#fbbf24;font-size:6px;padding:0 16px;">&#9670;</span>
        <span style="color:#a7f3d0;font-size:5px;padding:0 12px;">&#9679;</span>
      </td></tr>

      {{-- SEAL --}}
      <tr><td style="text-align:center;padding:4px 0;">
        <img src="{{ asset('images/email-icons/seal-check.png') }}" alt="Payment confirmed" width="84" height="84"
             style="display:inline-block;border:0;outline:none;text-decoration:none;width:84px;height:84px;" />
      </td></tr>

      {{-- TIER 3 (close below seal — mirrors tier 2) --}}
      <tr><td style="text-align:center;font-size:0;line-height:0;padding-top:6px;">
        <span style="color:#a7f3d0;font-size:5px;padding:0 12px;">&#9679;</span>
        <span style="color:#fbbf24;font-size:6px;padding:0 16px;">&#9670;</span>
        <span style="color:#10b981;font-size:5px;padding:0 14px;">&#9679;</span>
        <span style="color:#fde68a;font-size:7px;padding:0 16px;">&#9670;</span>
        <span style="color:#34d399;font-size:5px;padding:0 14px;">&#9679;</span>
        <span style="color:#fbbf24;font-size:6px;padding:0 16px;">&#9670;</span>
        <span style="color:#a7f3d0;font-size:5px;padding:0 12px;">&#9679;</span>
      </td></tr>

      {{-- TIER 4 (far bottom — mirrors tier 1) --}}
      <tr><td style="text-align:center;font-size:0;line-height:0;padding-top:6px;">
        <span style="color:#fde68a;font-size:6px;padding:0 22px;">&#9679;</span>
        <span style="color:#34d399;font-size:9px;padding:0 26px;">&#9670;</span>
        <span style="color:#fbbf24;font-size:6px;padding:0 22px;">&#9679;</span>
        <span style="color:#10b981;font-size:9px;padding:0 26px;">&#9670;</span>
        <span style="color:#fde68a;font-size:6px;padding:0 22px;">&#9679;</span>
      </td></tr>

    </table>
  </td></tr>

  {{-- ============ HEADLINE ============ --}}
  <tr><td style="padding:16px 32px 4px;text-align:center;">
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.5px;line-height:1.2;">Payment Successful!</h1>
  </td></tr>

  <tr><td style="padding:8px 32px 20px;text-align:center;">
    <p style="margin:0;font-size:13.5px;color:#6b7280;line-height:1.6;">
      Your payment has been received by<br/>
      <strong style="color:#111827;font-weight:700;">{{ $vendorName }}.</strong>
    </p>
  </td></tr>

  {{-- ============ AMOUNT CARD (light green) ============ --}}
  <tr><td style="padding:0 32px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;">
    <tr><td style="padding:22px 24px;text-align:center;">
      <div style="font-size:11px;font-weight:700;color:#059669;letter-spacing:1px;text-transform:uppercase;">Amount Paid</div>
      <div style="font-size:32px;font-weight:800;color:#059669;letter-spacing:-1px;margin-top:8px;line-height:1.1;">&#8377;{{ number_format((float) $payment->total, 2) }}</div>

      {{-- From / To --}}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:14px;">
      <tr><td style="font-size:12.5px;color:#047857;line-height:1.7;text-align:center;">
        <strong style="color:#065f46;font-weight:700;">From:</strong>
        <span style="color:#047857;">{{ $payment->client->org_name ?? 'The Client' }}</span><br/>
        <strong style="color:#065f46;font-weight:700;">To:</strong>
        <span style="color:#047857;">{{ $vendorName }}</span>
      </td></tr>
      </table>
    </td></tr>
    </table>
  </td></tr>

  {{-- ============ PAYMENT SUMMARY CARD ============ --}}
  <tr><td style="padding:0 32px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

      {{-- Card title --}}
      <tr><td colspan="2" style="padding:14px 20px;background-color:#ecfdf5;border-bottom:1px solid #a7f3d0;font-size:13px;font-weight:800;color:#065f46;letter-spacing:-0.2px;">
        Payment Summary
      </td></tr>

      {{-- Plan row --}}
      @if($payment->plan)
      <tr>
        <td style="padding:12px 20px;font-size:12.5px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:42%;">Plan</td>
        <td style="padding:12px 20px;font-size:12.5px;color:#111827;font-weight:700;border-bottom:1px solid #f3f4f6;">
          {{ $payment->plan->name }}@if(!empty($payment->billing_cycle)) <span style="color:#6b7280;font-weight:500;">&middot; {{ ucfirst($payment->billing_cycle) }}</span>@endif
        </td>
      </tr>
      @endif

      {{-- Invoice Number --}}
      <tr>
        <td style="padding:12px 20px;font-size:12.5px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Invoice Number</td>
        <td style="padding:12px 20px;font-size:12.5px;color:#111827;font-weight:700;border-bottom:1px solid #f3f4f6;">{{ $payment->invoice_number }}</td>
      </tr>

      {{-- Payment Date --}}
      <tr>
        <td style="padding:12px 20px;font-size:12.5px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Payment Date</td>
        <td style="padding:12px 20px;font-size:12.5px;color:#111827;font-weight:700;border-bottom:1px solid #f3f4f6;">{{ $payment->created_at->format('d M Y, h:i A') }}</td>
      </tr>

      {{-- Payment Method --}}
      <tr>
        <td style="padding:12px 20px;font-size:12.5px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Payment Method</td>
        <td style="padding:12px 20px;font-size:12.5px;color:#111827;font-weight:700;border-bottom:1px solid #f3f4f6;">{{ str_replace('_', ' ', ucwords($payment->method, '_')) }}</td>
      </tr>

      {{-- Transaction ID --}}
      @if($payment->txn_id)
      <tr>
        <td style="padding:12px 20px;font-size:12.5px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Transaction ID</td>
        <td style="padding:12px 20px;font-size:12.5px;color:#111827;font-weight:700;font-family:'SF Mono','Courier New',monospace;border-bottom:1px solid #f3f4f6;word-break:break-all;">{{ $payment->txn_id }}</td>
      </tr>
      @endif

      {{-- Order ID --}}
      @if($payment->order_id)
      <tr>
        <td style="padding:12px 20px;font-size:12.5px;color:#6b7280;">Order ID</td>
        <td style="padding:12px 20px;font-size:12.5px;color:#111827;font-weight:700;font-family:'SF Mono','Courier New',monospace;word-break:break-all;">{{ $payment->order_id }}</td>
      </tr>
      @endif

    </table>
  </td></tr>

  {{-- ============ CTA ============ --}}
  <tr><td style="padding:8px 32px 22px;text-align:center;">
    @php($invoiceUrl = config('app.url') . '/api/payments/' . $payment->id . '/invoice/view')
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $invoiceUrl }}" style="height:46px;v-text-anchor:middle;width:200px;" arcsize="22%" stroke="f" fillcolor="#10b981">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;">View Invoice &rarr;</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background-color:#10b981;background:linear-gradient(135deg,#10b981 0%,#059669 100%);border-radius:10px;box-shadow:0 4px 14px rgba(16,185,129,0.30);">
      <a href="{{ $invoiceUrl }}" target="_blank" style="display:inline-block;padding:13px 36px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
        View Invoice &nbsp;&rarr;
      </a>
    </td></tr>
    </table>
    <!--<![endif]-->
  </td></tr>

  {{-- ============ FOOTER ============ --}}
  <tr><td style="padding:8px 32px 28px;text-align:center;border-top:1px solid #f3f4f6;">
    <p style="margin:18px 0 10px;font-size:13px;color:#374151;line-height:1.6;">
      Thank you for your payment and continued trust.
    </p>
    <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
      <a href="mailto:{{ config('mail.from.address') }}" style="color:#059669;text-decoration:none;font-weight:600;">{{ config('mail.from.address') }}</a>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <span style="color:#374151;">+91 98765 43210</span>
    </p>
  </td></tr>

</table>
{{-- /Container --}}

</td></tr>
</table>
{{-- /Wrapper --}}

</body>
</html>
