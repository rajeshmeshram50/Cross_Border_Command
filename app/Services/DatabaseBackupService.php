<?php

namespace App\Services;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use RuntimeException;

class DatabaseBackupService
{
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

        foreach (File::glob($dir . DIRECTORY_SEPARATOR . '*.sql*') as $old) {
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

    public function compress(string $sqlPath, string $sqlFilename): array
    {
        @set_time_limit(0);

        $gzPath = $sqlPath . '.gz';

        $in = @fopen($sqlPath, 'rb');
        if ($in === false) {
            throw new RuntimeException('Could not open the generated dump for compression.');
        }

        $out = @gzopen($gzPath, 'wb6');
        if ($out === false) {
            fclose($in);
            throw new RuntimeException('Could not create the compressed backup file.');
        }

        while (! feof($in)) {
            $chunk = fread($in, 1048576);
            if ($chunk === false) {
                fclose($in);
                gzclose($out);
                File::delete($gzPath);
                throw new RuntimeException('Failed while reading the dump for compression.');
            }
            if ($chunk !== '' && gzwrite($out, $chunk) === false) {
                fclose($in);
                gzclose($out);
                File::delete($gzPath);
                throw new RuntimeException('Failed while writing the compressed backup.');
            }
        }

        fclose($in);
        gzclose($out);
        File::delete($sqlPath);

        clearstatcache(true, $gzPath);
        $size = (int) @filesize($gzPath);
        if ($size <= 0) {
            File::delete($gzPath);
            throw new RuntimeException('The compressed backup came out empty.');
        }

        return ['path' => $gzPath, 'filename' => $sqlFilename . '.gz', 'size' => $size];
    }
}
