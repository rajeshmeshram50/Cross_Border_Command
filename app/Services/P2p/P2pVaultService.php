<?php

namespace App\Services\P2p;

use App\Models\ClmSignatureRequest;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\P2p\SpiBoxAttachment;
use App\Models\P2p\SupplierInvoice;
use Illuminate\Support\Facades\DB;

/**
 * The Evidence Vault, from either end of the same chain.
 *
 * A purchase order and its supplier invoices hold one body of paperwork between
 * them, and which end you start from is a question about the screen you are on,
 * not about the documents. So this answers both:
 *
 *   forPo()   the order, its trade documents, a block per INVOICE raised under
 *             it, and any payment released against the order itself
 *   forSpi()  one invoice's own papers, plus the order's documents above it
 *
 * SHAPE. Every group holds SECTIONS, and every section holds documents — one
 * level the whole way down, so a screen renders it with a single loop rather
 * than special-casing the invoice blocks. An empty section is dropped entirely:
 * a heading with nothing under it reads as a gap in the file, not as a section
 * nobody filled.
 *
 * READ-ONLY, and it gathers rather than generates — every document here was
 * produced somewhere else.
 *
 * NOT THE SUPPLIER'S VAULT. KYC, due diligence and trade licences belong to the
 * vendor, not to an order, and live at /segment-uploads/supplier/{id}/vault.
 */
class P2pVaultService
{
    /* ══════════════════════════ ENTRY POINTS ══════════════════════════ */

    /** @return array<string, mixed> */
    public function forSpi(SupplierInvoice $spi): array
    {
        $spi->loadMissing('purchaseOrder');
        $po = $spi->purchaseOrder;

        return $this->body(
            ['kind' => 'spi', 'id' => $spi->id, 'code' => $spi->code],
            [
                $po ? $this->poGroup($po) : null,
                $po ? $this->tradeGroup($po) : null,
                $this->invoiceGroup($po, $spi),
            ],
            /* The ids of the records this vault reaches into.
             *
             * A document row carries its OWN id, which is a
             * purchase_order_DOCUMENT id — nothing in the payload said what the
             * PO id was, so the only id in sight was the wrong one to call the
             * PO vault with. Named here so a screen can link across without
             * parsing a code out of a subtitle. */
            ['purchase_order' => $po ? ['id' => $po->id, 'code' => $po->code] : null],
        );
    }

    /** @return array<string, mixed> */
    public function forPo(PurchaseOrder $po): array
    {
        // Oldest first: the invoices read in the order they were raised.
        $invoices = SupplierInvoice::where('purchase_order_id', $po->id)->orderBy('id')->get();

        return $this->body(
            ['kind' => 'po', 'id' => $po->id, 'code' => $po->code],
            array_merge(
                [$this->poGroup($po), $this->tradeGroup($po)],
                /* One block per invoice, so a PO carrying several keeps them
                   apart — and each carries its OWN payments, because a proof is
                   read against the invoice it answered, not against the order. */
                $invoices->map(fn (SupplierInvoice $s) => $this->invoiceGroup($po, $s, true))->all(),
                // What is left: money released with no invoice behind the request.
                [$this->loosePaymentGroup($po)],
            ),
            // Every invoice this order carries, for the same reason.
            ['invoices' => $invoices->map(fn (SupplierInvoice $s) => ['id' => $s->id, 'code' => $s->code])->all()],
        );
    }

    /* ══════════════════════════ GROUPS ══════════════════════════ */

    /** The order itself, and its signed copy. */
    private function poGroup(PurchaseOrder $po): array
    {
        $row = PurchaseOrderDocument::where('purchase_order_id', $po->id)
            ->where('doc_kind', 'purchase_order')
            ->orderByDesc('id')->first();

        return $this->group('po', 'Purchase Order',
            $po->code . ' — the order everything here is filed against', [
                $this->section('order', 'Order Copy', $row ? [$this->fromPoDocument($row)] : []),
            ]);
    }

