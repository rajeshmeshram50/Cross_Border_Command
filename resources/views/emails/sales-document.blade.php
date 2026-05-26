<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>{{ $docKind }} {{ $docCode }}</title>
<!--[if mso]>
<style type="text/css">
table, td, div, h1, h2, p { font-family: 'Segoe UI', Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#eef2f7; font-family:'Inter','Segoe UI',Arial,sans-serif; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; color:#0f172a;">

<!-- Preheader -->
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; color:#eef2f7; line-height:1px;">
    Your {{ $docKind }} {{ $docCode }} is ready · Tap to open online.
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef2f7; padding:44px 16px 56px;">
    <tr>
        <td align="center">

            <!-- ═══════ MAIN CARD ═══════ -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 4px 14px rgba(15,23,42,0.04), 0 24px 56px rgba(15,23,42,0.12);">

                <!-- ─── HEADER ROW — green vertical accent + branch
                     identity + top-right green corner ribbon. -->
                <tr>
                    <td style="padding:0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                            <tr>
                                <td style="padding:32px 0 0 36px; vertical-align:top;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                        <tr>
                                            <td style="width:4px; background:#68AD35; border-radius:2px;">&nbsp;</td>
                                            <td style="padding-left:14px; vertical-align:middle;">
                                                <div style="font-size:17px; font-weight:800; color:#0f172a; letter-spacing:-0.3px; line-height:1.2;">{{ $branchName }}</div>
                                                <div style="font-size:11px; color:#64748b; font-weight:500; margin-top:2px;">{{ $docKind }} Document</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                                <td style="width:110px; padding:0; vertical-align:top; text-align:right;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="110" align="right">
                                        <tr>
                                            <td height="110" style="background:#68AD35; background-image:linear-gradient(135deg, #34d399 0%, #10b981 60%, #059669 100%); border-bottom-left-radius:55px; line-height:0; font-size:0;">&nbsp;</td>
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
                            Your {{ $docKind }}<br>
                            is <span style="color:#10b981;">Ready</span>
                        </h1>
                        <div style="display:inline-block; width:60px; height:4px; background:#10b981; border-radius:2px; margin-top:4px;">&nbsp;</div>
                    </td>
                </tr>

                <!-- ═══════ BODY MESSAGE ═══════ -->
                <tr>
                    <td style="padding:26px 40px 0;">
                        <p style="margin:0 0 8px; font-size:15px; color:#0f172a; font-weight:700;">
                            Hi {{ ucwords(strtolower($customerName)) }},
                        </p>
                        <p style="margin:0; font-size:14px; color:#475569; line-height:23px;">
                            Your {{ strtolower($docKind) }} from <strong style="color:#10b981;">{{ $branchName }}</strong> is ready for review. Summary below — full PDF attached.
                        </p>
                    </td>
                </tr>

                <!-- ═══════ TOTAL AMOUNT CARD — the most important number
                     on the doc gets the most visual weight. Big number,
                     light tinted background, currency + type chip. ═══════ -->
                @if($grandTotal > 0)
                <tr>
                    <td style="padding:30px 40px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0fdf4; background-image:linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border:1px solid #bbf7d0; border-radius:16px;">
                            <tr>
                                <td style="padding:22px 24px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="vertical-align:middle;">
                                                <div style="font-size:11px; color:#15803d; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; margin-bottom:4px;">Grand Total</div>
                                                <div style="line-height:1.1;">
                                                    @if(!empty($currency))
                                                        <span style="font-size:14px; color:#15803d; font-weight:700; letter-spacing:0.5px; margin-right:4px;">{{ $currency }}</span>
                                                    @endif
                                                    <span style="font-size:28px; color:#0f172a; font-weight:900; letter-spacing:-0.7px;">{{ number_format($grandTotal, 2) }}</span>
                                                </div>
                                            </td>
                                            @if(!empty($docType))
                                            <td style="vertical-align:middle; text-align:right;">
                                                <span style="display:inline-block; padding:6px 12px; background:#ffffff; color:#15803d; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; border-radius:8px; border:1.5px solid #bbf7d0;">{{ $docType }}</span>
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

                <!-- ═══════ INFO CARDS — stacked vertically. ═══════ -->

                <!-- Card 1: Doc Number -->
                <tr>
                    <td style="padding:14px 40px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; border-radius:14px;">
                            <tr>
                                <td style="padding:16px 20px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                        <tr>
                                            <td style="width:46px; vertical-align:middle;">
                                                <span style="display:inline-block; width:40px; height:40px; line-height:40px; text-align:center; background:#dcfce7; color:#10b981; border-radius:50%; font-size:17px; font-weight:800;">#</span>
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
                                                <span style="display:inline-block; width:40px; height:40px; line-height:40px; text-align:center; background:#dcfce7; color:#10b981; border-radius:50%; font-size:17px;">📅</span>
                                            </td>
                                            <td style="vertical-align:middle; padding-left:6px;">
                                                <div style="font-size:11px; color:#94a3b8; font-weight:600; letter-spacing:0.3px; margin-bottom:2px;">Date Issued</div>
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
                                                <span style="display:inline-block; width:40px; height:40px; line-height:40px; text-align:center; background:#dcfce7; color:#10b981; border-radius:50%; font-size:17px;">📦</span>
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

                <!-- ═══════ CTA BUTTON ═══════ -->
                @if(!empty($viewUrl))
                <tr>
                    <td align="center" style="padding:34px 40px 8px;">
                        <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ $viewUrl }}" style="height:56px;v-text-anchor:middle;width:280px;" arcsize="20%" strokecolor="#059669" fillcolor="#10b981">
                          <w:anchorlock/>
                          <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;">View {{ $docKind }} &nbsp;&rarr;</center>
                        </v:roundrect>
                        <![endif]-->
                        <!--[if !mso]><!-- -->
                        <a href="{{ $viewUrl }}" target="_blank" style="display:inline-block; background:#10b981; background-image:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; text-decoration:none; font-size:15px; font-weight:700; padding:16px 48px; border-radius:12px; box-shadow:0 12px 28px rgba(16,185,129,0.36), 0 4px 8px rgba(16,185,129,0.20); font-family:'Inter','Segoe UI',Arial,sans-serif; letter-spacing:0.3px;">
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
                            Reply to this email if you have any questions.
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

                <!-- ═══════ BOTTOM-LEFT GREEN RIBBON ═══════ -->
                <tr>
                    <td style="padding:0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                            <tr>
                                <td style="width:110px; padding:0; vertical-align:bottom;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="110">
                                        <tr>
                                            <td height="90" style="background:#10b981; background-image:linear-gradient(315deg, #34d399 0%, #10b981 60%, #059669 100%); border-top-right-radius:55px; line-height:0; font-size:0;">&nbsp;</td>
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
                Automated email · Reply to reach the team directly.
            </p>

        </td>
    </tr>
</table>

</body>
</html>
