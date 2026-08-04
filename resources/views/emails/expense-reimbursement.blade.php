<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>Reimbursement processed &mdash; {{ $orgName }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
@php
  $cur = $claim->currency ?: 'INR';
  $sym = $cur === 'INR' ? '₹' : ($cur . ' ');
  $money = fn ($n) => $sym . number_format((float) $n, 2);
  $code = $claim->claim_no ?: ('EXP-' . $claim->id);
  $reimbId  = '#' . $claim->id;
  $claimed   = (float) $claim->amount;
  $additions = (float) $claim->addition_amount;
  $deducts   = (float) $claim->deduction_amount;
  $netPaid   = (float) ($claim->sanctioned_amount ?? ($claimed + $additions - $deducts));
  $settledOn = $claim->settled_at ?: optional($claim->payments->last())->paid_at;
  $payModes  = $claim->payments->pluck('payment_type')->filter()->unique()->implode(', ');
  $parts     = explode(' ', $orgName, 2);
  $brandMain = strtoupper($parts[0] ?? $orgName);
  $brandSub  = strtoupper(trim($parts[1] ?? ''));
@endphp
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;color:#111827;">

<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  Your reimbursement request {{ $code }} has been successfully settled &mdash; {{ $money($netPaid) }}.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #06b6d4;">
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>
    @if($brandSub !== '')
    <div style="margin-top:8px;font-size:10.5px;font-weight:700;color:#0891b2;letter-spacing:3px;text-transform:uppercase;">{{ $brandSub }}</div>
    @endif
  </td></tr>

  <tr><td style="padding:30px 32px 10px;text-align:center;">
    <div style="font-size:46px;line-height:1;">&#128176;</div>
    <h1 style="margin:14px 0 0;font-size:24px;font-weight:800;color:#0e7490;line-height:1.15;">Reimbursement Settled</h1>
    <p style="margin:8px 0 0;font-size:13.5px;color:#6b7280;line-height:1.6;">
      Your reimbursement request has been successfully settled.
    </p>
  </td></tr>

  <tr><td style="padding:16px 32px 6px;">
    <p style="margin:0;font-size:14.5px;font-weight:700;color:#111827;">Dear {{ $employeeName }},</p>
  </td></tr>
  <tr><td style="padding:6px 32px 16px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      Your reimbursement request has been successfully settled. The details of the settlement are given below.
    </p>
  </td></tr>

  <tr><td style="padding:0 32px 4px;">
    <div style="font-size:11px;font-weight:800;letter-spacing:.05em;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Settlement Details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
      <tr><td style="padding:10px 14px;color:#6b7280;background:#f9fafb;width:46%;">Reimbursement ID</td><td style="padding:10px 14px;text-align:right;font-weight:700;background:#f9fafb;">{{ $reimbId }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Expense Claim Number</td><td style="padding:10px 14px;text-align:right;font-weight:700;border-top:1px solid #eef2f7;">{{ $code }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Settled Amount</td><td style="padding:10px 14px;text-align:right;font-weight:700;border-top:1px solid #eef2f7;">{{ $money($netPaid) }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Settlement Date</td><td style="padding:10px 14px;text-align:right;font-weight:700;border-top:1px solid #eef2f7;">{{ optional($settledOn)->format('d-M-Y') ?: '—' }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Payment Mode</td><td style="padding:10px 14px;text-align:right;font-weight:700;border-top:1px solid #eef2f7;">{{ $payModes ?: '—' }}</td></tr>
    </table>
  </td></tr>

  @if($additions > 0 || $deducts > 0)
  <tr><td style="padding:16px 32px 4px;">
    <div style="font-size:11px;font-weight:800;letter-spacing:.05em;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Amount Breakdown</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
      <tr><td style="padding:10px 14px;color:#6b7280;background:#f9fafb;">Claimed Amount</td><td style="padding:10px 14px;text-align:right;font-weight:700;background:#f9fafb;">{{ $money($claimed) }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Additions (+)</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#059669;border-top:1px solid #eef2f7;">+ {{ $money($additions) }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Deductions (&minus;)</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#e11d48;border-top:1px solid #eef2f7;">&minus; {{ $money($deducts) }}</td></tr>
      <tr><td style="padding:12px 14px;font-weight:800;color:#0f172a;border-top:2px solid #cffafe;background:#f0fdff;">Net Settled</td><td style="padding:12px 14px;text-align:right;font-weight:800;color:#0e7490;border-top:2px solid #cffafe;background:#f0fdff;">{{ $money($netPaid) }}</td></tr>
    </table>
  </td></tr>
  @endif

  <tr><td style="padding:18px 32px 4px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      The approved reimbursement amount has been processed and settled. If the payment has already been initiated,
      it will be credited to your registered account as per the standard processing timeline.
    </p>
  </td></tr>
  <tr><td style="padding:12px 32px 4px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      If you have any questions or notice any discrepancy in the settlement amount, please contact the HR or Finance team
      and quote reference <strong style="color:#111827;">{{ $code }}</strong>.
    </p>
  </td></tr>

  @if(count($proofFiles))
  <tr><td style="padding:12px 32px 0;">
    <p style="margin:0;font-size:12.5px;color:#6b7280;line-height:1.6;">
      The payment {{ count($proofFiles) === 1 ? 'receipt is' : 'receipts are' }} attached to this email for your records.
    </p>
  </td></tr>
  @endif

  <tr><td style="padding:22px 32px 6px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">Thank you.</p>
    <p style="margin:16px 0 0;font-size:14px;color:#374151;line-height:1.6;">
      Best regards,<br />
      <strong style="color:#111827;">{{ $orgName }}</strong><br />
      HR &amp; Finance Team
    </p>
  </td></tr>

  <tr><td style="padding:16px 32px 26px;text-align:center;border-top:1px solid #f3f4f6;">
    <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      This is an automated confirmation from {{ $orgName }} &mdash; please do not reply to this email.
    </p>
    <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;">
      &copy; {{ date('Y') }} <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong>. All rights reserved.
    </p>
  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>
