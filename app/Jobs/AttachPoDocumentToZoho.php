<?php

namespace App\Jobs;

use App\Http\Controllers\Api\SalesPdfController;
use App\Models\PurchaseOrder;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Attaches the system-generated PO PDF to the synced Zoho Purchase Order and its
 * Bill. Runs on the QUEUE (not in the sync request) because rendering the PO PDF
 * can be slow for a long T&C — so the sync stays fast and the attachment lands a
 * few seconds later. Best-effort: any failure is logged, never retried to death.
 */
class AttachPoDocumentToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Allow a slow PDF render (dompdf caps itself at 180s). */
    public int $timeout = 300;
    /** Retry an incomplete attachment (render hiccup / Zoho upload error) a few
     *  times before giving up and marking it 'failed'. */
    public int $tries = 3;

    public function __construct(public int $poId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $po = PurchaseOrder::with('items')->find($this->poId);
        if (!$po || empty($po->zoho_purchaseorder_id)) return;

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        // The system PO document (unsigned) — CACHED: rendered once per PO version
        // and reused, so a re-attach or a prior download doesn't re-run the slow
        // dompdf render.
        try {
            $pdf = app(SalesPdfController::class)->renderPoPdfBytesCached($po);
        } catch (\Throwable $e) {
            Log::warning('Zoho attach: PO PDF render failed', ['po' => $po->id, 'err' => $e->getMessage()]);
            $po->forceFill(['zoho_attachment_status' => 'failed'])->saveQuietly();
            return;
        }
        if ($pdf === '') {
            $po->forceFill(['zoho_attachment_status' => 'failed'])->saveQuietly();
            return;
        }

        $filename = 'PO-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($po->code ?: $po->id)) . '.pdf';

        // Attach to the Zoho PO and its Bill — track how many we ATTEMPTED vs how
        // many SUCCEEDED so we can decide what "incomplete" should do.
        $attempted = 0;
        $succeeded = 0;
        if (!empty($po->zoho_purchaseorder_id)) {
            $attempted++;
            try {
                $books->attachToPurchaseOrder((string) $po->zoho_purchaseorder_id, $pdf, $filename);
                $succeeded++;
            } catch (\Throwable $e) {
                Log::warning('Zoho attach to PO failed', ['po' => $po->id, 'err' => $e->getMessage()]);
            }
        }
        if (!empty($po->zoho_bill_id)) {
            $attempted++;
            try {
                $books->attachToBill((string) $po->zoho_bill_id, $pdf, $filename);
                $succeeded++;
            } catch (\Throwable $e) {
                Log::warning('Zoho attach to bill failed', ['po' => $po->id, 'err' => $e->getMessage()]);
            }
        }

        if ($attempted === 0 || $succeeded === $attempted) {
            // Everything intended attached → done.
            $po->forceFill(['zoho_attachment_status' => 'done'])->saveQuietly();
        } elseif ($succeeded === 0) {
            // Nothing attached — safe to RETRY the whole job (no duplicate risk).
            // Throwing lets the queue re-run it with backoff; failed() records the
            // final give-up.
            throw new \RuntimeException('Zoho attachment failed for PO ' . $po->id);
        } else {
            // Partial success — retrying would DUPLICATE the one that worked, so
            // don't retry; flag it for a manual re-attach instead.
            Log::warning('Zoho attachment partial', ['po' => $po->id, 'attempted' => $attempted, 'succeeded' => $succeeded]);
            $po->forceFill(['zoho_attachment_status' => 'failed'])->saveQuietly();
        }
    }

    /** If the whole job errors out (or exhausts tries), record the failure. */
    public function failed(\Throwable $e): void
    {
        PurchaseOrder::where('id', $this->poId)->update(['zoho_attachment_status' => 'failed']);
    }
}
