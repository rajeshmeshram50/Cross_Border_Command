<?php

namespace App\Console\Commands;

use App\Mail\DatabaseBackupMail;
use App\Services\DatabaseBackupService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use RuntimeException;

class SendDatabaseBackupEmail extends Command
{
    protected $signature = 'backup:email
                            {--force : Send now even if 15 days have not yet elapsed}
                            {--to= : Override recipients for this run (comma-separated)}
                            {--dry : Show what would happen without generating or sending}';

    protected $description = 'Email a gzip-compressed database backup to the configured recipients (auto every 15 days).';

    private const INTERVAL_DAYS = 15;

    public function handle(DatabaseBackupService $service): int
    {
        $force  = (bool) $this->option('force');
        $dry    = (bool) $this->option('dry');
        $marker = storage_path('app/backups/.last_email_backup');

        $last = $this->lastSentAt($marker);
        if (! $force && $last && $last->diffInDays(now()) < self::INTERVAL_DAYS) {
            $due = $last->copy()->addDays(self::INTERVAL_DAYS);
            $this->info("Not due yet — last backup {$last->diffForHumans()}; next due {$due->toDateString()}. Use --force to override.");
            return self::SUCCESS;
        }

        $recipients = $this->recipients((string) ($this->option('to') ?? ''));
        if (empty($recipients)) {
            $this->error('No recipients configured. Set BACKUP_EMAIL_RECIPIENTS in .env (comma-separated).');
            Log::warning('[DB Backup] auto-email skipped — no recipients configured.');
            return self::FAILURE;
        }

        if ($dry) {
            $this->line('DRY RUN — would generate a backup and email it to: ' . implode(', ', $recipients));
            return self::SUCCESS;
        }

        try {
            $dump = $service->generate();
        } catch (RuntimeException $e) {
            $this->error('Backup generation failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        try {
            $gz = $service->compress($dump['path'], $dump['filename']);
        } catch (RuntimeException $e) {
            File::delete($dump['path']);
            $this->error($e->getMessage());
            return self::FAILURE;
        }

        $connection = config('database.default');
        $dbName     = (string) config("database.connections.$connection.database");

        try {
            Mail::to($recipients)->send(new DatabaseBackupMail(
                databaseName: $dbName,
                generatedAt: now('Asia/Kolkata')->format('d M Y, H:i'),
                senderName: 'Scheduled backup',
                gzPath: $gz['path'],
                gzFilename: $gz['filename'],
                gzSize: $gz['size'],
            ));
        } catch (\Throwable $e) {
            File::delete($gz['path']);
            $this->error('Backup email failed: ' . $e->getMessage());
            Log::error('[DB Backup] auto-email send failed', ['error' => $e->getMessage()]);
            return self::FAILURE;
        }

        File::delete($gz['path']);

        File::put($marker, now()->toIso8601String());

        $sizeKb = number_format($gz['size'] / 1024, 0);
        $this->info("✓ Backup emailed ({$sizeKb} KB) to: " . implode(', ', $recipients));
        Log::info('[DB Backup] auto-email sent', ['recipients' => $recipients, 'size_kb' => $sizeKb]);
        return self::SUCCESS;
    }

    private function lastSentAt(string $marker): ?Carbon
    {
        if (! File::exists($marker)) {
            return null;
        }
        try {
            return Carbon::parse(trim((string) File::get($marker)));
        } catch (\Throwable) {
            return null;
        }
    }

    private function recipients(string $override): array
    {
        $raw = $override !== ''
            ? $override
            : (string) env('BACKUP_EMAIL_RECIPIENTS', (string) config('mail.from.address', ''));

        return collect(explode(',', $raw))
            ->map(fn ($e) => strtolower(trim($e)))
            ->filter(fn ($e) => filter_var($e, FILTER_VALIDATE_EMAIL))
            ->unique()
            ->values()
            ->all();
    }
}
