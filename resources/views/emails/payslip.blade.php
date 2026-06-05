<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>Payslip — {{ $periodLabel }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          {{-- Header --}}
          <tr>
            <td style="background:linear-gradient(135deg,#5a3fd1,#7c5cfc);padding:26px 32px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:rgba(255,255,255,0.7);text-transform:uppercase;">Payslip</div>
              <div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:4px;">{{ $periodLabel }}</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:2px;">{{ $companyName }}</div>
            </td>
          </tr>

          {{-- Body --}}
          <tr>
            <td style="padding:28px 32px;">
              <p style="font-size:15px;margin:0 0 12px;">Dear {{ $employeeName }},</p>
              <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px;">
                Please find attached your payslip for <strong>{{ $periodLabel }}</strong>. It details your
                earnings, deductions and net salary for the period.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">
                <tr>
                  <td style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px 18px;">
                    <span style="font-size:13px;color:#5a3fd1;font-weight:600;">📎 {{ $periodLabel }} payslip is attached as a PDF.</span>
                  </td>
                </tr>
              </table>
              <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 6px;">
                If you have any questions about your salary, please reach out to HR
                @if($hrEmail)
                  at <a href="mailto:{{ $hrEmail }}" style="color:#5a3fd1;text-decoration:none;">{{ $hrEmail }}</a>
                @endif
                .
              </p>
              <p style="font-size:12px;color:#9ca3af;margin:18px 0 0;">
                This is a confidential document intended solely for {{ $employeeName }}. This is a
                computer-generated payslip and does not require a signature.
              </p>
            </td>
          </tr>

          {{-- Footer --}}
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #eef1f5;">
              <div style="font-size:11px;color:#9ca3af;">© {{ $companyName }}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