    /**
     * Trade documents and agreements, with where each stands in its signing.
     *
     * Rows with no file are kept on purpose: a Bill of Lading nobody has
     * uploaded is the most useful line in the vault, and dropping it would make
     * an incomplete file look complete.
     */
    private function tradeGroup(PurchaseOrder $po): ?array
    {
        $rows = PurchaseOrderDocument::where('purchase_order_id', $po->id)
            ->where('doc_kind', '!=', 'purchase_order')
            ->orderBy('id')->get();
        if ($rows->isEmpty()) return null;

        $sigs = ClmSignatureRequest::whereIn('id', $rows->pluck('signature_request_id')->filter()->unique())
            ->where('client_id', $po->client_id)
            ->get()->keyBy('id');

        $shape = fn (PurchaseOrderDocument $d) => $this->fromPoDocument(
            $d,
            $d->signature_request_id ? $sigs->get($d->signature_request_id) : null,
        );

        // The title says "Documents & Agreements"; the sections make that true.
        return $this->group('trade', 'Trade Documents & Agreements',
            'Signed paperwork and shipping documents for this order', [
                $this->section('trade_documents', 'Trade Documents',
                    $rows->where('doc_kind', '!=', 'agreement')->map($shape)->values()->all()),
                $this->section('agreements', 'Agreements',
                    $rows->where('doc_kind', 'agreement')->map($shape)->values()->all()),
            ]);
    }

    /**
     * One invoice, in four sections: the invoice itself, the stickers printed
     * for its boxes, the images taken against the goods, and the money released
     * against it.
     *
     * $named titles the block with the invoice code, which matters only when a
     * PO is showing several of them at once.
     */
    private function invoiceGroup(?PurchaseOrder $po, SupplierInvoice $spi, bool $named = false): array
    {
        $general = [];

        if ($spi->invoice_file_path) {
            $general[] = $this->doc(
                $spi->invoice_file_name ?: 'Supplier invoice',
                'Supplier invoice · ' . $this->day($spi->invoice_date),
                $spi->invoice_file_path, 'invoice', 'Uploaded',
            );
        }

        if ($spi->eway_file_path) {
            $general[] = $this->doc(
                $spi->eway_file_name ?: 'E-way bill',
                trim('E-way bill ' . ($spi->eway_no ? '· ' . $spi->eway_no : '')),
                $spi->eway_file_path, 'eway', 'Uploaded',
            );
        }

        [$stickers, $images] = $this->boxDocs($spi);

        return $this->group('spi:' . $spi->id,
            $named ? 'Invoice ' . $spi->code : 'Supplier Purchase Invoice',
            'The invoice, its e-way bill, box stickers, packing images and payments', [
                $this->section('general', 'Invoice & E-way Bill', $general),
                $this->section('box_stickers', 'Box Stickers', $stickers),
                $this->section('box_attachments', 'Box & Product Images', $images),
                $this->section('payment_proofs', 'Payment Proofs', $this->paymentRows($po, $spi)),
            ]);
    }

    /** Money released on the order itself, with no invoice behind the request. */
    private function loosePaymentGroup(PurchaseOrder $po): ?array
    {
        $rows = $this->paymentRows($po, null, true);
        if (!$rows) return null;

        return $this->group('payments', 'Payment Proofs',
            'Released against the order, not against one invoice', [
                $this->section('payment_proofs', 'Payment Proofs', $rows),
            ]);
    }

    /* ══════════════════════════ ROWS ══════════════════════════ */

    /**
     * Box stickers, and the images taken against the goods, as two lists.
     *
     * A STICKER IS NOT A STORED FILE — it is rendered on demand, so the row
     * carries an `action_url` to print it rather than a `file_url` to download.
     * Saying so here keeps the screen from drawing a download that would 404.
     *
     * @return array{0: array<int, array>, 1: array<int, array>}  [stickers, images]
     */
    private function boxDocs(SupplierInvoice $spi): array
    {
        $boxes = $spi->boxes()->orderBy('box_code')->get();
        if ($boxes->isEmpty()) return [[], []];

        $stickers = [];
        foreach ($boxes as $b) {
            $stickers[] = $this->doc(
                'Sticker — ' . $b->box_code,
                $b->sticker_printed_at ? 'Printed ' . $this->day($b->sticker_printed_at) : 'Not printed yet',
                null, 'box_sticker', $b->sticker_printed_at ? 'Printed' : 'Pending',
            ) + ['action_url' => "/api/p2p/spi/{$spi->id}/boxes/{$b->id}/sticker/download"];
        }

        $files = SpiBoxAttachment::whereIn('box_id', $boxes->pluck('id'))->orderBy('id')->get();
        $codes = $boxes->pluck('box_code', 'id');

        $images = [];
        foreach ($files as $a) {
            $images[] = $this->doc(
                $a->file_name ?: 'Packing image',
                // A box_item_id means the picture is of ONE product in the box,
                // not of the box as a whole — worth saying which.
                ($a->box_item_id ? 'Against a product in ' : 'Box ') . ($codes[$a->box_id] ?? $a->box_id),
                $a->file_path, $a->box_item_id ? 'product_image' : 'box_image', 'Uploaded',
            );
        }

        return [$stickers, $images];
    }

