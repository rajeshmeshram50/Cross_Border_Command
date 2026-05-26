<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>New Hiring Request &mdash; {{ $orgName }}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    body, table, td, p, h1, h2, h3, div, span { font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif !important; }
  </style>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:#111827;">

{{-- Preheader --}}
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;">
  New hiring request from {{ $creatorName }} &mdash; {{ $hr->title ?: 'Open Position' }}
</div>

{{-- ============ WRAPPER ============ --}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
<tr><td align="center">

{{-- ============ CONTAINER ============ --}}
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(17,24,39,0.06);">

  {{-- ============ HEADER (stacked wordmark of CUSTOMER org) ============ --}}
  {{-- Internal-only email FROM the customer's company, so the brand at top
       is the customer's org (varies per client), NOT the platform vendor. --}}
  @php($_parts = explode(' ', $orgName, 2))
  @php($brandMain = strtoupper($_parts[0] ?? $orgName))
  @php($brandSub = strtoupper(trim($_parts[1] ?? '')))
  <tr><td style="padding:26px 32px 22px;text-align:center;border-bottom:2px solid #a78bfa;">
    <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:6px;line-height:1.1;text-transform:uppercase;">{{ $brandMain }}</div>
    @if($brandSub !== '')
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:10px;">
    <tr>
      <td style="width:34px;height:4px;background-color:#7c3aed;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 14px;font-size:10.5px;font-weight:700;color:#6d28d9;letter-spacing:3px;text-transform:uppercase;white-space:nowrap;">{{ $brandSub }}</td>
      <td style="width:34px;height:4px;background-color:#7c3aed;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
    </table>
    @endif
  </td></tr>

  {{-- ============ HERO (centered: icon on top, headline below) ============ --}}
  <tr><td style="padding:28px 32px 14px;text-align:center;">
    <img src="{{ asset('images/email-icons/magnify-person.png') }}" alt="" width="120" height="120"
         style="display:inline-block;border:0;outline:none;width:120px;height:120px;margin-bottom:14px;" />
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#0f172a;line-height:1.15;letter-spacing:-0.4px;">New Hiring Request</h1>
    <p style="margin:8px 0 0;font-size:13.5px;color:#6b7280;line-height:1.6;">
      A team member has raised a hiring request that requires your review.
    </p>
  </td></tr>

  {{-- ============ GREETING ============ --}}
  <tr><td style="padding:8px 32px 6px;">
    <p style="margin:0;font-size:14.5px;font-weight:700;color:#111827;">Hi {{ $managerName }},</p>
  </td></tr>
  <tr><td style="padding:6px 32px 22px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      <strong style="color:#111827;font-weight:700;">{{ $creatorName }}</strong> has submitted a new hiring request under
      <strong style="color:#7c3aed;font-weight:700;">{{ $orgName }}</strong>. Please review the details below and take the next step.
    </p>
  </td></tr>

  {{-- ============ DETAILS CARD ============ --}}
  <tr><td style="padding:0 32px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafafa;border:1px solid #f3f4f6;border-radius:12px;overflow:hidden;">

      {{-- Row config: each row has icon | label | value --}}
      @php($rows = [['icon' => 'clipboard', 'label' => 'Request Code', 'value' => $hr->code ?: ('HRQ-' . $hr->id), 'mono' => true], ['icon' => 'avatar-purple', 'label' => 'Title', 'value' => $hr->title ?: '—'], ['icon' => 'users-team', 'label' => 'Job Role', 'value' => $hr->job_role ?: '—'], ['icon' => 'building-purple', 'label' => 'Department', 'value' => optional($hr->department)->name ?: '—']])

      @foreach($rows as $i => $row)
      <tr>
        <td style="width:60px;padding:14px 0 14px 20px;vertical-align:middle;@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">
          <img src="{{ asset('images/email-icons/' . $row['icon'] . '.png') }}" alt="" width="22" height="22"
               style="display:inline-block;border:0;outline:none;vertical-align:middle;" />
        </td>
        <td style="padding:14px 16px 14px 12px;font-size:13px;color:#6b7280;width:36%;vertical-align:middle;@if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">{{ $row['label'] }}</td>
        <td style="padding:14px 20px 14px 0;font-size:13.5px;font-weight:700;color:#111827;vertical-align:middle;@if(!empty($row['mono']))font-family:'SF Mono','Courier New',monospace;@endif @if($i < count($rows) - 1)border-bottom:1px solid #f3f4f6;@endif">{{ $row['value'] }}</td>
      </tr>
      @endforeach

      {{-- 3-COLUMN GRID: Openings · Employment · Urgency --}}
      @php($urgency = strtolower((string) ($hr->urgency ?? 'normal')))
      @php($urgencyDot = in_array($urgency, ['high', 'urgent']) ? '#ef4444' : ($urgency === 'medium' ? '#f59e0b' : '#10b981'))
      <tr><td colspan="3" style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #f3f4f6;">
        <tr>
          {{-- Openings --}}
          <td width="33%" valign="top" style="padding:14px 16px;border-right:1px solid #f3f4f6;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle"><img src="{{ asset('images/email-icons/avatar-purple.png') }}" alt="" width="18" height="18" style="display:inline-block;border:0;vertical-align:middle;" /></td>
              <td valign="middle" style="padding-left:8px;font-size:12.5px;font-weight:700;color:#7c3aed;">Openings</td>
            </tr></table>
            <div style="margin-top:8px;">
              <img src="{{ asset('images/email-icons/arrow-up.png') }}" alt="" width="14" height="14" style="display:inline-block;border:0;vertical-align:middle;margin-right:4px;" />
              <span style="font-size:15px;font-weight:700;color:#111827;vertical-align:middle;">{{ $hr->openings ?? 1 }}</span>
            </div>
          </td>
          {{-- Employment --}}
          <td width="34%" valign="top" style="padding:14px 16px;border-right:1px solid #f3f4f6;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle"><img src="{{ asset('images/email-icons/briefcase.png') }}" alt="" width="18" height="18" style="display:inline-block;border:0;vertical-align:middle;" /></td>
              <td valign="middle" style="padding-left:8px;font-size:12.5px;font-weight:700;color:#7c3aed;">Employment</td>
            </tr></table>
            <div style="margin-top:8px;font-size:14px;font-weight:700;color:#111827;">{{ $hr->employment_type ?: '—' }}</div>
          </td>
          {{-- Urgency --}}
          <td width="33%" valign="top" style="padding:14px 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle"><img src="{{ asset('images/email-icons/alert-circle.png') }}" alt="" width="18" height="18" style="display:inline-block;border:0;vertical-align:middle;" /></td>
              <td valign="middle" style="padding-left:8px;font-size:12.5px;font-weight:700;color:#7c3aed;">Urgency</td>
            </tr></table>
            <div style="margin-top:8px;">
              <span style="display:inline-block;width:10px;height:10px;background-color:{{ $urgencyDot }};border-radius:50%;vertical-align:middle;margin-right:6px;font-size:0;line-height:0;">&nbsp;</span>
              <span style="font-size:14px;font-weight:700;color:#111827;vertical-align:middle;">{{ ucfirst($urgency) }}</span>
            </div>
          </td>
        </tr>
        </table>
      </td></tr>

      {{-- TARGET JOIN DATE + business justification --}}
      @php($targetDate = $hr->target_join_date ? \Carbon\Carbon::parse($hr->target_join_date)->format('d M Y') : null)
      @if($targetDate || !empty($hr->business_justification))
      <tr><td colspan="3" style="padding:18px 20px 16px;border-top:1px solid #f3f4f6;">
        @if($targetDate)
        <div style="font-size:10.5px;font-weight:800;color:#7c3aed;letter-spacing:1.6px;text-transform:uppercase;">Target Join Date</div>
        <div style="font-size:15px;font-weight:700;color:#111827;margin-top:4px;">{{ $targetDate }}</div>
        @endif
        @if($targetDate && !empty($hr->business_justification))
        <div style="height:1px;background-color:#ede9fe;margin:12px 0;font-size:0;line-height:0;">&nbsp;</div>
        @endif
        @if(!empty($hr->business_justification))
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">{{ $hr->business_justification }}</p>
        @endif
      </td></tr>
      @endif

    </table>
  </td></tr>

  {{-- ============ CTA ============ --}}
  <tr><td style="padding:8px 32px 8px;text-align:center;">
    @php($hrUrl = config('app.url') . '/hiring-requests')
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $hrUrl }}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="22%" stroke="f" fillcolor="#7c3aed">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;">Go to HR Portal</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="background-color:#7c3aed;background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 100%);border-radius:11px;box-shadow:0 6px 18px rgba(124,58,237,0.30);">
      <a href="{{ $hrUrl }}" target="_blank" style="display:inline-block;padding:14px 38px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
        Go to HR Portal
      </a>
    </td></tr>
    </table>
    <!--<![endif]-->
    <p style="margin:10px 0 0;font-size:11.5px;color:#9ca3af;">You can view the full request on the HR portal.</p>
  </td></tr>

  {{-- ============ FOOTER ============ --}}
  <tr><td style="padding:18px 32px 22px;text-align:center;border-top:1px solid #f3f4f6;">
    <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">
      &copy; {{ date('Y') }} <strong style="color:#111827;font-weight:700;">{{ $orgName }}</strong>. All rights reserved.
    </p>
  </td></tr>

</table>
{{-- /Container --}}

</td></tr>
</table>
{{-- /Wrapper --}}

</body>
</html>
