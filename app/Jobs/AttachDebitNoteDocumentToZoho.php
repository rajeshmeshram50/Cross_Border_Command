<?php

namespace App\Jobs;

use App\Http\Controllers\Api\SalesPdfController;
use App\Models\DebitNote;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Attaches the system-generated Debit Note PDF to the synced Zoho vendor credit
 * (Zoho's purchase debit note). Runs on the QUEUE (not in the sync request)
 * because rendering the PDF can be slow — so the sync stays fast and the
 * attachment lands a few seconds later. Best-effort: any failure is logged.
 *
 * Deadlock-safe by construction: the slow PDF render + Zoho HTTP upload happen
 * OUTSIDE any DB transaction, and the only DB write is a single-column
 * saveQuietly() at the very end — so no debit_notes row lock is ever held across
 * network I/O. The sync controller dispatches this job INSIDE the same
 * transaction that flips zoho_attachment_status to 'queued', so with the
 * database queue driver the job row commits atomically with the DN row and no
 * worker can pick it up until that row's lock is released.
 */
class AttachDebitNoteDocumentToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Allow a slow PDF render (dompdf caps itself at 180s). */
    public int $timeout = 300;
    /** Retry an incomplete attachment (render hiccup / Zoho upload error) a few
     *  times before giving up and marking it 'failed'. */
    public int $tries = 3;

    public function __construct(public int $debitNoteId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $dn = DebitNote::with(['items', 'charges'])->find($this->debitNoteId);
        if (!$dn || empty($dn->zoho_vendorcredit_id)) return;

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        // The system Debit Note document (unsigned) — CACHED: rendered once per
        // debit-note version and reused, so a re-attach or a prior download
        // doesn't re-run the slow dompdf render.
        try {
            $pdf = app(SalesPdfController::class)->renderDebitNotePdfBytesCached($dn);
        } catch (\Throwable $e) {
            Log::warning('Zoho attach: DN PDF render failed', ['dn' => $dn->id, 'err' => $e->getMessage()]);
            $dn->forceFill(['zoho_attachment_status' => 'failed'])->saveQuietly();
            return;
        }
        if ($pdf === '') {
            $dn->forceFill(['zoho_attachment_status' => 'failed'])->saveQuietly();
            return;
        }

        $filename = 'DN-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($dn->code ?: $dn->id)) . '.pdf';

        try {
            $books->attachToVendorCredit((string) $dn->zoho_vendorcredit_id, $pdf, $filename);
        } catch (\Throwable $e) {
            // Nothing attached — safe to RETRY the whole job (no duplicate risk).
            // Throwing lets the queue re-run it with backoff; failed() records the
            // final give-up.
            Log::warning('Zoho attach to vendor credit failed', ['dn' => $dn->id, 'err' => $e->getMessage()]);
            throw new \RuntimeException('Zoho attachment failed for debit note ' . $dn->id, 0, $e);
        }

        $dn->forceFill(['zoho_attachment_status' => 'done'])->saveQuietly();
    }

    /** If the whole job errors out (or exhausts tries), record the failure. */
    public function failed(\Throwable $e): void
    {
        DebitNote::where('id', $this->debitNoteId)->update(['zoho_attachment_status' => 'failed']);
    }
}
