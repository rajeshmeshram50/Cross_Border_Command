<?php

namespace App\Services\P2p;

use App\Models\ClmSignatureRequest;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\P2p\SpiBoxAttachment;
use App\Models\P2p\SupplierInvoice;
use Illuminate\Support\Facades\DB;

/**
 * The Evidence Vault of ONE supplier purchase invoice.
 *
 * Every piece of paper filed against this invoice, grouped the way the dialog
 * reads: the order it was raised under, the invoice's own files, the trade
 * documents and agreements that travel with it, and the proof attached to the
 * boxes.
 *
 * READ-ONLY, and it gathers rather than generates. Nothing here uploads,
 * deletes or creates a document — each one was produced somewhere else and is
 * only being listed in one place.
 *
 * WHAT IT IS NOT. The SUPPLIER's vault — KYC, due diligence, trade licences —
 * is a different thing, keyed on the vendor and served by
 * /segment-uploads/supplier/{id}/vault. This one is keyed on the invoice. A
 * screen that wants both asks for both; merging them here would make "which
 * supplier" ambiguous the moment an invoice changes hands.
 */
class SpiVaultService
{
    /** @return array<string, mixed> */
    public function build(SupplierInvoice $spi): array
    {
        $spi->loadMissing('purchaseOrder');

        $groups = array_values(array_filter([
            $this->purchaseOrderGroup($spi),
            $this->invoiceGroup($spi),
            $this->tradeGroup($spi),
            $this->boxGroup($spi),
        ]));

        $docs = collect($groups)->flatMap(fn ($g) => $g['documents']);

        return [
            'spi'    => ['id' => $spi->id, 'code' => $spi->code],
            'groups' => $groups,
            'totals' => [
                'documents' => $docs->count(),
                // A row with no file is a requirement that nobody has met yet —
                // the vault lists it so the gap is visible, which is the point.
                'available' => $docs->whereNotNull('file_url')->count(),
                'missing'   => $docs->whereNull('file_url')->count(),
            ],
        ];
    }

    /* ══════════════════════════ GROUPS ══════════════════════════ */

    /** The order this invoice was raised under, and its signed copy. */
    private function purchaseOrderGroup(SupplierInvoice $spi): ?array
    {
        $po = $spi->purchaseOrder;
        if (!$po) return null;   // a standalone invoice has no order to file under

        $row = PurchaseOrderDocument::where('purchase_order_id', $po->id)
            ->where('doc_kind', 'purchase_order')
            ->orderByDesc('id')
            ->first();

        return [
            'key'       => 'po',
            'title'     => 'Purchase Order',
            'subtitle'  => 'The order everything here is filed against',
            'documents' => $row ? [$this->fromPoDocument($row)] : [],
        ];
    }

    /** The invoice's own two uploads, as they were saved on Stage 02. */
    private function invoiceGroup(SupplierInvoice $spi): array
    {
        $docs = [];

        if ($spi->invoice_file_path) {
            $docs[] = $this->doc(
                name:   $spi->invoice_file_name ?: 'Supplier invoice',
                meta:   'Supplier invoice · ' . $this->day($spi->invoice_date),
                path:   $spi->invoice_file_path,
                kind:   'invoice',
                status: 'Uploaded',
            );
        }

        if ($spi->eway_file_path) {
            $docs[] = $this->doc(
                name:   $spi->eway_file_name ?: 'E-way bill',
                meta:   trim('E-way bill ' . ($spi->eway_no ? '· ' . $spi->eway_no : '')),
                path:   $spi->eway_file_path,
                kind:   'eway',
                status: 'Uploaded',
            );
        }

        return [
            'key'       => 'spi',
            'title'     => 'Supplier Purchase Invoice',
            'subtitle'  => 'The invoice as it was filed, with its e-way bill',
            'documents' => $docs,
        ];
    }

