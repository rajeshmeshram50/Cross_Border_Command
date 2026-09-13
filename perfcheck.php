<?php
/*
 * Server performance diagnostic — throwaway, delete after use.
 *
 *   php artisan tinker --execute="require base_path('perfcheck.php');"
 *
 * Splits a request into its parts so we can see WHICH layer is slow, instead
 * of guessing. Run it on the server, then run it locally, and compare.
 */

echo PHP_EOL . '================ ENVIRONMENT ================' . PHP_EOL;
printf("  PHP            %s%s", PHP_VERSION, PHP_EOL);
printf("  APP_ENV        %s%s", config('app.env'), PHP_EOL);
printf("  APP_DEBUG      %s%s", config('app.debug') ? 'TRUE  <-- should be false in prod' : 'false', PHP_EOL);
printf("  DB host        %s%s", config('database.connections.' . config('database.default') . '.host'), PHP_EOL);
printf("  CACHE_STORE    %s%s", config('cache.default'), PHP_EOL);
printf("  SESSION_DRIVER %s%s", config('session.driver'), PHP_EOL);

echo PHP_EOL . '================ OPCACHE ================' . PHP_EOL;
if (!function_exists('opcache_get_status')) {
    echo '  opcache extension NOT LOADED   <-- every request recompiles all PHP' . PHP_EOL;
} else {
    $o = @opcache_get_status(false);
    if (!$o || empty($o['opcache_enabled'])) {
        echo '  opcache DISABLED               <-- every request recompiles all PHP' . PHP_EOL;
    } else {
        printf("  opcache ENABLED  hit rate %.1f%%  cached files %d%s",
            $o['opcache_statistics']['opcache_hit_rate'] ?? 0,
            $o['opcache_statistics']['num_cached_scripts'] ?? 0, PHP_EOL);
    }
}

echo PHP_EOL . '================ LARAVEL CACHES ================' . PHP_EOL;
foreach (['config' => 'config.php', 'routes' => 'routes-v7.php', 'events' => 'events.php'] as $label => $file) {
    $p = base_path('bootstrap/cache/' . $file);
    printf("  %-8s %s%s", $label, file_exists($p) ? 'cached' : 'NOT CACHED  <-- rebuilt every request', PHP_EOL);
}

echo PHP_EOL . '================ DATABASE ROUND TRIP ================' . PHP_EOL;
DB::select('select 1');                       // warm the connection
$t = microtime(true);
for ($i = 0; $i < 20; $i++) { DB::select('select 1'); }
$per = ((microtime(true) - $t) * 1000) / 20;
printf("  %.2f ms per trivial query (20 samples)%s", $per, PHP_EOL);
printf("  -> 13 queries would cost ~%.0f ms just in round trips%s", $per * 13, PHP_EOL);
if ($per > 5) echo '  *** HIGH — the database is not local to this server ***' . PHP_EOL;

echo PHP_EOL . '================ THE ENDPOINT ITSELF ================' . PHP_EOL;
$u = App\Models\User::where('client_id', 1)->first();
if (!$u) { echo '  no user found for client 1' . PHP_EOL; return; }
$mk = function () use ($u) {
    $r = Illuminate\Http\Request::create('/x', 'GET', ['page' => 1, 'per_page' => 10]);
    $r->setUserResolver(fn () => $u);
    return $r;
};
$ctl = new App\Http\Controllers\Api\ClmAuthorityController();
$ctl->index($mk());                            // warm
DB::flushQueryLog(); DB::enableQueryLog();
$t = microtime(true);
$ctl->index($mk());
$ms = (microtime(true) - $t) * 1000;
$log = DB::getQueryLog(); DB::disableQueryLog();
$sql = array_sum(array_column($log, 'time'));
printf("  controller total   %7.0f ms%s", $ms, PHP_EOL);
printf("  of which SQL       %7.0f ms  (%d queries)%s", $sql, count($log), PHP_EOL);
printf("  of which PHP       %7.0f ms%s", $ms - $sql, PHP_EOL);

echo PHP_EOL . '================ READING ================' . PHP_EOL;
echo '  If the controller total here is small (<300ms) but the browser sees 4s,' . PHP_EOL;
echo '  the time is in framework BOOT or the web server, not this code.' . PHP_EOL;
echo '  Compare this output against the same script run locally.' . PHP_EOL . PHP_EOL;
