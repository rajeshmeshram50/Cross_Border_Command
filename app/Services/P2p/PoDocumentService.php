<?php

namespace App\Services\P2p;

use App\Http\Controllers\Api\SalesPdfController;
use App\Mail\SalesDocumentEmail;
use App\Models\Branch;
use App\Models\ClmSignatureRequest;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\Vendor;
use App\Services\ZohoSignService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Purchase order documents: the PO PDF, e-signature through Zoho Sign, email
 * to the supplier, and keeping each document's status in step with its
 * signature request. Reuses the PO PDF template, the Zoho Sign service and
 * the sales document email the older PO screens use.
 */
class PoDocumentService
{
    private const PO_TYPE_LABELS = ['material_goods' => 'Material / Goods', 'services' => 'Services', 'ffd_transporter' => 'FFD / Transporter'];

    public function __construct(private ZohoSignService $zoho) {}

    /* ══════════════════════════ PDF ══════════════════════════ */

    /** The fields the shared PO PDF template reads, taken from the new PO. */
    private function pdfSource(PurchaseOrder $po): object
    {
        $po->loadMissing('items');
        $ship = $po->shipment_order_id ? DB::table('shipment_orders')->find($po->shipment_order_id) : null;
        $pi   = $po->proforma_invoice_id ? DB::table('proforma_invoices')->find($po->proforma_invoice_id) : null;
        $vendor = $po->vendor_id ? Vendor::withTrashed()->find($po->vendor_id) : null;
        $gst = (float) $po->total_cgst + (float) $po->total_sgst + (float) $po->total_igst;

        return (object) [
            'id'                     => $po->id,
            'client_id'              => $po->client_id,
            'branch_id'              => $po->branch_id,
            'code'                   => $po->code,
            'po_date'                => $po->po_date,
            'po_type'                => self::PO_TYPE_LABELS[$po->po_type] ?? '',
            'expected_delivery_date' => $po->expected_delivery_date,
            'currency_code'          => $po->currency_code ?: 'INR',
            'document_type'          => $po->document_type === 'international' ? 'International' : 'Domestic',
            'shipment_code'          => $ship->shipment_code ?? null,
            'shipment_order_id'      => $po->shipment_order_id,
            'opportunity_code'       => $pi->opp_code ?? null,
            'terms'                  => $po->terms,
            'supplier_name'          => $vendor ? ($vendor->legal_name ?: $vendor->company_name) : null,
            'shipping_charges'       => $po->shipping_charges,
            'packaging_charges'      => $po->packaging_charges,
            'other_charges'          => $po->other_charges,
            // The template splits one GST total into CGST + SGST or IGST itself.
            'total_cgst'             => $gst,
            'total_sgst'             => 0,
            'total_product_cost'     => (float) $po->taxable_total + $gst,
            'grand_total'            => $po->grand_total,
            'items'                  => $po->items->map(fn ($it) => (object) [
                'id'         => $it->id,
                'line_no'    => $it->line_no,
                'product_id' => $it->product_id,
                'quantity'   => $it->quantity,
                'rate'       => $it->rate,
                'gst_pct'    => $it->gst_pct,
                'cgst_pct'   => 0,
                'sgst_pct'   => 0,
                'cost'       => $it->line_total,
                'product_code' => null,
                'product_name' => null,
            ]),
        ];
    }

    public function renderPoPdf(PurchaseOrder $po): string
    {
        $vendor = $po->vendor_id ? Vendor::withTrashed()->with('primaryAddress')->find($po->vendor_id) : null;
        return app(SalesPdfController::class)->renderPoPdfBytes($this->pdfSource($po), true, $vendor);
    }

    /** (Re)generates the Purchase Order PDF onto its document row. A sent or signed one is left alone. */
    public function generatePoDocument(PurchaseOrder $po, PurchaseOrderDocument $doc, int $userId): PurchaseOrderDocument
    {
        if ($doc->status !== PurchaseOrderDocument::STATUS_PENDING) return $doc;
        $name = preg_replace('/[^A-Za-z0-9_-]/', '_', (string) $po->code) . '.pdf';   // PO_2026-27_001.pdf
        $path = "p2p/po-documents/{$po->id}/" . Str::uuid() . '_' . $name;
        if (Storage::disk('public')->put($path, $this->renderPoPdf($po)) === false) {
            throw new RuntimeException('Could not store the PO PDF.');
        }
        $old = $doc->file_path;
        $doc->update([
            'file_path'     => $path,
            'original_name' => $name,
            'mime_type'     => 'application/pdf',
            'size_bytes'    => Storage::disk('public')->size($path),
            'generated_on'  => now()->toDateString(),
            'updated_by'    => $userId,
        ]);
        if ($old && $old !== $path) Storage::disk('public')->delete($old);
        return $doc;
    }

