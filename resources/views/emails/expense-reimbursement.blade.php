<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>Reimbursement processed &mdash; {{ $orgName }}</title>
</head>
@php
  $cur = $claim->currency ?: 'INR';
  $sym = $cur === 'INR' ? '₹' : ($cur . ' ');
  $money = fn ($n) => $sym . number_format((float) $n, 2);
  $code = $claim->claim_no ?: ('EXP-' . $claim->id);
  $claimed   = (float) $claim->amount;
  $additions = (float) $claim->addition_amount;
  $deducts   = (float) $claim->deduction_amount;
  $netPaid   = (float) ($claim->sanctioned_amount ?? ($claimed + $additions - $deducts));
  $parts     = explode(' ', $orgName, 2);
  $brandMain = strtoupper($parts[0] ?? $orgName);
  $brandSub  = strtoupper(trim($parts[1] ?? ''));
@endphp
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;color:#111827;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #06b6d4;">
    <div style="font-size:26px;font-weight:800;color:#0f172a;letter-spacing:5px;text-transform:uppercase;">{{ $brandMain }}</div>
    @if($brandSub !== '')
      <div style="margin-top:6px;font-size:10.5px;font-weight:700;color:#0891b2;letter-spacing:3px;text-transform:uppercase;">{{ $brandSub }}</div>
    @endif
  </td></tr>

  <tr><td style="padding:30px 32px 6px;text-align:center;">
    <div style="font-size:44px;line-height:1;">&#128176;</div>
    <h1 style="margin:14px 0 0;font-size:23px;font-weight:800;color:#0e7490;">Reimbursement Processed</h1>
    <p style="margin:8px 0 0;font-size:13.5px;color:#6b7280;line-height:1.6;">
      Hi {{ $employeeName }}, your expense claim <b>{{ $code }}</b>@if($claim->title) — “{{ $claim->title }}”@endif has been fully paid.
    </p>
  </td></tr>

  <tr><td style="padding:22px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
      <tr><td style="padding:10px 14px;color:#6b7280;background:#f9fafb;">Claimed Amount</td><td style="padding:10px 14px;text-align:right;font-weight:700;background:#f9fafb;">{{ $money($claimed) }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Additions (+)</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#059669;border-top:1px solid #eef2f7;">+ {{ $money($additions) }}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef2f7;">Deductions (−)</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#e11d48;border-top:1px solid #eef2f7;">− {{ $money($deducts) }}</td></tr>
      <tr><td style="padding:12px 14px;font-weight:800;color:#0f172a;border-top:2px solid #cffafe;background:#f0fdff;">Net Paid</td><td style="padding:12px 14px;text-align:right;font-weight:800;color:#0e7490;border-top:2px solid #cffafe;background:#f0fdff;">{{ $money($netPaid) }}</td></tr>
    </table>
  </td></tr>

  @if($claim->payments && $claim->payments->count())
  <tr><td style="padding:16px 32px 6px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Payments</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:12.5px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <tr style="background:#0e7490;color:#fff;">
        <td style="padding:8px 12px;font-weight:700;">Amount</td>
        <td style="padding:8px 12px;font-weight:700;">Method</td>
        <td style="padding:8px 12px;font-weight:700;">Date</td>
      </tr>
      @foreach($claim->payments as $p)
      <tr>
        <td style="padding:8px 12px;font-weight:700;border-top:1px solid #eef2f7;">{{ $money($p->amount) }}</td>
        <td style="padding:8px 12px;border-top:1px solid #eef2f7;">{{ $p->payment_type ?: '—' }}</td>
        <td style="padding:8px 12px;border-top:1px solid #eef2f7;">{{ optional($p->paid_at)->format('d-M-Y') ?: '—' }}</td>
      </tr>
      @endforeach
    </table>
  </td></tr>
  @endif

  @if(count($proofFiles))
  <tr><td style="padding:12px 32px 0;">
    <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
      The payment proof{{ count($proofFiles) === 1 ? '' : 's' }} {{ count($proofFiles) === 1 ? 'is' : 'are' }} attached to this email.
    </p>
  </td></tr>
  @endif

  <tr><td style="padding:22px 32px 30px;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
      This is an automated confirmation from {{ $orgName }}. If anything looks incorrect, please contact HR / Finance.
    </p>
  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>
