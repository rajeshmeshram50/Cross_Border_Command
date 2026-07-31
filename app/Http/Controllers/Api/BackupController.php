<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;

/**
 * Database backup (super-admin only).
 *
 * Produces a full logical dump of the active PostgreSQL database with pg_dump
 * and streams it back to the browser as a downloadable .sql file.
 *
 * Reliability notes:
 *  - The dump is written to a temp file FIRST (Process timeout 0 = no cap), so a
 *    non-zero pg_dump exit surfaces as a real HTTP 500 with the stderr text
 *    instead of a half-written download. Only on success do we stream the file.
 *  - set_time_limit(0) removes PHP's own execution cap; the frontend calls this
 *    with an Axios timeout of 0 so a large DB never trips a client timeout.
 *  - pg_dump path is configurable via PG_DUMP_PATH (falls back to "pg_dump" on
 *    PATH). PGPASSWORD is passed through the child env, never on the cmdline.
 */
class BackupController extends Controller
{
    public function download(Request $request)
    {
        $user = $request->user();
        abort_unless($user && $user->user_type === 'super_admin', 403,
            'Only administrators can download database backups.');

        @set_time_limit(0);

        $connection = config('database.default');
        $cfg        = config("database.connections.$connection");

        if (($cfg['driver'] ?? null) !== 'pgsql') {
            return response()->json([
                'message' => 'Database backup is only supported for PostgreSQL on this server.',
            ], 422);
        }

        $host = (string) ($cfg['host'] ?? '127.0.0.1');
        $port = (string) ($cfg['port'] ?? '5432');
        $dbUser = (string) ($cfg['username'] ?? '');
        $dbName = (string) ($cfg['database'] ?? '');
        $dbPass = (string) ($cfg['password'] ?? '');

        $pgDump = env('PG_DUMP_PATH', 'pg_dump');

        // If an explicit path was configured, make sure it actually exists so we
        // can fail fast with a clear message instead of an opaque proc error.
        if (str_contains($pgDump, DIRECTORY_SEPARATOR) && ! is_file($pgDump)) {
            return response()->json([
                'message' => 'pg_dump was not found at the configured PG_DUMP_PATH.',
            ], 500);
        }

        $dir = storage_path('app/backups');
        File::ensureDirectoryExists($dir);

        $filename = $dbName . '_backup_' . now()->format('Y-m-d_His') . '.sql';
        $path     = $dir . DIRECTORY_SEPARATOR . $filename;

        // Clean up any stale dumps (older than 1h) so failed/aborted downloads
        // don't accumulate on disk.
        foreach (File::glob($dir . DIRECTORY_SEPARATOR . '*.sql') as $old) {
            if (File::lastModified($old) < now()->subHour()->timestamp) {
                File::delete($old);
            }
        }

        // pg_dump 18 wraps plain-SQL output in a psql \restrict <key> block and
        // generates that key with the OS strong-RNG. Under a Windows service
        // account (XAMPP's Apache) that RNG call can fail with "could not
        // generate restrict key". We sidestep it entirely by supplying our own
        // alphanumeric key from PHP's random_bytes, which works under any account.
        $restrictKey = bin2hex(random_bytes(16));

        $command = [
            $pgDump,
            '-h', $host,
            '-p', $port,
            '-U', $dbUser,
            '-d', $dbName,
            '--no-owner',
            '--no-privileges',
            '--clean',
            '--if-exists',
            '--restrict-key', $restrictKey,
            '-f', $path,
        ];

        // Build a COMPLETE child environment. Under `artisan serve` / Apache the
        // process Laravel spawns does not reliably inherit PATH, so pg_dump.exe
        // cannot locate its sibling DLLs (libpq, etc.) and dies with an empty
        // "pg_dump: error:" (exit 1). We pass an explicit env: PGPASSWORD, a PATH
        // that starts with pg_dump's own bin directory, plus SystemRoot/System32
        // for the Windows crypto + core DLLs.
        $systemRoot = getenv('SystemRoot') ?: 'C:\\Windows';
        $pathParts  = array_filter([
            str_contains($pgDump, DIRECTORY_SEPARATOR) ? dirname($pgDump) : null,
            getenv('PATH') ?: null,
            $systemRoot . DIRECTORY_SEPARATOR . 'System32',
        ]);
        $procEnv = [
            'PGPASSWORD' => $dbPass,
            'PATH'       => implode(PATH_SEPARATOR, $pathParts),
            'SystemRoot' => $systemRoot,
        ];

        try {
            $result = Process::timeout(0)
                ->env($procEnv)
                ->run($command);
        } catch (\Throwable $e) {
            Log::error('[DB Backup] pg_dump failed to start', ['error' => $e->getMessage()]);
            return response()->json([
                'message' => 'Could not start pg_dump. Check that PostgreSQL client tools are installed.',
                'error'   => $e->getMessage(),
            ], 500);
        }

        if (! $result->successful() || ! is_file($path) || filesize($path) === 0) {
            Log::error('[DB Backup] pg_dump exited non-zero', [
                'exit'   => $result->exitCode(),
                'stderr' => $result->errorOutput(),
            ]);
            if (is_file($path)) {
                File::delete($path);
            }
            return response()->json([
                'message' => 'Database backup failed.',
                'error'   => trim($result->errorOutput()) ?: 'pg_dump returned a non-zero exit code.',
            ], 500);
        }

        return response()
            ->download($path, $filename, [
                'Content-Type' => 'application/sql',
            ])
            ->deleteFileAfterSend(true);
    }
}
