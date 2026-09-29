<?php

namespace App\Jobs;

use App\Models\P2p\PoPayment;
use App\Models\P2p\PurchaseOrder;
use App\Services\ZohoBooksService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Puts the proof uploaded against a PO payment into Zoho Books, on the BILL the
 * payment settles. Zoho Books has no attachment endpoint of its own for a vendor
 * payment, so the bill is where the evidence can live and still be found from
 * the transaction.
 *
 * Runs on the QUEUE and is best-effort: the payment is recorded either way.
 */
class AttachPoPaymentProofToZoho implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries = 3;

    public function __construct(public int $paymentId) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $pay = PoPayment::withoutGlobalScope('tenant')->find($this->paymentId);
        if (!$pay || empty($pay->zoho_payment_id) || empty($pay->proof_path)) return;

        $po = PurchaseOrder::withoutGlobalScope('tenant')->find($pay->purchase_order_id);
        if (!$po || empty($po->zoho_bill_id)) return;

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) return;

        $disk = Storage::disk('public');
        if (!$disk->exists($pay->proof_path)) {
            Log::warning('Zoho attach: payment proof missing on disk', ['payment' => $pay->id, 'path' => $pay->proof_path]);
            return;
        }

        $name = $pay->proof_name ?: basename($pay->proof_path);
        // Named by the payment, so several proofs on one bill stay tellable apart.
        $filename = 'PAY-' . $pay->id . '-' . preg_replace('/[^A-Za-z0-9._-]/', '_', $name);

        try {
            $books->attachToBill((string) $po->zoho_bill_id, $disk->get($pay->proof_path), $filename);
        } catch (\Throwable $e) {
            Log::warning('Zoho attach payment proof to bill failed', ['payment' => $pay->id, 'err' => $e->getMessage()]);
            throw new \RuntimeException('Zoho attachment failed for PO payment ' . $pay->id, 0, $e);
        }
    }
}
