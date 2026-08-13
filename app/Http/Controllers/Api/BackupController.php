<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\DatabaseBackupMail;
use App\Services\DatabaseBackupService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use RuntimeException;

/**
 * Database backup email (super-admin only).
 *
 * The scheduler auto-sends a gzip-compressed pg_dump every 15 days
 * (see App\Console\Commands\SendDatabaseBackupEmail + routes/console.php).
 * These endpoints expose that same pipeline to the admin UI:
 *  - GET  /backup/email/status  → when it last went out + when it's next due.
 *  - POST /backup/email/send    → generate + email a backup right now (on demand,
 *                                 ignores the 15-day gate) and re-stamp the marker.
 *
 * The heavy lifting (pg_dump, env, restrict-key) lives in DatabaseBackupService
 * so the console command and this controller stay in lockstep.
 */
class BackupController extends Controller
{
    /** Keep in step with SendDatabaseBackupEmail::INTERVAL_DAYS. */
    private const INTERVAL_DAYS = 15;

    private function markerPath(): string
    {
        return storage_path('app/backups/.last_email_backup');
    }

    /** Read the last-sent timestamp from the marker file, or null. */
    private function lastSentAt(): ?Carbon
    {
        $marker = $this->markerPath();
        if (! File::exists($marker)) {
            return null;
        }
        try {
            return Carbon::parse(trim((string) File::get($marker)));
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Resolve recipients: explicit override, else BACKUP_EMAIL_RECIPIENTS,
     * else MAIL_FROM_ADDRESS. Trimmed, lowercased, de-duped, validated.
     *
     * @return list<string>
     */
    private function recipients(string $override = ''): array
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

    /** GET /backup/email/status — last send + next due + configured recipients. */
    public function status(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $last = $this->lastSentAt();
        $due  = $last?->copy()->addDays(self::INTERVAL_DAYS);

        return response()->json([
            'interval_days'  => self::INTERVAL_DAYS,
            'recipients'     => $this->recipients(),
            'last_sent_at'   => $last?->toIso8601String(),
            'last_sent_human'=> $last?->diffForHumans(),
            'next_due_at'    => $due?->toDateString(),
            'is_due_now'     => $last === null || $last->diffInDays(now()) >= self::INTERVAL_DAYS,
            'ever_sent'      => $last !== null,
        ]);
    }

    /** POST /backup/email/send — generate + email a backup now (on demand). */
    public function send(Request $request, DatabaseBackupService $service): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'to' => ['nullable', 'string'],
        ]);

        $recipients = $this->recipients((string) ($data['to'] ?? ''));
        if (empty($recipients)) {
            return response()->json([
                'message' => 'No recipients configured. Set BACKUP_EMAIL_RECIPIENTS in .env or pass "to".',
            ], 422);
        }

        // --- Generate ---------------------------------------------------
        try {
            $dump = $service->generate();
        } catch (RuntimeException $e) {
            Log::error('[DB Backup] API send — generation failed', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Backup generation failed: ' . $e->getMessage()], 500);
        }

        // --- Compress for email (streamed — never held in memory) --------
        try {
            $gz = $service->compress($dump['path'], $dump['filename']);
        } catch (RuntimeException $e) {
            File::delete($dump['path']);
            Log::error('[DB Backup] API send — compression failed', ['error' => $e->getMessage()]);
            return response()->json(['message' => $e->getMessage()], 500);
        }

        $connection = config('database.default');
        $dbName     = (string) config("database.connections.$connection.database");

        // --- Send -------------------------------------------------------
        try {
            Mail::to($recipients)->send(new DatabaseBackupMail(
                databaseName: $dbName,
                generatedAt: now()->format('d M Y, H:i'),
                senderName: (string) ($request->user()?->name ?? 'Admin'),
                gzPath: $gz['path'],
                gzFilename: $gz['filename'],
                gzSize: $gz['size'],
            ));
        } catch (\Throwable $e) {
            File::delete($gz['path']);
            Log::error('[DB Backup] API send failed', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Backup email failed: ' . $e->getMessage()], 500);
        }

        File::delete($gz['path']);

        // Stamp success so the scheduled 15-day clock restarts from now too.
        File::put($this->markerPath(), now()->toIso8601String());

        $sizeKb = (int) round($gz['size'] / 1024);
        Log::info('[DB Backup] API send OK', ['recipients' => $recipients, 'size_kb' => $sizeKb]);

        return response()->json([
            'message'    => 'Backup emailed successfully.',
            'recipients' => $recipients,
            'size_kb'    => $sizeKb,
            'sent_at'    => now()->toIso8601String(),
        ]);
    }

    /** Only super-admins may generate/email full database dumps. */
    private function authorizeAdmin(Request $request): void
    {
        $user = $request->user();
        abort_unless($user && $user->user_type === 'super_admin', 403,
            'Only administrators can send database backups.');
    }
} 
