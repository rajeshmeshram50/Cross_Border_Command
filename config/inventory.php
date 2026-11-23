<?php

return [
    'sticker_url' => env('STICKER_URL', env('APP_URL')),

    'sticker_secret' => env('STICKER_SECRET'),

    'sticker_accept_legacy' => (bool) env('STICKER_ACCEPT_LEGACY', true),

    'scan_stale_minutes' => env('SCAN_STALE_MINUTES', 5),
];
