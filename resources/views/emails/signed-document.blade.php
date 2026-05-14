<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>{{ $documentTitle }} — Signed</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:40px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <tr><td style="height:4px;background:linear-gradient(90deg,#16a34a,#22c55e,#86efac);font-size:0;line-height:0;">&nbsp;</td></tr>

  <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0f0f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr>
      <td style="width:40px;height:40px;background:linear-gradient(135deg,#16a34a,#22c55e);border-radius:12px;text-align:center;vertical-align:middle;">
        <span style="font-size:20px;line-height:40px;color:#ffffff;">&#9989;</span>
      </td>
      <td style="padding-left:12px;font-size:18px;font-weight:800;color:#1e293b;letter-spacing:-0.3px;">{{ $appName }}</td>
    </tr>
    </table>
  </td></tr>

  <tr><td style="padding:36px 40px 8px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:16px;">
    <tr><td style="width:64px;height:64px;background:linear-gradient(135deg,#dcfce7,#bbf7d0);border-radius:18px;text-align:center;vertical-align:middle;">
      <span style="font-size:28px;line-height:64px;">&#128221;</span>
    </td></tr>
    </table>
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#1e293b;letter-spacing:-0.4px;">Your Signed Document</h1>
    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
      All signatures have been collected — attached below.
    </p>
  </td></tr>

  <tr><td style="padding:18px 40px 8px;">
    <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">
      Hi <strong style="color:#1e293b;">{{ $recipientName }}</strong>,<br/>
      Your signed copy of <strong style="color:#1e293b;">{{ $documentTitle }}</strong>
      @if($run->code)
        (reference <code style="background:#fef3c7;color:#a16207;padding:1px 6px;border-radius:4px;font-size:12px;">{{ $run->code }}</code>)
      @endif
      from <strong style="color:#1e293b;">{{ $orgName }}</strong> is ready.
    </p>
  </td></tr>

  <tr><td style="padding:8px 40px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
      <tr><td style="padding:12px 14px;">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.4px;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Signing Summary</div>
        @php
          $signers = is_array($run->signers) ? $run->signers : [];
        @endphp
        @foreach($signers as $i => $s)
          <div style="font-size:13px;color:#1e293b;margin-bottom:4px;">
            <strong>#{{ $i + 1 }}</strong>
            {{ $s['name'] ?? ($s['role_name'] ?? 'Signer') }}
            <span style="color:#64748b;">— {{ $s['action'] ?? 'Sign' }}</span>
            @if(($s['status'] ?? '') === 'Done')
              <span style="color:#15803d;font-weight:700;">&nbsp;&#10003; {{ $s['acted_at'] ? \Carbon\Carbon::parse($s['acted_at'])->format('d M Y') : 'Completed' }}</span>
            @endif
          </div>
        @endforeach
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:12px 40px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#ecfdf5,#dcfce7);border-radius:10px;">
      <tr><td style="padding:14px 16px;font-size:13px;color:#166534;">
        &#128206; The signed document is attached as a DOCX file. Please save a copy for your records.
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 40px 36px;text-align:center;font-size:12px;color:#94a3b8;line-height:1.6;">
    This is an automated notification from {{ $appName }}.<br/>
    If anything looks wrong, contact your HR team.
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>
