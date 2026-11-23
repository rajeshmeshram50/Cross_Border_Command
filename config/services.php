<?php

return [
    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'razorpay' => [
        'key' => env('RAZORPAY_KEY'),
        'secret' => env('RAZORPAY_SECRET'),
        'webhook_secret' => env('RAZORPAY_WEBHOOK_SECRET'),
    ],

    'zoho' => [
        'client_id'     => env('ZOHO_CLIENT_ID'),
        'client_secret' => env('ZOHO_CLIENT_SECRET'),
        'refresh_token' => env('ZOHO_REFRESH_TOKEN'),
        'base_url'      => env('ZOHO_BASE_URL', 'https://sign.zoho.in'),
        'accounts_url'  => env('ZOHO_ACCOUNTS_URL', 'https://accounts.zoho.in'),
        'dc'            => env('ZOHO_DC', 'IN'),
        'api_version'   => env('ZOHO_API_VERSION', 'v1'),
        'testing_mode'  => env('ZOHO_TESTING_MODE', false),
    ],

    'zoho_books' => [
        'client_id'     => env('ZOHO_BOOKS_CLIENT_ID', env('ZOHO_CLIENT_ID')),
        'client_secret' => env('ZOHO_BOOKS_CLIENT_SECRET', env('ZOHO_CLIENT_SECRET')),
        'refresh_token' => env('ZOHO_BOOKS_REFRESH_TOKEN'),
        'organization_id' => env('ZOHO_BOOKS_ORG_ID'),
        'base_url'      => env('ZOHO_BOOKS_BASE_URL', 'https://www.zohoapis.in/books/v3'),
        'accounts_url'  => env('ZOHO_BOOKS_ACCOUNTS_URL', env('ZOHO_ACCOUNTS_URL', 'https://accounts.zoho.in')),
        'expense_title_cf' => env('ZOHO_BOOKS_EXPENSE_TITLE_CF', 'cf_expense_title'),
    ],

    'credvault' => [
        'otp_email' => env('CREDVAULT_OTP_EMAIL', 'php@inhpl.com'),
        'share_copy_email' => env('CREDVAULT_SHARE_COPY_EMAIL', 'php@inhpl.com'),
    ],
];
