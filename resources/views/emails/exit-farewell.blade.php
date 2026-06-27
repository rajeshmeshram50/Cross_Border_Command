<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>Thank You for Being a Part of Our Journey &mdash; {{ $orgName }}</title>
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;color:#1e293b;">

{{-- Hidden pre-header --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4f5f7;">
  {{ $employeeName }} will be leaving {{ $orgName }} on {{ $lastWorkingDay }}.
</div>

@php($_parts = explode(' ', trim($orgName), 2))
@php($brandMain = strtoupper($_parts[0] ?? $orgName))
@php($brandSub = strtoupper(trim($_parts[1] ?? '')))

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;padding:36px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,0.08);">

  {{-- ── Brand header ─────────────────────────────────────────── --}}
  <tr><td style="padding:34px 32px 18px;text-align:center;border-bottom:1px solid #e9e5fb;position:relative;">
    {{-- Decorative top-right corner (layered purple + navy triangles). Built as
         an inline SVG data-URI; clipped by the card's rounded corner + overflow.
         (Some clients e.g. Gmail strip absolute-positioned / data images — it's
         purely decorative, so the email still reads fine without it.) --}}
    @php
      $cornerSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='118' height='118' viewBox='0 0 118 118'>"
                 . "<polygon points='26,0 118,0 118,92' fill='#c4b5fd'/>"
                 . "<polygon points='118,0 118,74 44,0' fill='#0f172a'/>"
                 . "<polygon points='118,0 118,40 80,0' fill='#7c5cfc'/>"
                 . "</svg>";
      $cornerUri = 'data:image/svg+xml,' . rawurlencode($cornerSvg);
    @endphp
    <img src="{{ $cornerUri }}" alt="" width="118" height="118"
         style="position:absolute;top:0;right:0;border:0;display:block;" />
    @if(!empty($logoUrl))
      <img src="{{ $logoUrl }}" alt="{{ $orgName }}" height="38" style="display:inline-block;max-height:38px;border:0;outline:none;" />
    @else
      <div style="font-size:30px;font-weight:800;color:#0f172a;letter-spacing:9px;line-height:1;text-transform:uppercase;">{{ $brandMain }}</div>
      @if($brandSub !== '')
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:12px auto 0;">
        <tr>
          <td style="padding-right:10px;"><div style="width:26px;height:8px;border-radius:4px;background-color:#7c5cfc;"></div></td>
          <td style="font-size:12px;font-weight:700;color:#7c5cfc;letter-spacing:4px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
          <td style="padding-left:10px;"><div style="width:26px;height:8px;border-radius:4px;background-color:#7c5cfc;"></div></td>
        </tr>
      </table>
      @endif
    @endif
  </td></tr>

  {{-- ── Title ────────────────────────────────────────────────── --}}
  <tr><td style="padding:34px 40px 6px;text-align:center;">
    <h1 style="margin:0;font-size:28px;line-height:1.3;font-weight:800;color:#1e293b;">
      Thank You for Being<br/>a Part of Our Journey
    </h1>
  </td></tr>

  {{-- ── Circular people-exit icon ────────────────────────────── --}}
  <tr><td style="padding:24px 32px 8px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
           style="width:88px;height:88px;border:2px solid #e7e1fb;border-radius:50%;">
      <tr><td align="center" valign="middle" style="height:88px;">
        <img src="{{ $iconUrl }}" alt="" width="40" height="40" style="display:inline-block;border:0;outline:none;" />
      </td></tr>
    </table>
  </td></tr>

  {{-- ── Body copy ────────────────────────────────────────────── --}}
  <tr><td style="padding:18px 44px 6px;">
    <p style="margin:0 0 22px;font-size:16px;color:#334155;line-height:1.6;">{{ $introLine }}</p>
    <p style="margin:0 0 22px;font-size:16px;color:#334155;line-height:1.7;">
      We&rsquo;d like to inform you that <strong style="color:#0f172a;">{{ $employeeName }}</strong>
      will be leaving {{ $orgName }} on <strong style="color:#0f172a;">{{ $lastWorkingDay }}</strong>.
    </p>
    <p style="margin:0 0 22px;font-size:16px;color:#334155;line-height:1.7;">
      We appreciate {{ $possessivePronoun }} dedication and the contributions {{ $subjectPronoun }} has made.
    </p>
    <p style="margin:0 0 30px;font-size:16px;color:#334155;line-height:1.7;">
      Let&rsquo;s wish {{ $objectPronoun }} the best in all {{ $possessivePronoun }} future endeavors!
    </p>
  </td></tr>

  {{-- ── Dark footer (contact) ────────────────────────────────── --}}
  <tr><td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0f172a;">
      <tr>
        <td align="center" style="padding:22px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td style="padding-right:10px;color:#7c5cfc;font-size:18px;vertical-align:middle;">&#9993;</td>
              <td style="padding-right:18px;color:#e2e8f0;font-size:15px;vertical-align:middle;">{{ $hrEmail }}</td>
              <td style="padding:0 18px 0 0;color:#334155;vertical-align:middle;">|</td>
              <td style="padding-right:10px;color:#7c5cfc;font-size:18px;vertical-align:middle;">&#9742;</td>
              <td style="color:#e2e8f0;font-size:15px;vertical-align:middle;">{{ $hrPhone }}</td>
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
