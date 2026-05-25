<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Reminder — {{ $docKind }} {{ $docCode }}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Helvetica, Arial, sans-serif; color:#333; font-size:14px; line-height:22px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f5f7; padding:24px 0;">
    <tr>
        <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background-color:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,.05); padding:32px 36px; max-width:600px;">
                <tr>
                    <td>
                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">Dear {{ ucwords(strtolower($customerName)) }},</p>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            We hope you are doing well.
                        </p>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            This is a gentle reminder regarding <strong>{{ $docKind }} No. {{ $docCode }}</strong>
                            @if(!empty($docDate)) dated <strong>{{ $docDate }}</strong> @endif
                            shared earlier for your review.
                        </p>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            Kindly let us know if you have any feedback or require any additional information.
                            We would appreciate an update at your convenience.
                        </p>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            For your reference, the {{ strtolower($docKind) }} is attached again with this email.
                        </p>

                        <p style="margin:0 0 24px 0; font-size:14px; color:#333;">
                            Thank you, and we look forward to hearing from you.
                        </p>

                        <p style="margin:0 0 4px 0; font-size:14px; color:#333;"><strong>Regards,</strong></p>
                        <p style="margin:0 0 4px 0; font-size:14px; color:#333;">Sales Team</p>
                        <p style="margin:0 0 4px 0; font-size:14px; color:#333;"><strong>{{ $branchName }}</strong></p>
                        @if(!empty($branchEmail))
                            <p style="margin:0 0 4px 0; font-size:13px; color:#555;">
                                Email: <a href="mailto:{{ $branchEmail }}" style="color:#3894b2; text-decoration:none;">{{ $branchEmail }}</a>
                            </p>
                        @endif
                        @if(!empty($branchWebsite))
                            <p style="margin:0; font-size:13px; color:#555;">
                                Website: <a href="{{ $branchWebsite }}" style="color:#3894b2; text-decoration:none;">{{ $branchWebsite }}</a>
                            </p>
                        @endif
                    </td>
                </tr>
            </table>

            <p style="margin:18px 0 0 0; font-size:11px; color:#999;">
                @if($reminderNumber > 1)
                    Follow-up #{{ $reminderNumber }} from {{ $branchName }}. If you have already responded, please disregard this reminder.
                @else
                    This is an automated reminder from {{ $branchName }}. If you have already responded, please disregard.
                @endif
            </p>
        </td>
    </tr>
</table>
</body>
</html>
