<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
    <style>
        @page {
            margin: 0;
            size: A4;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: DejaVu Sans, sans-serif;
            color: #2d3748;
            font-size: 11px;
            line-height: 1.4;
            background: #ffffff;
        }
        .page {
            width: 100%;
            height: 100%;
            position: relative;
        }
        /* Top bar */
        .top-bar {
            width: 100%;
            height: 5px;
            background-color: #4F46E5;
        }
    </style>
</head>
<body>
    <div class="page">
        <!-- Top Color Bar -->
        <div class="top-bar"></div>

        <!-- Main Content -->
        <div style="padding: 36px 44px 30px;">

            <!-- ═══════════════════════════════════════════════ -->
            <!-- HEADER: Logo + Invoice Title                    -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                    <td style="vertical-align: top; width: 50%;">
                        <img src="{{ public_path('images/igc-logo.png') }}" alt="Logo" style="height: 44px; width: auto; margin-bottom: 8px;" />
                        <div style="font-size: 10px; color: #718096; line-height: 1.6; margin-top: 4px;">
                            {{ config('mail.from.address') }}<br/>
                            {{ config('app.url') }}
                        </div>
                    </td>
                    <td style="vertical-align: top; text-align: right;">
                        <div style="font-size: 32px; font-weight: bold; color: #4F46E5; letter-spacing: 4px;">INVOICE</div>
                        <div style="margin-top: 10px;">
                            <span style="display: inline-block; padding: 4px 16px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;
                                @if($payment->status === 'success')
                                    background-color: #C6F6D5; color: #22543D;
                                @elseif($payment->status === 'pending')
                                    background-color: #FEFCBF; color: #744210;
                                @else
                                    background-color: #FED7D7; color: #9B2C2C;
                                @endif
                            ">{{ strtoupper($payment->status) }}</span>
                        </div>
                    </td>
                </tr>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- INVOICE META: Number + Date                     -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border-bottom: 2px solid #E2E8F0; padding-bottom: 16px;">
                <tr>
                    <td style="width: 50%;">
                        <table cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="padding-right: 48px;">
                                    <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px;">Invoice No</div>
                                    <div style="font-size: 13px; font-weight: bold; color: #1a202c;">{{ $payment->invoice_number }}</div>
                                </td>
                                <td>
                                    <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px;">Date</div>
                                    <div style="font-size: 13px; font-weight: bold; color: #1a202c;">{{ $payment->created_at->format('d M Y') }}</div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- BILL TO / BILL FROM                             -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                    <td width="48%" style="vertical-align: top;">
                        <div style="background-color: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px 18px;">
                            <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">Bill To</div>
                            <div style="font-size: 14px; font-weight: bold; color: #1a202c; margin-bottom: 6px;">{{ $payment->client->org_name }}</div>
                            <div style="font-size: 10px; color: #718096; line-height: 1.7;">
                                {{ $payment->client->email }}<br/>
                                @if($payment->client->phone)
                                    {{ $payment->client->phone }}<br/>
                                @endif
                                @if($payment->client->address || $payment->client->city)
                                    {{ implode(', ', array_filter([$payment->client->address, $payment->client->city, $payment->client->state])) }}<br/>
                                @endif
                                @if($payment->client->pincode)
                                    {{ $payment->client->pincode }}<br/>
                                @endif
                                @if($payment->client->gst_number)
                                    <strong style="color: #4A5568;">GST:</strong> {{ $payment->client->gst_number }}
                                @endif
                            </div>
                        </div>
                    </td>
                    <td width="4%"></td>
                    <td width="48%" style="vertical-align: top;">
                        <div style="background-color: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px 18px;">
                            <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">Bill From</div>
                            <div style="font-size: 14px; font-weight: bold; color: #1a202c; margin-bottom: 6px;">Cross Border Command</div>
                            <div style="font-size: 10px; color: #718096; line-height: 1.7;">
                                {{ config('mail.from.address') }}<br/>
                                {{ config('app.url') }}
                            </div>
                        </div>
                    </td>
                </tr>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- ITEMS TABLE                                     -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 0; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="background-color: #1a202c; color: #ffffff; padding: 11px 14px; text-align: left; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; width: 6%;">#</th>
                        <th style="background-color: #1a202c; color: #ffffff; padding: 11px 14px; text-align: left; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; width: 40%;">Description</th>
                        <th style="background-color: #1a202c; color: #ffffff; padding: 11px 14px; text-align: center; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; width: 14%;">Cycle</th>
                        <th style="background-color: #1a202c; color: #ffffff; padding: 11px 14px; text-align: center; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; width: 10%;">Qty</th>
                        <th style="background-color: #1a202c; color: #ffffff; padding: 11px 14px; text-align: right; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; width: 15%;">Price</th>
                        <th style="background-color: #1a202c; color: #ffffff; padding: 11px 14px; text-align: right; font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; width: 15%;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 14px; border-bottom: 1px solid #EDF2F7; font-size: 11px; color: #718096;">1.</td>
                        <td style="padding: 14px; border-bottom: 1px solid #EDF2F7;">
                            <div style="font-size: 12px; font-weight: bold; color: #1a202c;">{{ $payment->plan ? $payment->plan->name . ' Plan' : 'Platform Subscription' }}</div>
                            <div style="font-size: 9px; color: #A0AEC0; margin-top: 2px;">Subscription for {{ $payment->client->org_name }}</div>
                        </td>
                        <td style="padding: 14px; border-bottom: 1px solid #EDF2F7; text-align: center; font-size: 11px; color: #4A5568;">{{ ucfirst($payment->billing_cycle ?? 'One-time') }}</td>
                        <td style="padding: 14px; border-bottom: 1px solid #EDF2F7; text-align: center; font-size: 11px; color: #4A5568;">1</td>
                        <td style="padding: 14px; border-bottom: 1px solid #EDF2F7; text-align: right; font-size: 11px; font-weight: bold; color: #1a202c;">₹{{ number_format((float)$payment->amount, 2) }}</td>
                        <td style="padding: 14px; border-bottom: 1px solid #EDF2F7; text-align: right; font-size: 11px; font-weight: bold; color: #1a202c;">₹{{ number_format((float)$payment->amount, 2) }}</td>
                    </tr>
                </tbody>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- TOTALS (Right Aligned)                          -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                    <td width="55%"></td>
                    <td width="45%">
                        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                            <tr>
                                <td style="padding: 10px 14px; font-size: 11px; color: #718096; border-bottom: 1px solid #EDF2F7;">Subtotal</td>
                                <td style="padding: 10px 14px; font-size: 11px; font-weight: bold; color: #1a202c; text-align: right; border-bottom: 1px solid #EDF2F7;">₹{{ number_format((float)$payment->amount, 2) }}</td>
                            </tr>
                            @if($payment->gst && (float)$payment->gst > 0)
                            <tr>
                                <td style="padding: 10px 14px; font-size: 11px; color: #718096; border-bottom: 1px solid #EDF2F7;">GST (18%)</td>
                                <td style="padding: 10px 14px; font-size: 11px; font-weight: bold; color: #1a202c; text-align: right; border-bottom: 1px solid #EDF2F7;">₹{{ number_format((float)$payment->gst, 2) }}</td>
                            </tr>
                            @endif
                            @if($payment->discount && (float)$payment->discount > 0)
                            <tr>
                                <td style="padding: 10px 14px; font-size: 11px; color: #718096; border-bottom: 1px solid #EDF2F7;">Discount</td>
                                <td style="padding: 10px 14px; font-size: 11px; font-weight: bold; color: #38A169; text-align: right; border-bottom: 1px solid #EDF2F7;">-₹{{ number_format((float)$payment->discount, 2) }}</td>
                            </tr>
                            @endif
                            <tr>
                                <td style="padding: 14px; font-size: 14px; font-weight: bold; color: #4F46E5; background-color: #EBF4FF; border-bottom: 3px solid #4F46E5;">Total</td>
                                <td style="padding: 14px; font-size: 18px; font-weight: bold; color: #4F46E5; text-align: right; background-color: #EBF4FF; border-bottom: 3px solid #4F46E5;">₹{{ number_format((float)$payment->total, 2) }}</td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- PAYMENT INFORMATION                             -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px; border: 1px solid #E2E8F0; border-collapse: collapse;">
                <tr>
                    <td colspan="4" style="padding: 10px 16px; font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1.5px; background-color: #F7FAFC; border-bottom: 1px solid #E2E8F0;">Payment Information</td>
                </tr>
                <tr>
                    <td style="padding: 12px 16px; width: 25%; border-right: 1px solid #EDF2F7;">
                        <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Method</div>
                        <div style="font-size: 11px; font-weight: bold; color: #1a202c;">{{ str_replace('_', ' ', ucfirst($payment->method)) }}</div>
                    </td>
                    @if($payment->gateway)
                    <td style="padding: 12px 16px; width: 25%; border-right: 1px solid #EDF2F7;">
                        <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Gateway</div>
                        <div style="font-size: 11px; font-weight: bold; color: #1a202c;">{{ ucfirst($payment->gateway) }}</div>
                    </td>
                    @endif
                    @if($payment->txn_id)
                    <td style="padding: 12px 16px; width: 25%; border-right: 1px solid #EDF2F7;">
                        <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Transaction ID</div>
                        <div style="font-size: 10px; font-weight: bold; color: #1a202c;">{{ $payment->txn_id }}</div>
                    </td>
                    @endif
                    <td style="padding: 12px 16px; width: 25%;">
                        <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Currency</div>
                        <div style="font-size: 11px; font-weight: bold; color: #1a202c;">{{ $payment->currency ?? 'INR' }}</div>
                    </td>
                </tr>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- SUBSCRIPTION VALIDITY                           -->
            <!-- ═══════════════════════════════════════════════ -->
            @if($payment->valid_from || $payment->valid_until)
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px; border: 1px solid #C3DAFE; border-collapse: collapse;">
                <tr>
                    <td colspan="3" style="padding: 10px 16px; font-size: 8px; font-weight: bold; color: #4F46E5; text-transform: uppercase; letter-spacing: 1.5px; background-color: #EBF8FF; border-bottom: 1px solid #C3DAFE;">Subscription Validity</td>
                </tr>
                <tr>
                    <td style="padding: 12px 16px; width: 33%; border-right: 1px solid #E2E8F0;">
                        <div style="font-size: 8px; font-weight: bold; color: #4F46E5; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Valid From</div>
                        <div style="font-size: 11px; font-weight: bold; color: #2D3748;">{{ $payment->valid_from ? $payment->valid_from->format('d M Y') : 'N/A' }}</div>
                    </td>
                    <td style="padding: 12px 16px; width: 33%; border-right: 1px solid #E2E8F0;">
                        <div style="font-size: 8px; font-weight: bold; color: #4F46E5; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Valid Until</div>
                        <div style="font-size: 11px; font-weight: bold; color: #2D3748;">{{ $payment->valid_until ? $payment->valid_until->format('d M Y') : 'N/A' }}</div>
                    </td>
                    <td style="padding: 12px 16px; width: 34%;">
                        <div style="font-size: 8px; font-weight: bold; color: #4F46E5; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Auto Renewal</div>
                        <div style="font-size: 11px; font-weight: bold; color: #2D3748;">{{ $payment->auto_renew ? 'Yes' : 'No' }}</div>
                    </td>
                </tr>
            </table>
            @endif

            <!-- ═══════════════════════════════════════════════ -->
            <!-- NOTES                                           -->
            <!-- ═══════════════════════════════════════════════ -->
            @if($payment->notes)
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px; border: 1px solid #FEFCBF;">
                <tr>
                    <td style="padding: 14px 16px; background-color: #FFFFF0;">
                        <div style="font-size: 8px; font-weight: bold; color: #B7791F; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px;">Notes</div>
                        <div style="font-size: 10px; color: #744210; line-height: 1.6;">{{ $payment->notes }}</div>
                    </td>
                </tr>
            </table>
            @endif

            <!-- ═══════════════════════════════════════════════ -->
            <!-- AMOUNT IN WORDS (Optional professional touch)   -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                    <td style="border-top: 1px solid #E2E8F0; border-bottom: 1px solid #E2E8F0; padding: 10px 0;">
                        <div style="font-size: 8px; font-weight: bold; color: #A0AEC0; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 2px;">Amount in Words</div>
                        <div style="font-size: 11px; color: #2D3748; font-style: italic;">
                            @php
                                $totalAmount = (float)$payment->total;
                                $rupees = floor($totalAmount);
                                $paise = round(($totalAmount - $rupees) * 100);
                                $formatter = new \NumberFormatter('en_IN', \NumberFormatter::SPELLOUT);
                                $words = ucfirst($formatter->format($rupees)) . ' Rupees';
                                if ($paise > 0) {
                                    $words .= ' and ' . ucfirst($formatter->format($paise)) . ' Paise';
                                }
                                $words .= ' Only';
                            @endphp
                            {{ $words }}
                        </div>
                    </td>
                </tr>
            </table>

            <!-- ═══════════════════════════════════════════════ -->
            <!-- FOOTER                                          -->
            <!-- ═══════════════════════════════════════════════ -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 10px;">
                <tr>
                    <td width="50%" style="vertical-align: bottom;">
                        <div style="font-size: 9px; color: #A0AEC0; line-height: 1.7;">
                            This is a computer-generated invoice<br/> and does not require a physical signature.
                        </div>
                    </td>
                    <td width="50%" style="text-align: right; vertical-align: bottom;">
                        <div style="border-top: 1px solid #2D3748; display: inline-block; padding-top: 6px; width: 180px; text-align: center;">
                            <div style="font-size: 10px; font-weight: bold; color: #2D3748;">Authorized Signatory</div>
                            <div style="font-size: 9px; color: #718096;">Cross Border Command</div>
                        </div>
                    </td>
                </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px; border-top: 2px solid #E2E8F0; padding-top: 16px;">
                <tr>
                    <td style="text-align: center;">
                        <div style="font-size: 13px; font-weight: bold; color: #4F46E5; margin-bottom: 4px;">Thank you for your business!</div>
                        <div style="font-size: 9px; color: #A0AEC0;">
                            For any queries, contact us at {{ config('mail.from.address') }} | {{ config('app.url') }}
                        </div>
                    </td>
                </tr>
            </table>

        </div>

        <!-- Bottom Color Bar -->
        <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 5px; background-color: #4F46E5;"></div>
    </div>
</body>
</html>