    /* ══════════════════════════ Supplier contact ══════════════════════════ */

    /** Name and email of the supplier's primary contact. */
    public function supplierContact(PurchaseOrder $po): array
    {
        $vendor = $po->vendor_id ? Vendor::withTrashed()->with('primaryAddress')->find($po->vendor_id) : null;
        $addr = $vendor?->primaryAddress;
        return [
            'vendor' => $vendor,
            'name'   => $addr?->contact_name ?: ($vendor ? ($vendor->legal_name ?: $vendor->company_name) : 'Supplier'),
            'email'  => strtolower((string) ($addr?->email ?: ($vendor?->primary_email ?? ''))),
        ];
    }

    /** Copies each document's stored file to a local temp path (the public disk may be Azure). */
    private function localCopies(Collection $docs): array
    {
        $dir = storage_path('app/temp');
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        return $docs->map(function (PurchaseOrderDocument $d) use ($dir) {
            $bytes = Storage::disk('public')->get($d->file_path);
            if ($bytes === null) throw new RuntimeException("The file of {$d->name} is missing from storage.");
            $path = $dir . '/' . Str::uuid() . '_' . basename($d->file_path);
            file_put_contents($path, $bytes);
            return ['path' => $path, 'name' => $d->original_name ?: basename($d->file_path), 'doc' => $d];
        })->all();
    }

    /* ══════════════════════════ E-signature ══════════════════════════ */

    /** Sends the documents to the supplier as one Zoho Sign request; they become "sent". */
    public function sendForSignature(PurchaseOrder $po, Collection $docs, array $signer, array $opts, int $userId, ?int $branchId): ClmSignatureRequest
    {
        if (!$this->zoho->isConfigured()) throw new RuntimeException('Zoho Sign is not configured. Contact your administrator.');

        $files = $this->localCopies($docs);
        try {
            $expiryDays  = min(90, max(1, (int) ($opts['expiry_days'] ?? 30)));
            $requestName = 'Purchase Order ' . $po->code;
            $body = ['requests' => [
                'request_name'    => $requestName,
                'is_sequential'   => false,
                'expiration_days' => $expiryDays,
                'notes'           => (string) ($opts['notes'] ?? 'Please review and sign the attached purchase order documents.'),
                'actions'         => [[
                    'recipient_email'  => $signer['email'],
                    'recipient_name'   => $signer['name'],
                    'action_type'      => 'SIGN',
                    'signing_order'    => 1,
                    'verify_recipient' => false,
                ]],
            ]];
            $names = array_map(fn ($f) => pathinfo($f['name'], PATHINFO_FILENAME) ?: 'document', $files);

            $created   = $this->zoho->createRequestMultipart(array_column($files, 'path'), $names, $body);
            $requestId = data_get($created, 'requests.request_id');
            if (!$requestId) throw new RuntimeException('Zoho Sign did not return a request id.');

            $details   = $this->zoho->getRequest($requestId);
            $actions   = data_get($details, 'requests.actions', []);
            $zohoDocs  = data_get($details, 'requests.document_ids', []);
            // No coordinates: Zoho places the signature box at the service default.
            $this->zoho->submitWithFields($requestId, $actions, $zohoDocs, []);
            $status = 'inprogress';
            try {
                $status = strtolower((string) data_get($this->zoho->getRequest($requestId), 'requests.request_status', 'inprogress'));
            } catch (\Throwable $e) { /* keep inprogress */ }

            $sig = new ClmSignatureRequest();
            $sig->client_id         = $po->client_id;
            $sig->branch_id         = $po->branch_id ?? $branchId;
            $sig->document_type     = ClmSignatureRequest::DOC_P2P_PO_DOCUMENT;
            $sig->trade_doc_id      = $docs->first()->id;
            $sig->trade_doc_ids     = $docs->pluck('id')->values()->all();
            $sig->document_names    = $docs->pluck('name')->values()->all();
            $sig->zoho_document_ids = array_values(array_filter(array_map(fn ($d) => $d['document_id'] ?? null, $zohoDocs)));
            $sig->model_name        = 'Vendor';
            $sig->party_id          = $po->vendor_id;
            $sig->zoho_request_id   = $requestId;
            $sig->request_name      = $requestName;
            $sig->status            = $status;
            $sig->signers           = [['name' => $signer['name'], 'email' => $signer['email'], 'role' => 'supplier', 'order' => 1]];
            $sig->expiry_date       = now()->addDays($expiryDays);
            $sig->metadata          = ['purchase_order_id' => $po->id, 'po_code' => $po->code, 'sent_at' => now()->toIso8601String()];
            $sig->created_by        = $userId;
            // Zoho is already called above; only the local writes share the transaction.
            DB::transaction(function () use ($sig, $docs, $userId) {
                $sig->save();
                PurchaseOrderDocument::whereIn('id', $docs->pluck('id'))->update([
                    'status' => PurchaseOrderDocument::STATUS_SENT, 'sent_at' => now(),
                    'signature_request_id' => $sig->id, 'updated_by' => $userId,
                ]);
            });
            return $sig;
        } finally {
            foreach ($files as $f) @unlink($f['path']);
        }
    }

