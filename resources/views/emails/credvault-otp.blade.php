@php
  $brandName = $brandName ?? 'Cross Border Command';
  $otpDigits = str_split((string) $otp);
  $unlock = $purpose === 'unlock';
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>CredVault verification code — {{ $brandName }}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f8;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0e7490,#0891b2);padding:22px 28px;color:#ffffff;">
              <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">{{ $brandName }} · CredVault</div>
              <div style="font-size:19px;font-weight:700;margin-top:4px;">{{ $unlock ? 'Critical credential unlock code' : '2-step verification code' }}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 8px;font-size:14px;line-height:1.6;">
              @if ($unlock)
                <p style="margin:0 0 12px;"><b>{{ $requestedBy }}</b> is unlocking <b>{{ $credentialName }}</b> in the Critical Vault. Share this code with them only if you expect the request.</p>
              @else
                <p style="margin:0 0 12px;"><b>{{ $requestedBy }}</b> is linking email 2-step verification{{ $credentialName ? ' to ' : '' }}<b>{{ $credentialName }}</b>. Enter this code in the form to finish.</p>
              @endif
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                @foreach ($otpDigits as $d)
                  <td style="width:42px;height:50px;border:1px solid #cbd5e1;border-radius:9px;background:#f8fafc;text-align:center;font-size:24px;font-weight:700;color:#0f172a;font-family:Consolas,'Courier New',monospace;">{{ $d }}</td>
                  @if (!$loop->last)<td style="width:8px;"></td>@endif
                @endforeach
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;font-size:12.5px;line-height:1.6;color:#64748b;">
              The code expires in {{ $expiryMinutes }} minutes and works once. Requested {{ $requestedAt }} (IST).<br />
              If you did not expect this, ignore the email — nothing opens without the code.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
