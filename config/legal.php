<?php

return [
    // Shown on /privacy and /terms. Override with LEGAL_CONTACT_EMAIL.
    'contact_email' => env('LEGAL_CONTACT_EMAIL', env('MAIL_FROM_ADDRESS', 'admin@kryptone.ai')),
];
