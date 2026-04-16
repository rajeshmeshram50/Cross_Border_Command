<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; }
    </style>
</head>
<body style="background: #f1f5f9; padding: 40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
        <!-- Header -->
        <tr>
            <td style="background: linear-gradient(135deg, #4F46E5, #7C3AED); border-radius: 16px 16px 0 0; padding: 32px 32px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td>
                            <h1 style="font-size: 22px; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.5px;">Cross Border Command</h1>
                            <p style="font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px;">Payment Invoice</p>
                        </td>
                        <td style="text-align: right; vertical-align: top;">
                            <span style="display: inline-block; background: rgba(255,255,255,0.2); color: #fff; font-size: 10px; font-weight: 700; padding: 5px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px;">
                                {{ strtoupper($payment->status) }}
                            </span>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>

        <!-- Body -->
        <tr>
            <td style="background: #fff; padding: 32px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
                <!-- Greeting -->
                <p style="font-size: 15px; color: #1e293b; font-weight: 600; margin-bottom: 6px;">
                    Hello {{ $payment->client->org_name }},
                </p>
                <p style="font-size: 13px; color: #64748b; margin-bottom: 24px; line-height: 1.6;">
                    @if($payment->status === 'success')
                        Your payment has been received successfully. Please find your invoice details below.
                    @else
                        A payment record has been created for your account. Details are below.
                    @endif
                </p>

                <!-- Amount Card -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr>
                        <td style="background: linear-gradient(135deg, #059669, #10b981); border-radius: 12px; padding: 24px; text-align: center;">
                            <p style="font-size: 11px; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 2px; font-weight: 700; margin-bottom: 8px;">Amount Paid</p>
                            <p style="font-size: 36px; font-weight: 800; color: #fff; letter-spacing: -1px;">₹{{ number_format((float)$payment->total, 2) }}</p>
                            @if($payment->plan)
                                <p style="font-size: 12px; color: rgba(255,255,255,0.8); margin-top: 6px;">{{ $payment->plan->name }} Plan · {{ ucfirst($payment->billing_cycle ?? 'One-time') }}</p>
                            @endif
                        </td>
                    </tr>
                </table>

                <!-- Invoice Details -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                    <tr>
                        <td colspan="2" style="background: #f8fafc; padding: 12px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #e2e8f0;">
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
                            <td style="padding: 10px 16px; font-size: 12px; color: #94a3b8; border-bottom: 1px solid #f1f5f9; width: 40%;">{{ $detail[0] }}</td>
                            <td style="padding: 10px 16px; font-size: 12px; color: #1e293b; font-weight: 600; border-bottom: 1px solid #f1f5f9;">{{ $detail[1] }}</td>
                        </tr>
                        @endif
                    @endforeach
                </table>

                <!-- Breakdown -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                    <tr>
                        <td colspan="2" style="background: #f8fafc; padding: 12px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #e2e8f0;">
                            Amount Breakdown
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 16px; font-size: 12px; color: #64748b; border-bottom: 1px solid #f1f5f9;">Subtotal</td>
                        <td style="padding: 10px 16px; font-size: 12px; color: #1e293b; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">₹{{ number_format((float)$payment->amount, 2) }}</td>
                    </tr>
                    @if($payment->gst && (float)$payment->gst > 0)
                    <tr>
                        <td style="padding: 10px 16px; font-size: 12px; color: #64748b; border-bottom: 1px solid #f1f5f9;">GST</td>
                        <td style="padding: 10px 16px; font-size: 12px; color: #1e293b; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">₹{{ number_format((float)$payment->gst, 2) }}</td>
                    </tr>
                    @endif
                    @if($payment->discount && (float)$payment->discount > 0)
                    <tr>
                        <td style="padding: 10px 16px; font-size: 12px; color: #64748b; border-bottom: 1px solid #f1f5f9;">Discount</td>
                        <td style="padding: 10px 16px; font-size: 12px; color: #059669; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">-₹{{ number_format((float)$payment->discount, 2) }}</td>
                    </tr>
                    @endif
                    <tr>
                        <td style="padding: 14px 16px; font-size: 14px; color: #4F46E5; font-weight: 800;">Total</td>
                        <td style="padding: 14px 16px; font-size: 18px; color: #4F46E5; font-weight: 800; text-align: right;">₹{{ number_format((float)$payment->total, 2) }}</td>
                    </tr>
                </table>

                <!-- Validity -->
                @if($payment->valid_from || $payment->valid_until)
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px;">
                    <tr>
                        <td style="padding: 16px;">
                            <p style="font-size: 11px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Subscription Validity</p>
                            <p style="font-size: 13px; color: #1e3a5f;">
                                @if($payment->valid_from)
                                    <strong>From:</strong> {{ $payment->valid_from->format('d M Y') }}
                                @endif
                                @if($payment->valid_until)
                                    &nbsp;&nbsp;<strong>Until:</strong> {{ $payment->valid_until->format('d M Y') }}
                                @endif
                            </p>
                        </td>
                    </tr>
                </table>
                @endif

                <p style="font-size: 12px; color: #94a3b8; line-height: 1.6;">
                    The invoice PDF is attached to this email for your records. If you have any questions regarding this payment, please don't hesitate to contact us.
                </p>
            </td>
        </tr>

        <!-- Footer -->
        <tr>
            <td style="background: #1e293b; border-radius: 0 0 16px 16px; padding: 24px 32px; text-align: center;">
                <p style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px;">Thank you for choosing Cross Border Command!</p>
                <p style="font-size: 11px; color: #94a3b8;">This is an automated email. Please do not reply directly.</p>
                <p style="font-size: 11px; color: #64748b; margin-top: 8px;">{{ config('mail.from.address') }} | {{ config('app.url') }}</p>
            </td>
        </tr>
    </table>
</body>
</html>
