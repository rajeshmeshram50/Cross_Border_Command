<?php

namespace App\Jobs;

use App\Models\P2p\PoRefundAdjustment;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Puts the refund reference the user uploaded on the Zoho vendor credit raised
 * from an Advance Receipt Refund Adjustment, so the supplier's own document sits
 * with the credit in Zoho Books rather than only in our vault.
 *
 * Runs on the QUEUE, like the debit note's attachment: the sync must not wait on
 * a file upload, and a Zoho hiccup must not fail a credit that was created fine.
 * Best-effort — the attachment is not what the credit means.
 */
class AttachRefundAdjustmentToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries = 3;

    public function __construct(public int $adjustmentId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $adj = PoRefundAdjustment::withoutGlobalScope('tenant')->find($this->adjustmentId);
        if (!$adj || empty($adj->zoho_vendorcredit_id) || empty($adj->attachment_path)) return;

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        $disk = Storage::disk('public');
        if (!$disk->exists($adj->attachment_path)) {
            Log::warning('Zoho attach: ADR attachment missing on disk', ['adr' => $adj->id, 'path' => $adj->attachment_path]);
            return;
        }

        $name = $adj->attachment_name ?: basename($adj->attachment_path);
        // Zoho shows the file name as given; prefix it with the refund number so
        // the credit's attachment is identifiable from the list alone.
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '_', (string) ($adj->code ?: $adj->id)) . '-' . $name;

        try {
            $books->attachToVendorCredit((string) $adj->zoho_vendorcredit_id, $disk->get($adj->attachment_path), $filename);
        } catch (\Throwable $e) {
            // Nothing landed, so the whole job is safe to retry — no duplicate risk.
            Log::warning('Zoho attach to vendor credit failed', ['adr' => $adj->id, 'err' => $e->getMessage()]);
            throw new \RuntimeException('Zoho attachment failed for refund adjustment ' . $adj->id, 0, $e);
        }
    }
}
