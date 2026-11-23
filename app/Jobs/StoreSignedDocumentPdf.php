<?php

namespace App\Jobs;

use App\Http\Controllers\Api\HrDocumentSignatureController;
use App\Models\HrDocumentSignature;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class StoreSignedDocumentPdf implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries = 3;

    public function __construct(public int $runId) {}

    public function backoff(): array
    {
        return [20, 120];
    }

    public function handle(): void
    {
        $row = HrDocumentSignature::find($this->runId);
        if (!$row || strtolower((string) $row->status) !== 'completed') {
            return;
        }
        if ($row->signed_pdf_path && $row->signed_pdf_at && $row->updated_at
            && $row->signed_pdf_at->gte($row->updated_at)) {
            return;
        }

        $path = (new HrDocumentSignatureController())->storeSignedPdf($row);
        if ($path === null) {
            Log::warning('Signed-PDF freeze produced no file', ['run' => $this->runId]);
        }
    }
}
