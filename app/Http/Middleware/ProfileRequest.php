<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Per-request profiler for the Dev Tools → Load Testing screen.
 *
 * Opt-in: does nothing unless the caller sends `X-Profile: 1`, so normal traffic
 * pays no cost. When asked, it turns on the query log for the request and reports
 * back through response headers:
 *
 *   X-Profile-Total-Ms   wall clock inside the middleware
 *   X-Profile-Query-Ms   time the database spent executing
 *   X-Profile-Queries    how many statements ran   ← the N+1 signal
 *   X-Profile-Memory-Kb  peak memory for the request
 *   X-Profile-Id         key to fetch the FULL statement list afterwards
 *
 * Headers rather than a wrapper envelope, deliberately: the response body stays
 * byte-identical to a normal call, so what Load Testing measures is exactly what
 * the real screen receives. The full SQL flow will not fit in a header, so it is
 * parked in the cache under X-Profile-Id and fetched by a second call.
 *
 * `X-Profile-Rollback: 1` additionally wraps the request in a transaction that is
 * always rolled back. That is what makes it safe to profile Add / Edit / Delete:
 * the controller really runs, really writes, and really reports its query cost —
 * then the database is put back exactly as it was.
 *
 * Local/staging only. Query logging retains every statement in memory, and the
 * cached SQL can contain customer data.
 */
class ProfileRequest
{
    /** How long a captured statement list stays fetchable. */
    private const TTL_SECONDS = 600;

    public static function cacheKey(string $id): string
    {
        return 'devtools:profile:' . $id;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $full = $request->header('X-Profile') === '1'
            && app()->environment(['local', 'staging']);

        /* Lightweight mode — safe anywhere, including production.
         *
         * Enabled with PROFILE_TIMING=true in .env. Emits three numbers and no
         * SQL: total time, database time, statement count. That is enough to
         * separate the two possible answers —
         *
         *   query time high              → the SQL is the problem
         *   query time low, total high   → the SQL is NOT the problem; the cost
         *                                  is per-request overhead (no config /
         *                                  route cache, no OPcache, cold
         *                                  autoloader, APP_DEBUG on)
         *
         * No statement list, no bindings, nothing cached — so no customer data
         * leaves the process and memory stays flat. */
        $timing = !$full && config('app.profile_timing');

        if (!$full && !$timing) {
            return $next($request);
        }

        DB::flushQueryLog();     // the log accumulates; without this the count is cumulative
        DB::enableQueryLog();
        $start = microtime(true);

        $rollback = $request->header('X-Profile-Rollback') === '1';

        if ($rollback) {
            /* Run the real controller inside a transaction we always undo. The
               sentinel exception is how we get the response object back out —
               returning normally would commit. */
            $captured = null;
            try {
                DB::transaction(function () use ($next, $request, &$captured) {
                    $captured = $next($request);
                    throw new ProfileRollback();
                });
            } catch (ProfileRollback) {
                // Expected: the write has been undone.
            }
            $response = $captured ?? response()->json(['message' => 'Profiled request produced no response.'], 500);
        } else {
            $response = $next($request);
        }

        $totalMs = (microtime(true) - $start) * 1000;
        $log     = DB::getQueryLog();
        DB::disableQueryLog();

        $queryMs = 0.0;
        foreach ($log as $entry) {
            $queryMs += (float) ($entry['time'] ?? 0);
        }

        if ($timing) {
            /* Aggregates only. Deliberately no X-Profile-Id: there is nothing
               parked to fetch, and offering an id that resolves to nothing
               would be worse than offering none. */
            $response->headers->add([
                'X-Profile-Total-Ms' => round($totalMs, 1),
                'X-Profile-Query-Ms' => round($queryMs, 1),
                'X-Profile-Queries'  => count($log),
                'X-Profile-Mode'     => 'timing',
            ]);
            return $response;
        }

        // Park the full statement list for the drill-down view.
        $id = (string) Str::uuid();
        Cache::put(self::cacheKey($id), [
            'method'    => $request->method(),
            'path'      => '/' . ltrim($request->path(), '/'),
            'rolled_back' => $rollback,
            'total_ms'  => round($totalMs, 1),
            'query_ms'  => round($queryMs, 1),
            'queries'   => array_map(fn ($e, $i) => [
                'n'    => $i + 1,
                'sql'  => preg_replace('/\s+/', ' ', trim($e['query'])),
                'ms'   => round((float) ($e['time'] ?? 0), 2),
                // Bindings are values from real rows — useful for spotting a
                // per-row lookup, but they can carry personal data, so they are
                // capped rather than dumped wholesale.
                'bindings' => array_slice(array_map(
                    fn ($b) => is_scalar($b) || $b === null ? $b : '(object)',
                    $e['bindings'] ?? []
                ), 0, 8),
            ], $log, array_keys($log)),
        ], self::TTL_SECONDS);

        $response->headers->add([
            'X-Profile-Total-Ms'  => round($totalMs, 1),
            'X-Profile-Query-Ms'  => round($queryMs, 1),
            'X-Profile-Queries'   => count($log),
            'X-Profile-Memory-Kb' => round(memory_get_peak_usage(true) / 1024),
            'X-Profile-Id'        => $id,
            'X-Profile-Rolled-Back' => $rollback ? '1' : '0',
        ]);

        return $response;
    }
}

/** Sentinel used to unwind the profiling transaction. Never escapes the middleware. */
class ProfileRollback extends \RuntimeException
{
}
