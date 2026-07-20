<?php
/** One-shot: exchange the grant code → refresh token, write ZOHO_BOOKS_* to .env. */
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Artisan;

$code = '1000.7ce741c64fdf41c8a752537993d1a205.099a8ea105621f71325c7532c9e881cd';
$cid  = config('services.zoho_books.client_id');       // falls back to ZOHO_CLIENT_ID
$sec  = config('services.zoho_books.client_secret');   // falls back to ZOHO_CLIENT_SECRET
$org  = '60077655856';
$acc  = config('services.zoho_books.accounts_url', 'https://accounts.zoho.in');

echo "client_id starts: " . substr((string)$cid, 0, 10) . "…\n";

$resp = Http::asForm()->post("{$acc}/oauth/v2/token", [
    'grant_type'    => 'authorization_code',
    'client_id'     => $cid,
    'client_secret' => $sec,
    'code'          => $code,
]);
$d  = $resp->json() ?? [];
$rt = $d['refresh_token'] ?? null;

if (!$rt) { echo "✗ FAIL: " . json_encode($d) . "\n"; return; }
echo "✓ refresh token obtained\n";

$p = base_path('.env');
$env = file_get_contents($p);
$set = function ($k, $v) use (&$env) {
    if (preg_match('/^' . preg_quote($k, '/') . '=.*$/m', $env)) {
        $env = preg_replace('/^' . preg_quote($k, '/') . '=.*$/m', "$k=$v", $env);
    } else { $env = rtrim($env, "\n") . "\n$k=$v\n"; }
};
$set('ZOHO_BOOKS_ORG_ID', $org);
$set('ZOHO_BOOKS_CLIENT_ID', $cid);
$set('ZOHO_BOOKS_CLIENT_SECRET', $sec);
$set('ZOHO_BOOKS_REFRESH_TOKEN', $rt);
file_put_contents($p, $env);
echo "✓ wrote ZOHO_BOOKS_* to .env\n";

Artisan::call('config:clear');
echo "✓ config cleared\n";
