@php
  $brandName = $brandName ?? 'Cross Border Command';
  $c = $d['credential'];
  $riskColor = ['low' => '#15803d', 'medium' => '#b45309', 'high' => '#c2410c', 'critical' => '#be123c'][$c['risk']] ?? '#475569';
  $riskBg = ['low' => '#f0fdf4', 'medium' => '#fffbeb', 'high' => '#fff7ed', 'critical' => '#fff1f2'][$c['risk']] ?? '#f1f5f9';
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>Credential shared — {{ $brandName }}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f8;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f8;padding:28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.08);">

          <tr>
            <td style="background:linear-gradient(135deg,#0e7490,#0891b2);padding:22px 26px;color:#ffffff;">
              <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">{{ $brandName }} · CredVault</div>
              <div style="font-size:19px;font-weight:700;margin-top:4px;">{{ $d['renewed'] ? 'A share was updated' : 'A credential was shared with ' . ($d['team'] ? 'your team' : 'you') }}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 26px 6px;font-size:14px;line-height:1.6;">
              <p style="margin:0 0 6px;">Hello{{ $recipient ? ' ' . $recipient : '' }},</p>
              <p style="margin:0;">
                <b>{{ $d['shared_by']['name'] }}</b>{{ $d['shared_by']['designation'] ? ' (' . $d['shared_by']['designation'] . ')' : '' }}
                {{ $d['renewed'] ? 'updated the share of' : 'shared' }} a credential with
                @if ($d['team']) your team <b>{{ $d['team']['name'] }}</b> ({{ $d['team']['members'] }} {{ $d['team']['members'] === 1 ? 'member' : 'members' }}). @else you. @endif
              </p>
            </td>
          </tr>

          {{-- The credential --}}
          <tr>
            <td style="padding:14px 26px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #bfe6ee;border-radius:12px;background:#f0fbfd;">
                <tr>
                  <td style="padding:14px 16px;">
                    <div style="font-size:16px;font-weight:700;color:#0b3b4a;">{{ $c['name'] }}</div>
                    <div style="margin-top:5px;font-size:12.5px;color:#45707f;">
                      <span style="display:inline-block;padding:2px 8px;border:1px solid #9bd7e4;border-radius:6px;background:#fff;color:#0e7490;font-weight:700;">{{ $c['code'] }}</span>
                      &nbsp;{{ $c['type_label'] }}{{ $c['detail'] ? ' · ' . $c['detail'] : '' }} · {{ $c['group'] }}
                    </div>
                  </td>
                  <td align="right" style="padding:14px 16px;white-space:nowrap;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:{{ $riskBg }};color:{{ $riskColor }};font-size:12px;font-weight:700;">● {{ ucfirst($c['risk']) }}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          {{-- Permission & duration --}}
          <tr>
            <td style="padding:16px 26px 4px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64808c;">Permission &amp; duration</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
                <tr>
                  <td style="padding:10px 14px;border:1.5px solid #0891b2;border-radius:12px;background:#ffffff;">
                    <div style="font-size:14.5px;font-weight:700;color:#0e7490;">{{ $permLabel }}</div>
                    <div style="font-size:12.5px;color:#64808c;">{{ $permDesc }}</div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:12px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64808c;margin-bottom:6px;">What you can do</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  @foreach (array_chunk($can, 2, true) as $pair)
                    <tr>
                      @foreach ($pair as $label => $yes)
                        <td width="50%" style="padding:3px 0;font-size:13px;color:{{ $yes ? '#0f2e3a' : '#94a3b8' }};">
                          <span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;font-size:11px;font-weight:700;color:#fff;background:{{ $yes ? '#0891b2' : '#cbd5e1' }};">{{ $yes ? '✓' : '×' }}</span>
                          &nbsp;{{ $label }}
                        </td>
                      @endforeach
                    </tr>
                  @endforeach
                </table>
              </div>
              <div style="margin-top:12px;padding:10px 14px;border:1px dashed #9bd7e4;border-radius:12px;font-size:13px;color:#0f2e3a;">
                @if ($d['until'])
                  🕒 <b>{{ $permLabel }}</b> access until <b>{{ $d['until'] }}</b>, then revoked automatically.
                @else
                  🕒 <b>{{ $permLabel }}</b> access with no end date — the owner can revoke it any time.
                @endif
              </div>
            </td>
          </tr>

          {{-- Reason --}}
          @if ($d['reason'])
            <tr>
              <td style="padding:14px 26px 4px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64808c;">Reason for sharing</div>
                <div style="margin-top:6px;padding:10px 14px;border-left:3px solid #0891b2;background:#f8fafc;font-size:13.5px;color:#0f2e3a;">{{ $d['reason'] }}</div>
              </td>
            </tr>
          @endif

          <tr>
            <td align="center" style="padding:20px 26px 6px;">
              <a href="{{ $d['open_url'] }}" style="display:inline-block;padding:11px 24px;border-radius:10px;background:#0e7490;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Open in CredVault</a>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 26px 22px;font-size:12px;line-height:1.6;color:#64748b;">
              Shared {{ $d['shared_at'] }} (IST). The password is not in this email — it opens only in CredVault, where every view and copy is audit-logged.
              @if ($c['risk'] === 'critical') This is a critical credential: opening it needs the unlock approvals. @endif
              Every share can be revoked any time.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
