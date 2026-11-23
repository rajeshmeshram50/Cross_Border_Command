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

class AttachP2pPoDocumentToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 180;
    public int $tries = 3;

    public function __construct(public int $poId) {}

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

        if ($failed && count($failed) === 2) {
            throw new \RuntimeException('Zoho attachment failed for P2P purchase order ' . $po->id);
        }
    }
}
