<?php

namespace App\Jobs;

use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Puts the Stage 04 purchase order PDF on the Zoho purchase order and its bill,
 * so the paperwork sits with the transaction in the books rather than only in
 * our vault. The legacy PO module has done this since its own sync; the P2P one
 * created both records and attached nothing.
 *
 * Runs on the QUEUE: the sync must not wait on two file uploads, and a Zoho
 * hiccup must not fail a PO and bill that were created fine. Best-effort.
 */
class AttachP2pPoDocumentToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 180;
    public int $tries = 3;

    public function __construct(public int $poId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $po = PurchaseOrder::withoutGlobalScope('tenant')->find($this->poId);
        if (!$po || (empty($po->zoho_purchaseorder_id) && empty($po->zoho_bill_id))) return;

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        /* The stored Stage 04 PDF, not a fresh render: it is the document the
           supplier was sent, and rendering again would cost a dompdf pass. */
        $doc = PurchaseOrderDocument::withoutGlobalScope('tenant')
            ->where('purchase_order_id', $po->id)
            ->where('doc_kind', 'purchase_order')
            ->whereNotNull('file_path')
            ->orderByDesc('id')
            ->first();

        if (!$doc) {
            Log::warning('Zoho attach: no P2P PO document row', ['po' => $po->id]);
            return;
        }

        $disk = Storage::disk('public');
        if (!$disk->exists($doc->file_path)) {
            Log::warning('Zoho attach: P2P PO document missing on disk', ['po' => $po->id, 'path' => $doc->file_path]);
            return;
        }

        $bytes    = $disk->get($doc->file_path);
        $filename = 'PO-' . preg_replace('/[^A-Za-z0-9._-]/', '_', (string) ($po->code ?: $po->id)) . '.pdf';

        // Attempted separately: a bill that refuses the file must not cost the PO its copy.
        $failed = [];
        if (!empty($po->zoho_purchaseorder_id)) {
            try {
                $books->attachToPurchaseOrder((string) $po->zoho_purchaseorder_id, $bytes, $filename);
            } catch (\Throwable $e) {
                $failed[] = 'purchase order';
                Log::warning('Zoho attach to P2P PO failed', ['po' => $po->id, 'err' => $e->getMessage()]);
            }
        }
        if (!empty($po->zoho_bill_id)) {
            try {
                $books->attachToBill((string) $po->zoho_bill_id, $bytes, $filename);
            } catch (\Throwable $e) {
                $failed[] = 'bill';
                Log::warning('Zoho attach to P2P bill failed', ['po' => $po->id, 'err' => $e->getMessage()]);
            }
        }

        /* Retrying re-sends to both, and Zoho's attachment endpoint accumulates
           rather than replaces, so a retry can duplicate the copy that landed.
           Only a total failure is worth retrying. */
        if ($failed && count($failed) === 2) {
            throw new \RuntimeException('Zoho attachment failed for P2P purchase order ' . $po->id);
        }
    }
}
