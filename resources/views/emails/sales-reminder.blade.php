<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Reminder — {{ $docKind }} {{ $docCode }}</title>
<!--[if mso]>
<style type="text/css">
table, td, div, h1, h2, p { font-family: 'Segoe UI', Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#eef2f7; font-family:'Inter','Segoe UI',Arial,sans-serif; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; color:#0f172a;">

<!-- Preheader -->
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#eef2f7; line-height:1px;">
    Reminder · {{ $docKind }} {{ $docCode }} awaiting your review.
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef2f7; padding:44px 16px 56px;">
    <tr>
        <td align="center">

            <!-- ═══════ MAIN CARD ═══════ -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 4px 14px rgba(15,23,42,0.04), 0 24px 56px rgba(15,23,42,0.12);">

                <!-- ─── HEADER ROW — amber accent + branch identity + amber corner ribbon. -->
                <tr>
                    <td style="padding:0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                            <tr>
                                <td style="padding:32px 0 0 36px; vertical-align:top;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                        <tr>
                                            <td style="width:4px; background:#3b82f6; border-radius:2px;">&nbsp;</td>
                                            <td style="padding-left:14px; vertical-align:middle;">
                                                <div style="font-size:17px; font-weight:800; color:#0f172a; letter-spacing:-0.3px; line-height:1.2;">{{ $branchName }}</div>
                                                <div style="font-size:11px; color:#64748b; font-weight:500; margin-top:2px;">@if($reminderNumber > 1) Reminder #{{ $reminderNumber }} @else Friendly Reminder @endif</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                                <td style="width:140px; padding:0; vertical-align:top; text-align:right;">
                                    {{-- Two-stripe ribbon corner — mimics the Acme
                                         Logistics reference. Three hard-stop bands:
                                           0–32%   → darker cobalt (outer stripe,
                                                     "back of the fold")
                                           32–58%  → brighter cobalt (inner stripe,
                                                     "front of the fold")
                                           58–100% → white (fills out the rest of
                                                     the corner square so the inner
                                                     half blends with the card body)
                                         Background-color is white so the transparent
                                         third band reads as the card surface. --}}
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="140" align="right">
                                        <tr>
                                            <td height="140" style="background-color:#ffffff; background-image:linear-gradient(225deg, #1e40af 0%, #1e40af 28%, #4b95f8 28%, #4b95f8 52%, #ffffff 52%, #ffffff 100%); border-bottom-left-radius:70px; line-height:0; font-size:0;">&nbsp;</td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- ═══════ HERO HEADING ═══════ -->
                <tr>
                    <td style="padding:40px 40px 8px;">
                        <h1 style="margin:0 0 14px; font-size:40px; line-height:1.05; font-weight:900; color:#0f172a; letter-spacing:-1.1px; font-family:'Inter','Segoe UI',Arial,sans-serif; text-transform:uppercase;">
                            Awaiting<br>
                            Your <span style="color:#3b82f6;">Review</span>
                        </h1>
                        <div style="display:inline-block; width:60px; height:4px; background:#3b82f6; border-radius:2px; margin-top:4px;">&nbsp;</div>
                    </td>
                </tr>

                <!-- ═══════ BODY MESSAGE ═══════ -->
                <tr>
                    <td style="padding:26px 40px 0;">
                        <p style="margin:0 0 8px; font-size:15px; color:#0f172a; font-weight:700;">
                            Hi {{ ucwords(strtolower($customerName)) }},
                        </p>
                        <p style="margin:0; font-size:14px; color:#475569; line-height:23px;">
                            Just a quick follow-up — our {{ strtolower($docKind) }} from <strong style="color:#3b82f6;">{{ $branchName }}</strong> is still awaiting your review.
                        </p>
                    </td>
                </tr>

                <!-- ═══════ TOTAL AMOUNT CARD ═══════ -->
                @if($grandTotal > 0)
                <tr>
                    <td style="padding:30px 40px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eff6ff; background-image:linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border:1px solid #bfdbfe; border-radius:16px;">
                            <tr>
                                <td style="padding:22px 24px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="vertical-align:middle;">
                                                <div style="font-size:11px; color:#1d4ed8; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; margin-bottom:4px;">Grand Total</div>
                                                <div style="line-height:1.1;">
                                                    @if(!empty($currency))
                                                        <span style="font-size:14px; color:#1d4ed8; font-weight:700; letter-spacing:0.5px; margin-right:4px;">{{ $currency }}</span>
                                                    @endif
                                                    <span style="font-size:28px; color:#0f172a; font-weight:900; letter-spacing:-0.7px;">{{ number_format($grandTotal, 2) }}</span>
                                                </div>
                                            </td>
                                            @if(!empty($docType))
                                            <td style="vertical-align:middle; text-align:right;">
                                                <span style="display:inline-block; padding:6px 12px; background:#ffffff; color:#1d4ed8; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; border-radius:8px; border:1.5px solid #bfdbfe;">{{ $docType }}</span>
                                            </td>
                                            @endif
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
                @endif

                <!-- ═══════ INFO CARDS ═══════ -->

                <!-- Card 1: Doc Number -->
                <tr>
                    <td style="padding:14px 40px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:14px;">
                            <tr>
                                <td style="padding:16px 20px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="width:46px; vertical-align:middle;">
                                                <span style="display:inline-block; width:40px; height:40px; line-height:40px; text-align:center; background:#dbeafe; color:#1d4ed8; border-radius:50%; font-size:17px; font-weight:800;">#</span>
                                            </td>
                                            <td style="vertical-align:middle; padding-left:6px;">
                                                <div style="font-size:11px; color:#94a3b8; font-weight:600; letter-spacing:0.3px; margin-bottom:2px;">{{ $docLabel ?? 'Document' }} Number</div>
                                                <div style="font-size:14px; color:#0f172a; font-weight:800; letter-spacing:-0.1px;">{{ $docCode }}</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Card 2: Date -->
                <tr>
                    <td style="padding:10px 40px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:14px;">
                            <tr>
                                <td style="padding:16px 20px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="width:46px; vertical-align:middle;">
                                                <span style="display:inline-block; width:40px; height:40px; line-height:40px; text-align:center; background:#dbeafe; color:#1d4ed8; border-radius:50%; font-size:17px;">📅</span>
                                            </td>
                                            <td style="vertical-align:middle; padding-left:6px;">
                                                <div style="font-size:11px; color:#94a3b8; font-weight:600; letter-spacing:0.3px; margin-bottom:2px;">Originally Sent</div>
                                                <div style="font-size:14px; color:#0f172a; font-weight:800; letter-spacing:-0.1px;">{{ $docDate }}</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Card 3: Products -->
                <tr>
                    <td style="padding:10px 40px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:14px;">
                            <tr>
                                <td style="padding:16px 20px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="width:46px; vertical-align:middle;">
                                                <span style="display:inline-block; width:40px; height:40px; line-height:40px; text-align:center; background:#dbeafe; color:#1d4ed8; border-radius:50%; font-size:17px;">📦</span>
                                            </td>
                                            <td style="vertical-align:middle; padding-left:6px;">
                                                <div style="font-size:11px; color:#94a3b8; font-weight:600; letter-spacing:0.3px; margin-bottom:2px;">Products</div>
                                                <div style="font-size:14px; color:#0f172a; font-weight:800; letter-spacing:-0.1px;">{{ $productsCount }} {{ $productsCount == 1 ? 'item' : 'items' }} included</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- ═══════ CTA — blue button matches the reminder accent
                     (same palette as the hero ribbon + info-card icons,
                     so the email reads as one cohesive design). ═══════ -->
                @if(!empty($viewUrl))
                <tr>
                    <td align="center" style="padding:34px 40px 8px;">
                        <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $viewUrl }}" style="height:56px;v-text-anchor:middle;width:280px;" arcsize="20%" strokecolor="#1d4ed8" fillcolor="#3b82f6">
                          <w:anchorlock/>
                          <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;">View {{ $docKind }} &nbsp;&rarr;</center>
                        </v:roundrect>
                        <![endif]-->
                        <!--[if !mso]><!-- -->
                        <a href="{{ $viewUrl }}" target="_blank" style="display:inline-block; background:#3b82f6; background-image:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color:#ffffff; text-decoration:none; font-size:15px; font-weight:700; padding:16px 48px; border-radius:12px; box-shadow:0 12px 28px rgba(37,99,235,0.36), 0 4px 8px rgba(37,99,235,0.20); font-family:'Inter','Segoe UI',Arial,sans-serif; letter-spacing:0.3px;">
                            View {{ $docKind }} &nbsp;→
                        </a>
                        <!--<![endif]-->
                    </td>
                </tr>
                <tr>
                    <td align="center" style="padding:10px 40px 0;">
                        <p style="margin:0; font-size:11px; color:#94a3b8;">
                            🔒 Secure link · Opens in browser · Valid for 60 days
                        </p>
                    </td>
                </tr>
                @endif

                <!-- ═══════ SIGN-OFF ═══════ -->
                <tr>
                    <td style="padding:36px 40px 24px;">
                        <p style="margin:0 0 2px; font-size:13px; color:#475569;">Best regards,</p>
                        <p style="margin:0 0 2px; font-size:15px; color:#0f172a; font-weight:800;">Sales Team</p>
                        <p style="margin:0; font-size:13px; color:#64748b;">{{ $branchName }}</p>
                        <p style="margin:14px 0 0; font-size:12px; color:#94a3b8;">
                            Already responded? Just reply and we'll close this thread.
                        </p>
                    </td>
                </tr>

                <!-- ═══════ FOOTER ═══════ -->
                <tr>
                    <td style="padding:24px 40px 16px; text-align:center; border-top:1px solid #eef0f3;">
                        @if(!empty($logoPath))
                            <img src="{{ $message->embed($logoPath) }}" alt="{{ $branchName }}" height="32" style="height:32px; max-height:32px; width:auto; display:inline-block; margin-bottom:10px; border:0; outline:none; text-decoration:none;">
                        @endif
                        <p style="margin:0 0 4px; font-size:13px; color:#0f172a; font-weight:700;">{{ $branchName }}</p>
                        @if(!empty($branchWebsite) || !empty($branchEmail))
                        <p style="margin:0 0 10px; font-size:11px; color:#64748b;">
                            @if(!empty($branchWebsite))
                                <a href="{{ $branchWebsite }}" target="_blank" style="color:#64748b; text-decoration:none;">{{ $branchWebsite }}</a>
                            @endif
                            @if(!empty($branchWebsite) && !empty($branchEmail))
                                <span style="color:#cbd5e1; margin:0 8px;">·</span>
                            @endif
                            @if(!empty($branchEmail))
                                <a href="mailto:{{ $branchEmail }}" style="color:#64748b; text-decoration:none;">{{ $branchEmail }}</a>
                            @endif
                        </p>
                        @endif
                        <p style="margin:0; font-size:11px; color:#94a3b8;">
                            © {{ date('Y') }} {{ $branchName }} · All rights reserved
                        </p>
                    </td>
                </tr>

                <!-- ═══════ BOTTOM-LEFT WRAPPED RIBBON — mirrors the
                     top-right ribbon (same hard-stop gradient, rotated
                     so the "fold" sits on the opposite diagonal). ═══════ -->
                <tr>
                    <td style="padding:0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                            <tr>
                                <td style="width:140px; padding:0; vertical-align:bottom;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="140">
                                        <tr>
                                            <td height="140" style="background-color:#ffffff; background-image:linear-gradient(45deg, #1e40af 0%, #1e40af 28%, #4b95f8 28%, #4b95f8 52%, #ffffff 52%, #ffffff 100%); border-top-right-radius:70px; line-height:0; font-size:0;">&nbsp;</td>
                                        </tr>
                                    </table>
                                </td>
                                <td>&nbsp;</td>
                            </tr>
                        </table>
                    </td>
                </tr>

            </table>
            <!-- ═══════ /MAIN CARD ═══════ -->

            <p style="margin:18px 0 0; font-size:10px; color:#94a3b8; max-width:640px; line-height:14px;">
                @if($reminderNumber > 1)
                    Follow-up #{{ $reminderNumber }} · {{ $branchName }}
                @else
                    Automated reminder · {{ $branchName }}
                @endif
            </p>

        </td>
    </tr>
</table>

</body>
</html>
