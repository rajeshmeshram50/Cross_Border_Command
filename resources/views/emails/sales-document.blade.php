<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{ $docKind }} {{ $docCode }}</title>
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
                            Greetings from <strong>{{ $branchName }}</strong>.
                        </p>

                        <p style="margin:0 0 16px 0; font-size:14px; color:#333;">
                            Please find attached our {{ strtolower($docKind) }} for your review and consideration.
                        </p>

                        <p style="margin:0 0 6px 0; font-size:14px; color:#333;">
                            <strong>{{ $docKind }} Summary:</strong>
                        </p>
                        <ul style="margin:0 0 18px 18px; padding:0; font-size:14px; color:#333; line-height:22px;">
                            <li><strong>{{ $docKind }} No:</strong> {{ $docCode }}</li>
                            <li><strong>{{ $docKind }} Date:</strong> {{ $docDate }}</li>
                            @if(!empty($productSummary))
                                <li><strong>Product:</strong> {{ $productSummary }}</li>
                            @endif
                        </ul>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            The detailed {{ strtolower($docKind) }} document is attached for your reference.
                        </p>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            Kindly review the {{ strtolower($docKind) }} and share your feedback at your convenience. We would appreciate your acknowledgement of receipt of this email.
                        </p>

                        <p style="margin:0 0 14px 0; font-size:14px; color:#333;">
                            Should you require any clarification or additional information, please feel free to contact us.
                        </p>

                        <p style="margin:0 0 24px 0; font-size:14px; color:#333;">
                            Thank you for the opportunity to serve you.
                        </p>

                        <p style="margin:0 0 4px 0; font-size:14px; color:#333;"><strong>Best Regards,</strong></p>
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
                This is an automated email from {{ $branchName }}. If you received this in error, please disregard.
            </p>
        </td>
    </tr>
</table>
</body>
</html>
