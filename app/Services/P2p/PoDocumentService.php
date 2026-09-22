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
            // One action per signer. `role` rides along so the coordinates the
            // screen dragged for that signer can be found again after Zoho
            // hands back its own action ids (ZohoSignService reads cbc_role).
            $signers = $this->signerList($signer, $opts['signers'] ?? []);
            $body = ['requests' => [
                'request_name'    => $requestName,
                'is_sequential'   => false,
                'expiration_days' => $expiryDays,
                'notes'           => (string) ($opts['notes'] ?? 'Please review and sign the attached purchase order documents.'),
                'actions'         => array_map(fn ($i, $r) => [
                    'recipient_email'  => $r['email'],
                    'recipient_name'   => $r['name'],
                    'action_type'      => 'SIGN',
                    'signing_order'    => $i + 1,
                    'verify_recipient' => false,
                ], array_keys($signers), $signers),
            ]];
            $names = array_map(fn ($f) => pathinfo($f['name'], PATHINFO_FILENAME) ?: 'document', $files);

            $created   = $this->zoho->createRequestMultipart(array_column($files, 'path'), $names, $body);
            $requestId = data_get($created, 'requests.request_id');
            if (!$requestId) throw new RuntimeException('Zoho Sign did not return a request id.');

            $details   = $this->zoho->getRequest($requestId);
            $actions   = data_get($details, 'requests.actions', []);
            $zohoDocs  = data_get($details, 'requests.document_ids', []);
            // Stamp each Zoho action with its signer's role, then hand over the
            // boxes the screen positioned. With no coordinates Zoho falls back
            // to its own default placement, as before.
            foreach ($actions as $i => $action) {
                $actions[$i]['cbc_role'] = $signers[$i]['role'] ?? ('signer' . ($i + 1));
            }
            $coords = $this->coordsByZohoDoc($opts['document_settings'] ?? [], $docs, $zohoDocs);
            $this->zoho->submitWithFields($requestId, $actions, $zohoDocs, $coords);
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
            $sig->signers           = array_map(fn ($i, $r) => $r + ['order' => $i + 1], array_keys($signers), $signers);
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
     * Who signs, in order. The supplier's own contact is the default; a screen
     * that collected several signers sends them instead. Each one keeps a role,
     * which is what ties a signer to the box dragged for them.
     *
     * @return array<int,array{name:string,email:string,role:string}>
     */
    private function signerList(array $fallback, array $given): array
    {
        $out = [];
        foreach ($given as $i => $row) {
            $email = strtolower(trim((string) ($row['email'] ?? '')));
            $name  = trim((string) ($row['name'] ?? ''));
            if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
            $out[] = [
                'name'  => $name ?: $email,
                'email' => $email,
                'role'  => (string) ($row['role'] ?? ('signer' . ($i + 1))),
            ];
        }
        if (!$out) $out[] = ['name' => $fallback['name'], 'email' => $fallback['email'], 'role' => 'supplier'];

        // Zoho refuses the same recipient twice in one request.
        $seen = [];
        return array_values(array_filter($out, function ($r) use (&$seen) {
            if (isset($seen[$r['email']])) return false;
            $seen[$r['email']] = true;
            return true;
        }));
    }

    /**
     * The screen positions boxes against OUR document ids; Zoho answers with its
     * own, in the order the files were uploaded. This re-keys one to the other.
     *
     * Each entry is either a single box (x, y, page, width, height), a box per
     * signer role, or a `boxes` array when one signer signs a document several
     * times — ZohoSignService understands all three.
     */
    private function coordsByZohoDoc(array $settings, Collection $docs, array $zohoDocs): array
    {
        if (!$settings) return [];
        $out = [];
        foreach ($docs->values() as $i => $doc) {
            $zohoId = $zohoDocs[$i]['document_id'] ?? null;
            if (!$zohoId) continue;
            $box = $settings[$doc->id] ?? $settings[(string) $doc->id] ?? null;
            if (is_array($box) && $box) $out[$zohoId] = $box;
        }
        return $out;
    }

    /**
     * Trade documents and agreements leave this screen through the CLM
     * signature flow — the same POST /clm/signature-requests the Customer
     * vault, the lead's popup and the older PO screen use. That request is
     * raised against the CLM LIBRARY id, so it knows nothing about our rows.
     *
     * This claims those requests for the PO's own documents, matching on the
     * library the row came from plus its library id. Without it the row would
     * sit on "Pending" for ever and the unsigned-paperwork gate would let the
     * next PO through.
     *
     * A later request wins over an earlier one, so a document that was recalled
     * and sent again tracks the resend. A signed document is left alone.
     */
    public function adoptClmSignatures(PurchaseOrder $po): void
    {
        if (!$po->vendor_id) return;
        $docs = $po->documents()->whereNotNull('source_type')->whereNotNull('source_id')->get();
        if ($docs->isEmpty()) return;

        $requests = ClmSignatureRequest::where('client_id', $po->client_id)
            ->where('model_name', 'Vendor')
            ->where('party_id', $po->vendor_id)
            ->whereIn('document_type', [ClmSignatureRequest::DOC_TRADE, ClmSignatureRequest::DOC_AGREEMENT])
            ->orderBy('id')                       // oldest first — the newest overwrites it
            ->get(['id', 'document_type', 'trade_doc_id', 'trade_doc_ids', 'metadata', 'status', 'created_at']);

        foreach ($requests as $sig) {
            foreach ($this->libraryIdsOf($sig) as $kind => $libIds) {
                foreach ($docs as $doc) {
                    if ($doc->source_type !== $kind || !in_array((int) $doc->source_id, $libIds, true)) continue;
                    if ((int) $doc->signature_request_id === (int) $sig->id) continue;
                    // Already signed under another request — nothing to re-claim.
                    if ($doc->status === PurchaseOrderDocument::STATUS_SIGNED) continue;
                    $doc->forceFill([
                        'signature_request_id' => $sig->id,
                        'status'               => PurchaseOrderDocument::STATUS_SENT,
                        'sent_at'              => $sig->created_at,
                    ])->save();
                }
            }
        }
    }

    /**
     * Which library each id in a signature request came from, as
     * ['trade' => [...ids], 'agreement' => [...ids]].
     *
     * One envelope can carry both libraries, and a trade document and an
     * agreement can share a numeric id — so `metadata.doc_kind_ids` holds the
     * real split. Requests written before that shipped fall back to
     * `document_type`, which is the same rule the Evidence Vault follows.
     *
     * @return array<string,int[]>
     */
    private function libraryIdsOf(ClmSignatureRequest $sig): array
    {
        $ours = [ClmSignatureRequest::DOC_TRADE => 'trade', ClmSignatureRequest::DOC_AGREEMENT => 'agreement'];
        $split = (array) data_get($sig->metadata, 'doc_kind_ids', []);
        $out = [];
        foreach ($ours as $clmKind => $kind) {
            if (!empty($split[$clmKind])) $out[$kind] = array_map('intval', (array) $split[$clmKind]);
        }
        if ($out) return $out;

        $ids = is_array($sig->trade_doc_ids) && $sig->trade_doc_ids
            ? $sig->trade_doc_ids
            : ($sig->trade_doc_id !== null ? [$sig->trade_doc_id] : []);
        if (!$ids) return [];
        return [$ours[$sig->document_type] ?? 'trade' => array_map('intval', $ids)];
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
