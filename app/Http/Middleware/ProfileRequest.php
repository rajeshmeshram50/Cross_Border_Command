<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class ProfileRequest
{
    private const TTL_SECONDS = 600;

    public static function cacheKey(string $id): string
    {
        return 'devtools:profile:' . $id;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $full = $request->header('X-Profile') === '1'
            && app()->environment(['local', 'staging']);

        $timing = !$full && config('app.profile_timing');

        if (!$full && !$timing) {
            return $next($request);
        }

        DB::flushQueryLog();
        DB::enableQueryLog();
        $start = microtime(true);

        $rollback = $request->header('X-Profile-Rollback') === '1';

        if ($rollback) {
            $captured = null;
            try {
                DB::transaction(function () use ($next, $request, &$captured) {
                    $captured = $next($request);
                    throw new ProfileRollback();
                });
            } catch (ProfileRollback) {
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
            $response->headers->add([
                'X-Profile-Total-Ms' => round($totalMs, 1),
                'X-Profile-Query-Ms' => round($queryMs, 1),
                'X-Profile-Queries'  => count($log),
                'X-Profile-Mode'     => 'timing',
            ]);
            return $response;
        }

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

class ProfileRollback extends \RuntimeException
{
}
