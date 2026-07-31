<?php

namespace App\Jobs;

use App\Models\PurchaseOrder;
use App\Models\SupplierPurchaseInvoice;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Attaches a supplier purchase invoice's UPLOADED document (the file the user
 * attached to the SPI) to its linked PO's Zoho Purchase Order AND Bill — sitting
 * alongside the PO's own PDF (Zoho's attachment endpoint appends, it doesn't
 * replace). Runs on the queue so a sync/payment request stays fast.
 *
 * Idempotent: once the file lands on the PO it stamps `zoho_doc_attached_at`, and
 * a job for an already-attached SPI is a no-op — this is what stops the same file
 * being appended twice (Zoho would keep both copies).
 *
 * Only WITH-PO invoices apply (a direct SPI has no PO to attach against).
 */
class AttachSpiDocumentToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries = 3;

    public function __construct(public int $spiId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $spi = SupplierPurchaseInvoice::find($this->spiId);
        // No SPI, nothing uploaded, or already attached → nothing to do.
        if (!$spi || empty($spi->attachment_path)) return;
        if (!empty($spi->zoho_doc_attached_at)) return;

        // Targets differ by invoice type:
        //  • With-PO   → the linked PO's Zoho purchase order (primary) + its bill.
        //  • Direct    → the invoice's OWN Zoho bill (there is no PO).
        $poZohoId = null;
        $billId   = null;
        if ($spi->purchase_order_id) {
            $po = PurchaseOrder::find($spi->purchase_order_id);
            if (!$po || empty($po->zoho_purchaseorder_id)) return;
            $poZohoId = (string) $po->zoho_purchaseorder_id;
            $billId   = $po->zoho_bill_id ? (string) $po->zoho_bill_id : null;
        } else {
            if (empty($spi->zoho_bill_id)) return;   // direct invoice not synced yet
            $billId = (string) $spi->zoho_bill_id;
        }

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        // Normalise the stored attachment_path to a disk-relative path. It is saved
        // as a PUBLIC URL path ("/storage/spi/12/inv.pdf"), but the public disk root
        // is storage/app/public, so we must strip the "/storage/" prefix down to
        // "spi/12/inv.pdf" (mirrors download()'s own normalisation).
        $raw  = preg_replace('/\?.*$/', '', (string) $spi->attachment_path);
        if (!preg_match('#(spi/.+)$#i', $raw, $m)) {
            Log::warning('Zoho attach SPI doc: unrecognised path', ['spi' => $spi->id, 'path' => $spi->attachment_path]);
            return;
        }
        $path = $m[1];

        // Read the uploaded document off the public disk.
        if (!Storage::disk('public')->exists($path)) {
            Log::warning('Zoho attach SPI doc: file missing', ['spi' => $spi->id, 'path' => $path]);
            return;
        }
        $bytes = Storage::disk('public')->get($path);
        if ($bytes === '' || $bytes === null) return;

        // Filename: "<SPI no>-<invoice no>.<ext>" — e.g. "SPI-2026-27-024-778894.pdf".
        // Zoho's attachment endpoint rejects filenames with spaces or odd characters
        // ("Invalid value passed for attachment"), so keep ONLY [A-Za-z0-9_-] in each
        // part (collapsing every run of anything else — spaces, slashes, backticks —
        // to a single '-'). Mirrors the working PO-PDF attach sanitisation.
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'pdf');
        $clean = fn ($s) => trim(preg_replace('/[^A-Za-z0-9_-]+/', '-', (string) $s), '-');
        $spiNo = $clean($spi->code ?: $spi->id) ?: (string) $spi->id;
        $invNo = $clean($spi->invoice_no ?: $spi->id) ?: (string) $spi->id;
        $filename = $spiNo . '-' . $invNo . '.' . $ext;

        // Attach to the PRIMARY target first — the PO for a with-PO invoice, or the
        // bill for a direct invoice — and stamp `zoho_doc_attached_at` as soon as it
        // succeeds so a retry can't append a duplicate onto that target.
        try {
            if ($poZohoId) {
                $books->attachToPurchaseOrder($poZohoId, $bytes, $filename);
            } else {
                $books->attachToBill((string) $billId, $bytes, $filename);
            }
            $spi->forceFill(['zoho_doc_attached_at' => now()])->saveQuietly();
        } catch (\Throwable $e) {
            Log::warning('Zoho attach SPI doc (primary) failed', ['spi' => $spi->id, 'err' => $e->getMessage()]);
            // Nothing attached yet → safe to retry the whole job.
            throw $e;
        }

        // With-PO only: also drop the file on the bill (best-effort). A failure here
        // must not retry the job (that would duplicate the copy already on the PO) —
        // log and move on. (Direct invoices already used the bill as the primary.)
        if ($poZohoId && !empty($billId)) {
            try {
                $books->attachToBill((string) $billId, $bytes, $filename);
            } catch (\Throwable $e) {
                Log::warning('Zoho attach SPI doc to bill failed (PO copy kept)', ['spi' => $spi->id, 'err' => $e->getMessage()]);
            }
        }
    }
}
