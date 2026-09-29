<?php

namespace App\Jobs;

use App\Models\P2p\PoRefundAdjustment;
use App\Models\P2p\PoRefundRecovery;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Puts the proof of a refund received back from the supplier into Zoho Books, on
 * the VENDOR CREDIT the refund was taken against. A Zoho refund is a sub-record
 * of its credit and carries no attachment endpoint of its own, so the credit is
 * where the evidence can live and still be found from the refund.
 *
 * Runs on the QUEUE and is best-effort: the refund is recorded either way.
 */
class AttachRefundRecoveryToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 180;
    public int $tries = 3;

    public function __construct(public int $recoveryId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $rec = PoRefundRecovery::withoutGlobalScope('tenant')->find($this->recoveryId);
        if (!$rec || empty($rec->zoho_refund_id)) return;

        $adj = PoRefundAdjustment::withoutGlobalScope('tenant')->find($rec->refund_adjustment_id);
        if (!$adj || empty($adj->zoho_vendorcredit_id)) return;

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        /* The whole set when the row has one, else the single legacy column —
           the same reading the download endpoint does. */
        $files = array_values(array_filter(
            is_array($rec->proof_files) ? $rec->proof_files : [],
            fn ($f) => is_array($f) && !empty($f['path']),
        ));
        if (!$files && $rec->proof_path) {
            $files = [['path' => $rec->proof_path, 'name' => $rec->proof_name ?: basename($rec->proof_path)]];
        }
        if (!$files) return;

        $disk   = Storage::disk('public');
        $sent   = 0;
        $failed = 0;

        foreach ($files as $f) {
            if (!$disk->exists($f['path'])) {
                Log::warning('Zoho attach: recovery proof missing on disk', ['recovery' => $rec->id, 'path' => $f['path']]);
                continue;
            }
            $name = $f['name'] ?: basename($f['path']);
            // Named by the recovery, so several refunds on one credit stay tellable apart.
            $filename = 'REFUND-' . $rec->id . '-' . preg_replace('/[^A-Za-z0-9._-]/', '_', $name);

            try {
                $books->attachToVendorCredit((string) $adj->zoho_vendorcredit_id, $disk->get($f['path']), $filename);
                $sent++;
            } catch (\Throwable $e) {
                $failed++;
                Log::warning('Zoho attach recovery proof to vendor credit failed', ['recovery' => $rec->id, 'err' => $e->getMessage()]);
            }
        }

        /* Zoho's attachment endpoint accumulates rather than replaces, so a retry
           would duplicate whatever already landed. Only retry when none did. */
        if ($failed && $sent === 0) {
            throw new \RuntimeException('Zoho attachment failed for refund recovery ' . $rec->id);
        }
    }
}