    /**
     * Trade documents and agreements — the CLM paperwork Stage 04 materialises
     * against the order, with where each one stands in its signing.
     *
     * Rows with no file are kept deliberately: a Bill of Lading that nobody has
     * uploaded is the most useful line in the vault, and dropping it would make
     * an incomplete file look complete.
     */
    private function tradeGroup(SupplierInvoice $spi): ?array
    {
        $po = $spi->purchaseOrder;
        if (!$po) return null;

        $rows = PurchaseOrderDocument::where('purchase_order_id', $po->id)
            ->where('doc_kind', '!=', 'purchase_order')
            ->orderBy('id')
            ->get();
        if ($rows->isEmpty()) return null;

        $sigs = ClmSignatureRequest::whereIn('id', $rows->pluck('signature_request_id')->filter()->unique())
            ->where('client_id', $po->client_id)
            ->get()->keyBy('id');

        return [
            'key'       => 'trade',
            'title'     => 'Trade Documents & Agreements',
            'subtitle'  => 'Signed paperwork and shipping documents for this order',
            'documents' => $rows->map(fn (PurchaseOrderDocument $d) => $this->fromPoDocument(
                $d,
                $d->signature_request_id ? $sigs->get($d->signature_request_id) : null,
            ))->all(),
        ];
    }

    /** Proof attached while the boxes were packed — photos, weighbridge slips. */
    private function boxGroup(SupplierInvoice $spi): ?array
    {
        $boxIds = $spi->boxes()->pluck('id');
        if ($boxIds->isEmpty()) return null;

        $rows = SpiBoxAttachment::whereIn('box_id', $boxIds)->orderBy('id')->get();
        if ($rows->isEmpty()) return null;

        $codes = DB::table('p2p_spi_boxes')->whereIn('id', $boxIds)->pluck('box_code', 'id');

        return [
            'key'       => 'boxes',
            'title'     => 'Packing Evidence',
            'subtitle'  => 'Files attached to the boxes while they were packed',
            'documents' => $rows->map(fn (SpiBoxAttachment $a) => $this->doc(
                name:   $a->file_name ?: 'Attachment',
                meta:   'Box ' . ($codes[$a->box_id] ?? $a->box_id),
                path:   $a->file_path,
                kind:   'box_attachment',
                status: 'Uploaded',
            ))->all(),
        ];
    }

    /* ══════════════════════════ ROWS ══════════════════════════ */

    /** One PO document, with its signing state when it has been sent. */
    private function fromPoDocument(PurchaseOrderDocument $d, ?ClmSignatureRequest $sig = null): array
    {
        return $this->doc(
            name:   $d->name,
            meta:   trim(implode(' · ', array_filter([
                $d->code,
                $d->doc_sub,
                $d->generated_on ? $this->day($d->generated_on) : null,
            ]))),
            path:   $d->file_path,
            kind:   $d->doc_kind,
            // The row's own status is the answer; the signature request only
            // adds detail when one was raised.
            status: ucfirst((string) $d->status),
        ) + [
            'id'               => $d->id,
            'code'             => $d->code,
            'required'         => $d->needed === 'yes',
            'signature_status' => $sig?->status,
            'signed_at'        => optional($d->signed_at)->toDateTimeString(),
        ];
    }

    /**
     * One vault line.
     *
     * `file_url` is null when nothing has been uploaded, and that is a state the
     * screen should draw rather than hide — the download simply has nothing to
     * offer yet. Files stream through /p2p/files/download because Azure keeps
     * them off-origin, where a direct link cannot be saved.
     */
    private function doc(string $name, string $meta, ?string $path, string $kind, string $status): array
    {
        return [
            'name'     => $name,
            'meta'     => $meta,
            'kind'     => $kind,
            'status'   => $status,
            'file_url' => $path ? file_url($path) : null,
        ];
    }

    private function day($date): string
    {
        return $date ? \Illuminate\Support\Carbon::parse($date)->format('d M Y') : '—';
    }
}
