<?php

namespace App\Services;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * Generates a full logical dump of the active PostgreSQL database with pg_dump.
 *
 * Used by the scheduled backup command (backup:email). Kept request-free so it
 * can run from the console with no authenticated user.
 *
 * Reliability notes (learned the hard way running under XAMPP/Apache):
 *  - pg_dump 18 wraps plain-SQL output in a psql \restrict <key> block whose key
 *    is generated from the OS strong-RNG; under a Windows service account that
 *    call fails ("could not generate restrict key"). We supply our own key via
 *    --restrict-key so pg_dump never touches the OS RNG.
 *  - The spawned process does not reliably inherit PATH, so pg_dump.exe cannot
 *    find its sibling DLLs (libpq, etc.) and dies with an empty "pg_dump: error:".
 *    We pass an explicit PATH that starts with pg_dump's own bin directory.
 *  - PG_DUMP_PATH (env) points at the pg_dump binary; falls back to "pg_dump".
 */
class DatabaseBackupService
{
    /**
     * Run pg_dump into a temp file and return its path + filename.
     *
     * @return array{path:string, filename:string}
     * @throws RuntimeException on any failure (message is safe to surface/log).
     */
    public function generate(): array
    {
        @set_time_limit(0);

        $connection = config('database.default');
        $cfg        = config("database.connections.$connection");

        if (($cfg['driver'] ?? null) !== 'pgsql') {
            throw new RuntimeException('Database backup is only supported for PostgreSQL on this server.');
        }

        $host   = (string) ($cfg['host'] ?? '127.0.0.1');
        $port   = (string) ($cfg['port'] ?? '5432');
        $dbUser = (string) ($cfg['username'] ?? '');
        $dbName = (string) ($cfg['database'] ?? '');
        $dbPass = (string) ($cfg['password'] ?? '');

        $pgDump = env('PG_DUMP_PATH', 'pg_dump');

        if (str_contains($pgDump, DIRECTORY_SEPARATOR) && ! is_file($pgDump)) {
            throw new RuntimeException('pg_dump was not found at the configured PG_DUMP_PATH.');
        }

        $dir = storage_path('app/backups');
        File::ensureDirectoryExists($dir);

        $filename = $dbName . '_backup_' . now()->format('Y-m-d_His') . '.sql';
        $path     = $dir . DIRECTORY_SEPARATOR . $filename;

        // Sweep stale dumps (>1h) so aborted runs don't pile up.
        foreach (File::glob($dir . DIRECTORY_SEPARATOR . '*.sql') as $old) {
            if (File::lastModified($old) < now()->subHour()->timestamp) {
                File::delete($old);
            }
        }

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
            $result = Process::timeout(0)->env($procEnv)->run($command);
        } catch (\Throwable $e) {
            Log::error('[DB Backup] pg_dump failed to start', ['error' => $e->getMessage()]);
            throw new RuntimeException('Could not start pg_dump. Check that PostgreSQL client tools are installed.');
        }

        if (! $result->successful() || ! is_file($path) || filesize($path) === 0) {
            Log::error('[DB Backup] pg_dump exited non-zero', [
                'exit'   => $result->exitCode(),
                'stderr' => $result->errorOutput(),
            ]);
            if (is_file($path)) {
                File::delete($path);
            }
            throw new RuntimeException(trim($result->errorOutput()) ?: 'pg_dump returned a non-zero exit code.');
        }

        return ['path' => $path, 'filename' => $filename];
    }
}
