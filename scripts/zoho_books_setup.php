<?php
/**
 * ONE-TIME Zoho Books connect: exchanges a Self-Client GRANT CODE for a
 * permanent refresh token and writes the ZOHO_BOOKS_* keys into .env.
 *
 * Fill the four values below (grant code + client id/secret from the Zoho API
 * console Self Client; org id is pre-filled), then run:
 *     php artisan tinker scripts/zoho_books_setup.php
 * On success it writes .env, clears config cache, and tells you to run the
 * smoke test. The grant code is single-use and expires in a few minutes — if it
 * fails with "invalid_code", generate a fresh one and re-run.
 */

/* ─── paste these four values ─── */
$GRANT_CODE    = '';                 // the code from Self Client → Generate Code
$CLIENT_ID     = '';                 // Self Client "Client ID"
$CLIENT_SECRET = '';                 // Self Client "Client Secret"
$ORG_ID        = '60077655856';      // Inorbvict Agrotech (books.zoho.in)
/* ─────────────────────────────── */

$ACCOUNTS_URL = 'https://accounts.zoho.in';   // India DC

$line = fn ($s) => print($s . "\n");

foreach (['GRANT_CODE' => $GRANT_CODE, 'CLIENT_ID' => $CLIENT_ID, 'CLIENT_SECRET' => $CLIENT_SECRET, 'ORG_ID' => $ORG_ID] as $k => $v) {
    if (trim((string) $v) === '') { $line("✗ Missing {$k} — fill it in at the top of scripts/zoho_books_setup.php and re-run."); return; }
}

$line("Exchanging grant code for a refresh token…");
$resp = \Illuminate\Support\Facades\Http::asForm()->post("{$ACCOUNTS_URL}/oauth/v2/token", [
    'grant_type'    => 'authorization_code',
    'client_id'     => trim($CLIENT_ID),
    'client_secret' => trim($CLIENT_SECRET),
    'code'          => trim($GRANT_CODE),
]);

$data = $resp->json() ?? [];
$refresh = $data['refresh_token'] ?? null;

if (!$refresh) {
    $line("✗ No refresh token returned. Zoho said:");
    $line('  ' . json_encode($data));
    $line("  Common causes: grant code expired/already used (generate a fresh one), wrong DC (must be .in),");
    $line("  or the scope didn't include ZohoBooks.fullaccess.all.");
    return;
}
$line("✓ Got a refresh token.");

/* ── write the ZOHO_BOOKS_* keys into .env (preserve everything else) ── */
$envPath = base_path('.env');
$env = file_exists($envPath) ? file_get_contents($envPath) : '';
$set = function (string $key, string $val) use (&$env) {
    $lineStr = $key . '=' . $val;
    if (preg_match('/^' . preg_quote($key, '/') . '=.*$/m', $env)) {
        $env = preg_replace('/^' . preg_quote($key, '/') . '=.*$/m', $lineStr, $env);
    } else {
        $env = rtrim($env, "\n") . "\n" . $lineStr . "\n";
    }
};
$set('ZOHO_BOOKS_ORG_ID', $ORG_ID);
$set('ZOHO_BOOKS_CLIENT_ID', trim($CLIENT_ID));
$set('ZOHO_BOOKS_CLIENT_SECRET', trim($CLIENT_SECRET));
$set('ZOHO_BOOKS_REFRESH_TOKEN', $refresh);
file_put_contents($envPath, $env);
$line("✓ Wrote ZOHO_BOOKS_ORG_ID / _CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN to .env");

\Illuminate\Support\Facades\Artisan::call('config:clear');
$line("✓ Cleared config cache.");
$line("\nNow create the live dummy records:");
$line("    php artisan tinker scripts/zoho_books_live_smoke.php");
