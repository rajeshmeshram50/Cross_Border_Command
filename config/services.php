<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

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

    // Zoho Sign — used by ZohoSignService for the CLM Trade Document
    // "Send for Signature" flow. Defaults point at the IN data centre;
    // override BASE_URL + ACCOUNTS_URL + DC for US/EU/AU orgs.
    //
    // ZOHO_TESTING_MODE=true appends ?testing=true to the /requests
    // create call. That makes the request count as a sandbox send: it
    // works on free-tier accounts that can't otherwise hit the API
    // (Zoho error 12000 — "Upgrade Zoho Sign license to send documents
    // via API"), but Zoho will NOT email a signer whose address isn't
    // already a user on the org. Use it for smoke tests only; turn it
    // off once the account is upgraded for production signing.
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

];
