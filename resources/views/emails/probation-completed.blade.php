<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>Congratulations! Probation Period Successfully Completed &mdash; {{ $orgName }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;">

{{-- Hidden pre-header --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4f5f7;">
  {{ $employeeName }}, your probation period at {{ $orgName }} is complete — your employment is now confirmed.
</div>

@php
  $effHtml = trim($effectiveDate) !== ''
    ? ', effective <strong style="color:#1f2937;">' . e($effectiveDate) . '</strong>'
    : '';
  $roleHtml = (trim($designation) !== '' || trim($department) !== '')
    ? ' as a <strong style="color:#1f2937;">' . e($designation ?: 'permanent employee') . '</strong>'
        . (trim($department) !== '' ? ' in the <strong style="color:#1f2937;">' . e($department) . '</strong>' : '')
    : '';
@endphp

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;padding:36px 16px;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,0.08);">

  {{-- ── Brand header — halftone dot design in the TOP-RIGHT corner, with the
       org-name wordmark (accent bar + subline) on the left. ───────────────── --}}
  <tr>
    <td style="padding:0;position:relative;background-color:#ffffff;background-image:url('{{ $dotsUrl }}');background-repeat:no-repeat;background-position:top right;">
      {{-- Fallback for clients that drop background images on <td>. --}}
      <img src="{{ $dotsUrl }}" alt="" width="102" height="102" style="position:absolute;top:0;right:0;border:0;display:block;" />
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:30px 116px 18px 40px;">
            @if(!empty($logoUrl))
              <img src="{{ $logoUrl }}" alt="{{ $orgName }}" height="30" style="display:block;max-height:30px;border:0;" />
            @else
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:6px;background-color:#f97316;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="font-size:20px;font-weight:900;color:#1f2937;letter-spacing:-0.4px;line-height:1.2;">{{ $orgName }}</div>
                    <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.4px;margin-top:2px;">Human Resources</div>
                  </td>
                </tr>
              </table>
            @endif
          </td>
        </tr>
      </table>
    </td>
  </tr>

  {{-- ── Title ────────────────────────────────────────────────── --}}
  <tr><td style="padding:26px 24px 0;text-align:center;">
    <h1 style="margin:0;font-size:30px;line-height:1.2;font-weight:800;color:#1f2937;">Congratulations!</h1>
    <p style="margin:9px 0 0;font-size:16px;font-weight:700;color:#f97316;line-height:1.4;white-space:nowrap;">
      Probation Period Successfully Completed
    </p>
  </td></tr>

  {{-- ── Circular people-with-check icon (sparkles) ───────────── --}}
  <tr><td style="padding:18px 32px 8px;text-align:center;">
    <img src="{{ $iconUrl }}" alt="" width="210" height="126" style="display:inline-block;border:0;outline:none;max-width:210px;" />
  </td></tr>

  {{-- ── Body copy (formal confirmation letter to the employee) ─ --}}
  <tr><td style="padding:8px 48px 16px;">
    <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.7;">Dear <strong style="color:#1f2937;">{{ $employeeName }}</strong>,</p>

    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
      We are pleased to inform you that you have successfully completed your probation period with
      <strong style="color:#1f2937;">{{ $orgName }}</strong>{!! $effHtml !!}.
    </p>

    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
      During your probation, your performance, commitment, and contribution to the organization have been
      reviewed and found to be satisfactory. Based on this evaluation, we are delighted to confirm your
      employment{!! $roleHtml !!}.
    </p>

    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
      We appreciate your dedication, professionalism, and the positive attitude you have demonstrated
      throughout your probation period. We are confident that you will continue to contribute to the growth
      and success of the organization.
    </p>

    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
      Your employment will now continue under the terms and conditions outlined in your appointment letter
      and the company&rsquo;s policies. If there are any changes to your employment terms, compensation, or
      benefits, they will be communicated to you separately, where applicable.
    </p>

    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
      Congratulations on this achievement, and we wish you continued success in your career with
      <strong style="color:#1f2937;">{{ $orgName }}</strong>.
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">
      Should you have any questions, please feel free to contact the Human Resources department.
    </p>

    <p style="margin:0 0 6px;font-size:15px;color:#374151;line-height:1.7;">
      Warm regards,<br/>
      <strong style="color:#1f2937;">{{ $hrName }}</strong><br/>
      {{ $orgName }}
    </p>
  </td></tr>

  {{-- ── Footer (orange → dark) contact bar ───────────────────── --}}
  <tr><td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ea580c;background-image:linear-gradient(90deg,#0f172a 0%,#9a3412 55%,#f97316 100%);">
      <tr>
        <td align="center" style="padding:20px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td style="padding-right:9px;color:#ffffff;font-size:17px;vertical-align:middle;">&#9993;</td>
              <td style="padding-right:18px;color:#fff7ed;font-size:14px;font-weight:600;vertical-align:middle;">{{ $hrEmail }}</td>
              @if(trim($hrPhone) !== '')
              <td style="padding:0 18px 0 0;color:#fdba74;vertical-align:middle;">|</td>
              <td style="padding-right:9px;color:#ffffff;font-size:17px;vertical-align:middle;">&#9742;</td>
              <td style="color:#fff7ed;font-size:14px;font-weight:600;vertical-align:middle;">{{ $hrPhone }}</td>
              @endif
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>
