<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.5; }

        .invoice-container { max-width: 800px; margin: 0 auto; padding: 40px; }

        /* Header */
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 3px solid #4F46E5; padding-bottom: 20px; }
        .brand { }
        .brand h1 { font-size: 24px; font-weight: 800; color: #4F46E5; letter-spacing: -0.5px; }
        .brand p { font-size: 11px; color: #64748b; margin-top: 2px; }

        .invoice-meta { text-align: right; }
        .invoice-meta .invoice-label { font-size: 28px; font-weight: 800; color: #4F46E5; text-transform: uppercase; letter-spacing: 2px; }
        .invoice-meta .invoice-number { font-size: 13px; color: #64748b; margin-top: 4px; }

        /* Status Badge */
        .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }
        .status-success { background: #d1fae5; color: #065f46; }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-failed { background: #fee2e2; color: #991b1b; }

        /* Info Sections */
        .info-grid { display: table; width: 100%; margin-bottom: 30px; }
        .info-col { display: table-cell; width: 50%; vertical-align: top; }
        .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-right: 10px; }
        .info-col:last-child .info-box { margin-right: 0; margin-left: 10px; }
        .info-label { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; }
        .info-value { font-size: 13px; font-weight: 600; color: #1e293b; }
        .info-value.small { font-size: 11px; color: #64748b; font-weight: 400; }

        /* Table */
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        .items-table thead th { background: #4F46E5; color: white; padding: 12px 16px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
        .items-table thead th:first-child { border-radius: 8px 0 0 0; }
        .items-table thead th:last-child { border-radius: 0 8px 0 0; text-align: right; }
        .items-table tbody td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        .items-table tbody td:last-child { text-align: right; font-weight: 600; }
        .items-table tbody tr:last-child td { border-bottom: 2px solid #e2e8f0; }

        /* Totals */
        .totals { width: 280px; float: right; }
        .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .total-row.grand { border-top: 2px solid #4F46E5; border-bottom: none; padding: 12px 0; margin-top: 4px; }
        .total-row.grand .total-label, .total-row.grand .total-value { font-size: 18px; font-weight: 800; color: #4F46E5; }
        .total-label { color: #64748b; }
        .total-value { font-weight: 600; color: #1e293b; }

        .clearfix { clear: both; }

        /* Payment Info */
        .payment-info { margin-top: 30px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; }
        .payment-info h4 { font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
        .payment-detail { display: inline-block; margin-right: 30px; margin-bottom: 6px; }
        .payment-detail .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .payment-detail .value { font-size: 12px; font-weight: 600; color: #1e293b; }

        /* Validity */
        .validity-box { margin-top: 20px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; }
        .validity-box h4 { font-size: 11px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }

        /* Footer */
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; }
        .footer p { font-size: 11px; color: #94a3b8; }
        .footer .thank-you { font-size: 16px; font-weight: 700; color: #4F46E5; margin-bottom: 8px; }

        /* Notes */
        .notes { margin-top: 20px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; }
        .notes h4 { font-size: 10px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
        .notes p { font-size: 12px; color: #78350f; }
    </style>
</head>
<body>
    <div class="invoice-container">
        <!-- Header -->
        <div class="header">
            <div class="brand">
                <h1>Cross Border Command</h1>
                <p>Multi-Tenant SaaS Platform</p>
                <p>{{ config('mail.from.address') }}</p>
            </div>
            <div class="invoice-meta">
                <div class="invoice-label">Invoice</div>
                <div class="invoice-number">{{ $payment->invoice_number }}</div>
                <div class="invoice-number">Date: {{ $payment->created_at->format('d M Y') }}</div>
                <div>
                    <span class="status-badge status-{{ $payment->status }}">
                        {{ strtoupper($payment->status) }}
                    </span>
                </div>
            </div>
        </div>

        <!-- Bill To / From -->
        <div class="info-grid">
            <div class="info-col">
                <div class="info-box">
                    <div class="info-label">Bill To</div>
                    <div class="info-value">{{ $payment->client->org_name }}</div>
                    <div class="info-value small">{{ $payment->client->email }}</div>
                    @if($payment->client->phone)
                        <div class="info-value small">{{ $payment->client->phone }}</div>
                    @endif
                    @if($payment->client->address || $payment->client->city)
                        <div class="info-value small">
                            {{ implode(', ', array_filter([$payment->client->address, $payment->client->city, $payment->client->state, $payment->client->pincode])) }}
                        </div>
                    @endif
                    @if($payment->client->gst_number)
                        <div class="info-value small" style="margin-top: 4px;">GST: {{ $payment->client->gst_number }}</div>
                    @endif
                </div>
            </div>
            <div class="info-col">
                <div class="info-box">
                    <div class="info-label">From</div>
                    <div class="info-value">Cross Border Command</div>
                    <div class="info-value small">{{ config('mail.from.address') }}</div>
                    <div class="info-value small" style="margin-top: 8px;">
                        <strong>Invoice #:</strong> {{ $payment->invoice_number }}
                    </div>
                    <div class="info-value small">
                        <strong>Date:</strong> {{ $payment->created_at->format('d M Y, h:i A') }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Items Table -->
        <table class="items-table">
            <thead>
                <tr>
                    <th style="width: 50%">Description</th>
                    <th>Billing Cycle</th>
                    <th>Qty</th>
                    <th>Amount</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
                        <strong>{{ $payment->plan ? $payment->plan->name . ' Plan' : 'Platform Subscription' }}</strong>
                        <br>
                        <span style="font-size: 11px; color: #64748b;">
                            {{ $payment->plan ? 'Subscription plan for ' . $payment->client->org_name : 'Payment for services' }}
                        </span>
                    </td>
                    <td>{{ ucfirst($payment->billing_cycle ?? 'One-time') }}</td>
                    <td>1</td>
                    <td style="font-family: monospace;">{{ number_format((float)$payment->amount, 2) }}</td>
                </tr>
            </tbody>
        </table>

        <!-- Totals -->
        <div class="totals">
            <div class="total-row">
                <span class="total-label">Subtotal</span>
                <span class="total-value" style="font-family: monospace;">₹{{ number_format((float)$payment->amount, 2) }}</span>
            </div>
            @if($payment->gst && (float)$payment->gst > 0)
            <div class="total-row">
                <span class="total-label">GST (18%)</span>
                <span class="total-value" style="font-family: monospace;">₹{{ number_format((float)$payment->gst, 2) }}</span>
            </div>
            @endif
            @if($payment->discount && (float)$payment->discount > 0)
            <div class="total-row">
                <span class="total-label">Discount</span>
                <span class="total-value" style="color: #059669; font-family: monospace;">-₹{{ number_format((float)$payment->discount, 2) }}</span>
            </div>
            @endif
            <div class="total-row grand">
                <span class="total-label">Total</span>
                <span class="total-value">₹{{ number_format((float)$payment->total, 2) }}</span>
            </div>
        </div>
        <div class="clearfix"></div>

        <!-- Payment Details -->
        <div class="payment-info">
            <h4>Payment Information</h4>
            <div class="payment-detail">
                <div class="label">Method</div>
                <div class="value">{{ str_replace('_', ' ', ucfirst($payment->method)) }}</div>
            </div>
            @if($payment->gateway)
            <div class="payment-detail">
                <div class="label">Gateway</div>
                <div class="value">{{ ucfirst($payment->gateway) }}</div>
            </div>
            @endif
            @if($payment->txn_id)
            <div class="payment-detail">
                <div class="label">Transaction ID</div>
                <div class="value">{{ $payment->txn_id }}</div>
            </div>
            @endif
            @if($payment->order_id)
            <div class="payment-detail">
                <div class="label">Order ID</div>
                <div class="value">{{ $payment->order_id }}</div>
            </div>
            @endif
            <div class="payment-detail">
                <div class="label">Currency</div>
                <div class="value">{{ $payment->currency ?? 'INR' }}</div>
            </div>
        </div>

        <!-- Validity -->
        @if($payment->valid_from || $payment->valid_until)
        <div class="validity-box">
            <h4>Subscription Validity</h4>
            <div class="payment-detail">
                <div class="label">Valid From</div>
                <div class="value">{{ $payment->valid_from ? $payment->valid_from->format('d M Y') : 'N/A' }}</div>
            </div>
            <div class="payment-detail">
                <div class="label">Valid Until</div>
                <div class="value">{{ $payment->valid_until ? $payment->valid_until->format('d M Y') : 'N/A' }}</div>
            </div>
            <div class="payment-detail">
                <div class="label">Auto Renewal</div>
                <div class="value">{{ $payment->auto_renew ? 'Yes' : 'No' }}</div>
            </div>
        </div>
        @endif

        <!-- Notes -->
        @if($payment->notes)
        <div class="notes">
            <h4>Notes</h4>
            <p>{{ $payment->notes }}</p>
        </div>
        @endif

        <!-- Footer -->
        <div class="footer">
            <div class="thank-you">Thank you for your business!</div>
            <p>This is a computer-generated invoice and does not require a physical signature.</p>
            <p>For any queries, contact us at {{ config('mail.from.address') }}</p>
        </div>
    </div>
</body>
</html>
