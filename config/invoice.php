<?php

return [
    'company' => [
        'name' => env('INVOICE_COMPANY_NAME', 'Inorbvict Healthcare India Private Limited'),
        'address_line1' => env('INVOICE_ADDRESS_1', 'Office No 821, 8th Flr, Solitaire Business Hub, Balewadi'),
        'address_line2' => env('INVOICE_ADDRESS_2', 'Highstreet Baner, Pune, Maharashtra - 411045, India'),
        'phone' => env('INVOICE_PHONE', '+91 9850558881'),
        'email' => env('INVOICE_EMAIL', 'ceo@inhpl.com'),
        'website' => env('INVOICE_WEBSITE', 'www.inhpl.com'),
        'gstin' => env('INVOICE_GSTIN', '27AADCI6120M1ZH'),
        'gst_state_code' => env('INVOICE_GST_STATE_CODE', '27'),
        'pan' => env('INVOICE_PAN', 'AADCI6120M'),
        'cin' => env('INVOICE_CIN', 'U85100PN2014PTC152252'),
        'iec' => env('INVOICE_IEC', '3114017398'),
    ],

    'bank' => [
        'bank_name' => env('INVOICE_BANK_NAME', 'HDFC BANK LTD'),
        'account_holder' => env('INVOICE_BANK_HOLDER', 'Inorbvict Healthcare India Private Limited'),
        'bank_address' => env('INVOICE_BANK_ADDRESS', 'HDFC BANK, SR NO. 244/3-5, OPP INDIAN OIL PETROL PUMP, RAJIV GANDHI IT PARK, HINJEWADI, PUNE, MAHARASHTRA 411057 INDIA'),
        'branch_name' => env('INVOICE_BANK_BRANCH', 'HINJEWADI, PUNE'),
        'branch_code' => env('INVOICE_BANK_BRANCH_CODE', '794'),
        'ad_code' => env('INVOICE_BANK_AD_CODE', '0510573'),
        'account_number' => env('INVOICE_BANK_ACCOUNT', '59209850100030'),
        'ifsc_code' => env('INVOICE_BANK_IFSC', 'HDFC0000794'),
        'swift_code' => env('INVOICE_BANK_SWIFT', 'HDFCINBB'),
        'upi_id' => env('INVOICE_UPI_ID', '9890968677@okbizaxis'),
    ],

    'defaults' => [
        'gst_rate' => (float) env('INVOICE_GST_RATE', 18),
    ],

    'terms' => [
        '1. This invoice is auto-generated for the subscription plan purchased.',
        '2. Payment should be made to the bank account or UPI ID mentioned above.',
        '3. Subscription is non-refundable once the plan is activated.',
    ],
];
