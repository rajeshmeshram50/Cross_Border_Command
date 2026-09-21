<?php

namespace App\Jobs\P2p;

use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Services\P2p\PoDocumentService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Renders the Purchase Order PDF onto its document row after submit.
 * dompdf takes seconds, so it runs off the request; the screen polls for the file.
 */
class GeneratePoDocumentPdf implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 180;
    public int $tries = 3;

    public function __construct(public int $poId, public int $userId) {}

    /** Wait between retries: 20s, then 1min. */
    public function backoff(): array
    {
        return [20, 60];
    }

    public function handle(PoDocumentService $docs): void
    {
        // No tenant context in a worker; the PO id came from an already-scoped request.
        $po = PurchaseOrder::withoutGlobalScope('tenant')->find($this->poId);
        if (!$po || $po->status !== PurchaseOrder::STATUS_SUBMITTED) return;
        $doc = PurchaseOrderDocument::withoutGlobalScope('tenant')
            ->where('purchase_order_id', $po->id)->where('doc_kind', 'purchase_order')->first();
        if ($doc) $docs->generatePoDocument($po, $doc, $this->userId);
    }
}
