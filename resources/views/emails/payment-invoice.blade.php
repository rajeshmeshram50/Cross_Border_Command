<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Payment Invoice</title>
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
        <span style="display:inline-block;background:{{ $payment->status === 'success' ? '#ECFDF5' : ($payment->status === 'pending' ? '#FFFBEB' : '#FEF2F2') }};color:{{ $payment->status === 'success' ? '#059669' : ($payment->status === 'pending' ? '#B45309' : '#DC2626') }};font-size:11px;font-weight:700;padding:5px 14px;border-radius:8px;text-transform:uppercase;letter-spacing:0.5px;">{{ $payment->status }}</span>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 40px 20px;">
    <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1e293b;">Hello {{ $payment->client->org_name }},</p>
    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
      @if($payment->status === 'success')
        Your payment has been received successfully. Here are your invoice details.
      @else
        A payment record has been created for your account. Details are below.
      @endif
    </p>
  </td></tr>

  <!-- Amount Card -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:14px;">
    <tr><td style="padding:28px 24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">Amount Paid</p>
      <p style="margin:0;font-size:38px;font-weight:800;color:#ffffff;letter-spacing:-1px;">&#8377;{{ number_format((float)$payment->total, 2) }}</p>
      @if($payment->plan)
      <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">{{ $payment->plan->name }} Plan &middot; {{ ucfirst($payment->billing_cycle ?? 'One-time') }}</p>
      @endif
    </td></tr>
    </table>
  </td></tr>

  <!-- Invoice Details -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td colspan="2" style="background-color:#f8fafc;padding:14px 20px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #e2e8f0;">
          Invoice Details
        </td>
      </tr>
      @php
      $details = [
          ['Invoice Number', $payment->invoice_number],
          ['Date', $payment->created_at->format('d M Y, h:i A')],
          ['Payment Method', str_replace('_', ' ', ucfirst($payment->method))],
          ['Gateway', $payment->gateway ? ucfirst($payment->gateway) : null],
          ['Transaction ID', $payment->txn_id],
          ['Order ID', $payment->order_id],
      ];
      @endphp
      @foreach($details as $detail)
        @if($detail[1])
        <tr>
          <td style="padding:12px 20px;font-size:13px;color:#94a3b8;border-bottom:1px solid #f1f5f9;width:40%;">{{ $detail[0] }}</td>
          <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">{{ $detail[1] }}</td>
        </tr>
        @endif
      @endforeach
    </table>
  </td></tr>

  <!-- Amount Breakdown -->
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td colspan="2" style="background-color:#f8fafc;padding:14px 20px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #e2e8f0;">
          Amount Breakdown
        </td>
      </tr>
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Subtotal</td>
        <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;">&#8377;{{ number_format((float)$payment->amount, 2) }}</td>
      </tr>
      @if($payment->gst && (float)$payment->gst > 0)
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">GST</td>
        <td style="padding:12px 20px;font-size:13px;color:#1e293b;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;">&#8377;{{ number_format((float)$payment->gst, 2) }}</td>
      </tr>
      @endif
      @if($payment->discount && (float)$payment->discount > 0)
      <tr>
        <td style="padding:12px 20px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Discount</td>
        <td style="padding:12px 20px;font-size:13px;color:#059669;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;">-&#8377;{{ number_format((float)$payment->discount, 2) }}</td>
      </tr>
      @endif
      <tr>
        <td style="padding:16px 20px;font-size:15px;color:#4F46E5;font-weight:800;background-color:#f8fafc;">Total</td>
        <td style="padding:16px 20px;font-size:20px;color:#4F46E5;font-weight:800;text-align:right;background-color:#f8fafc;">&#8377;{{ number_format((float)$payment->total, 2) }}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Subscription Validity -->
  @if($payment->valid_from || $payment->valid_until)
  <tr><td style="padding:0 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF2FF;border:1px solid #C7D2FE;border-radius:10px;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 8px;font-size:10px;font-weight:700;color:#4F46E5;text-transform:uppercase;letter-spacing:1.5px;">Subscription Validity</p>
      <p style="margin:0;font-size:14px;color:#312E81;">
        @if($payment->valid_from)
          <strong>From:</strong> {{ $payment->valid_from->format('d M Y') }}
        @endif
        @if($payment->valid_until)
          &nbsp;&nbsp;<strong>Until:</strong> {{ $payment->valid_until->format('d M Y') }}
        @endif
      </p>
    </td></tr>
    </table>
  </td></tr>
  @endif

  <!-- View Invoice Button -->
  <tr><td style="padding:0 40px 28px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:10px;">
      <a href="{{ config('app.url') }}/api/payments/{{ $payment->id }}/invoice/view" target="_blank" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
        View Invoice &rarr;
      </a>
    </td></tr>
    </table>
  </td></tr>

  <!-- Note -->
  <tr><td style="padding:0 40px 28px;">
    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;text-align:center;">
      The invoice PDF is attached to this email. If you have questions regarding this payment, please contact us.
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

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1e293b;">Thank you for your business!</p>
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
