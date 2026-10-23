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

/**
 * Renders a run's signed PDF the moment it completes and keeps the file, so
 * the signed document is a stored artefact rather than something rebuilt from
 * content_html and the signature images on every download.
 *
 * Runs on the QUEUE for one reason: the last signer must not wait ~4 seconds
 * for DomPDF to finish before their click returns. Nothing depends on this
 * having run — downloadSignedPdf renders and backfills if the file is missing.
 */
class StoreSignedDocumentPdf implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries = 3;

    public function __construct(public int $runId) {}

    /** Wait between retries: 20s, then 2min. */
    public function backoff(): array
    {
        return [20, 120];
    }

    public function handle(): void
    {
        $row = HrDocumentSignature::find($this->runId);
        if (!$row || strtolower((string) $row->status) !== 'completed') {
            return;   // rejected or cancelled after completing — nothing to freeze
        }
        if ($row->signed_pdf_path && $row->signed_pdf_at && $row->updated_at
            && $row->signed_pdf_at->gte($row->updated_at)) {
            return;   // a download already backfilled it
        }

        $path = (new HrDocumentSignatureController())->storeSignedPdf($row);
        if ($path === null) {
            Log::warning('Signed-PDF freeze produced no file', ['run' => $this->runId]);
        }
    }
}