    /**
     * Money released, with its proof — and the invoice it was raised against.
     *
     * Payments always sit on the PO, even when the request was raised from an
     * invoice; `supplier_invoice_id` on the request is what ties one back.
     *
     * @return array<int, array<string, mixed>>
     */
    private function paymentRows(?PurchaseOrder $po, ?SupplierInvoice $only, bool $unlinkedOnly = false): array
    {
        if (!$po) return [];

        return DB::table('p2p_po_payments as pay')
            ->leftJoin('p2p_po_payment_requests as req', 'req.id', '=', 'pay.payment_request_id')
            ->leftJoin('p2p_supplier_invoices as spi', 'spi.id', '=', 'req.supplier_invoice_id')
            ->where('pay.purchase_order_id', $po->id)
            ->whereNull('pay.deleted_at')
            ->when($only, fn ($q) => $q->where('req.supplier_invoice_id', $only->id))
            ->when($unlinkedOnly, fn ($q) => $q->whereNull('req.supplier_invoice_id'))
            ->orderBy('pay.id')
            ->get([
                'pay.id', 'pay.amount', 'pay.proof_path', 'pay.proof_name',
                'pay.utr_cheque_number', 'pay.utr_cheque_date', 'pay.bank_name',
                'req.code as request_code', 'spi.code as spi_code',
            ])
            ->map(fn ($r) => $this->doc(
                $r->proof_name ?: ('Payment proof — ' . ($r->request_code ?: '#' . $r->id)),
                trim(implode(' · ', array_filter([
                    $r->request_code,
                    $r->spi_code ? 'against ' . $r->spi_code : null,
                    $r->bank_name,
                    $r->utr_cheque_number,
                    $r->utr_cheque_date ? $this->day($r->utr_cheque_date) : null,
                ]))),
                $r->proof_path, 'payment_proof', 'Released',
            ) + ['amount' => (float) $r->amount])
            ->all();
    }

    /** One PO document, with its signing state when it has been sent. */
    private function fromPoDocument(PurchaseOrderDocument $d, ?ClmSignatureRequest $sig = null): array
    {
        return $this->doc(
            $d->name,
            trim(implode(' · ', array_filter([
                $d->code, $d->doc_sub, $d->generated_on ? $this->day($d->generated_on) : null,
            ]))),
            $d->file_path,
            $d->doc_kind,
            ucfirst((string) $d->status),
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
     * screen should draw rather than hide. Files stream through
     * /p2p/files/download because Azure keeps them off-origin, where a direct
     * link cannot be saved.
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

    /* ══════════════════════════ SHAPE ══════════════════════════ */

    /** A group with no section left holding anything is dropped by body(). */
    private function group(string $key, string $title, string $subtitle, array $sections): ?array
    {
        $sections = array_values(array_filter($sections));

        return $sections ? compact('key', 'title', 'subtitle', 'sections') : null;
    }

    private function section(string $key, string $title, array $documents): ?array
    {
        return $documents ? compact('key', 'title', 'documents') : null;
    }

    private function body(array $subject, array $groups, array $related = []): array
    {
        $groups = array_values(array_filter($groups));
        $docs   = collect($groups)->flatMap(
            fn ($g) => collect($g['sections'])->flatMap(fn ($s) => $s['documents']),
        );

        return [
            'subject' => $subject,
            'related' => array_filter($related, fn ($v) => $v !== null && $v !== []),
            'groups'  => $groups,
            'totals'  => [
                'documents' => $docs->count(),
                'available' => $docs->whereNotNull('file_url')->count(),
                'missing'   => $docs->whereNull('file_url')->count(),
            ],
        ];
    }

    private function day($date): string
    {
        return $date ? \Illuminate\Support\Carbon::parse($date)->format('d M Y') : '—';
    }
}