    /**
     * Brings sent documents in step with their signature request: re-reads the
     * request status from Zoho, a completed one marks its documents signed.
     */
    public function syncSignatures(Collection $docs): void
    {
        $sigIds = $docs->where('status', PurchaseOrderDocument::STATUS_SENT)->pluck('signature_request_id')->filter()->unique();
        if ($sigIds->isEmpty()) return;

        foreach (ClmSignatureRequest::whereIn('id', $sigIds)->get() as $sig) {
            if (!in_array($sig->status, ['completed', 'declined', 'recalled', 'expired'], true) && $this->zoho->isConfigured()) {
                try {
                    $state = strtolower((string) data_get($this->zoho->getRequest($sig->zoho_request_id), 'requests.request_status', $sig->status));
                    if ($state !== $sig->status) {
                        $sig->status = $state;
                        if ($state === 'completed' && !$sig->completed_at) $sig->completed_at = now();
                        $sig->save();
                    }
                } catch (\Throwable $e) {
                    Log::warning('PO document signature sync failed', ['sig' => $sig->id, 'err' => $e->getMessage()]);
                }
            }
            $sent = PurchaseOrderDocument::where('signature_request_id', $sig->id)->where('status', PurchaseOrderDocument::STATUS_SENT);
            if ($sig->status === 'completed') {
                $sent->update(['status' => PurchaseOrderDocument::STATUS_SIGNED, 'signed_at' => $sig->completed_at ?? now()]);
            } elseif (in_array($sig->status, ['declined', 'rejected', 'recalled', 'expired'], true)) {
                // Back to pending so it can be sent again; the request stays linked for the tracker.
                $sent->update(['status' => PurchaseOrderDocument::STATUS_PENDING]);
            }
        }
    }

    /* ══════════════════════════ Email ══════════════════════════ */

    /** Emails the documents' files to the supplier (or `$to`). Returns the address used. */
    public function email(PurchaseOrder $po, Collection $docs, ?string $to): string
    {
        $contact = $this->supplierContact($po);
        $to = $to ?: $contact['email'];
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('No valid email for this supplier. Set a primary contact email on the supplier first.');
        }

        $files = $this->localCopies($docs);
        try {
            $branch = Branch::find($po->branch_id);
            [$first, $rest] = [$files[0], array_slice($files, 1)];
            Mail::to($to)->send(new SalesDocumentEmail([
                'docKind'          => 'Purchase Order',
                'docLabel'         => 'PO',
                'docCode'          => $po->code,
                'docDate'          => optional($po->po_date)->format('d/m/Y') ?: date('d/m/Y'),
                'branchName'       => $branch?->name ?: ($branch?->code ?: 'Procurement Team'),
                'branchEmail'      => $branch?->email ?: null,
                'branchWebsite'    => $branch?->website ?: null,
                'customerName'     => $contact['name'],
                'productsCount'    => (int) $po->items()->count(),
                'grandTotal'       => (float) $po->grand_total,
                'currency'         => (string) ($po->currency_code ?: 'INR'),
                'docType'          => $po->document_type === 'international' ? 'International' : 'Domestic',
                'pdfPath'          => $first['path'],
                'pdfFilename'      => $first['name'],
                'extraAttachments' => array_map(fn ($f) => ['path' => $f['path'], 'name' => $f['name']], $rest),
            ]));
        } finally {
            foreach ($files as $f) @unlink($f['path']);
        }
        return $to;
    }
}
