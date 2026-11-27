<?php

namespace App\Services\P2p;

use App\Models\ClmSignatureRequest;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\P2p\SpiBoxAttachment;
use App\Models\P2p\SupplierInvoice;
use Illuminate\Support\Facades\DB;

class P2pVaultService
{
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
            ['purchase_order' => $po ? ['id' => $po->id, 'code' => $po->code] : null],
        );
    }

    public function forPo(PurchaseOrder $po): array
    {
        $invoices = SupplierInvoice::where('purchase_order_id', $po->id)->orderBy('id')->get();

        return $this->body(
            ['kind' => 'po', 'id' => $po->id, 'code' => $po->code],
            array_merge(
                [$this->poGroup($po), $this->tradeGroup($po)],
                $invoices->map(fn (SupplierInvoice $s) => $this->invoiceGroup($po, $s, true))->all(),
                [$this->loosePaymentGroup($po)],
            ),
            ['invoices' => $invoices->map(fn (SupplierInvoice $s) => ['id' => $s->id, 'code' => $s->code])->all()],
        );
    }

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

        return $this->group('trade', 'Trade Documents & Agreements',
            'Signed paperwork and shipping documents for this order', [
                $this->section('trade_documents', 'Trade Documents',
                    $rows->where('doc_kind', '!=', 'agreement')->map($shape)->values()->all()),
                $this->section('agreements', 'Agreements',
                    $rows->where('doc_kind', 'agreement')->map($shape)->values()->all()),
            ]);
    }

    private function invoiceGroup(?PurchaseOrder $po, SupplierInvoice $spi, bool $named = false): ?array
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

    private function loosePaymentGroup(PurchaseOrder $po): ?array
    {
        $rows = $this->paymentRows($po, null, true);
        if (!$rows) return null;

        return $this->group('payments', 'Payment Proofs',
            'Released against the order, not against one invoice', [
                $this->section('payment_proofs', 'Payment Proofs', $rows),
            ]);
    }

    private function boxDocs(SupplierInvoice $spi): array
    {
        $boxes = $spi->boxes()->orderBy('box_code')->get();
        if ($boxes->isEmpty()) return [[], []];

        $stickers = [];
        foreach ($boxes as $b) {
            $stickers[] = $this->doc(
                'Sticker — ' . $b->box_code,
                $b->sticker_printed_at ? 'Printed ' . $this->day($b->sticker_printed_at) : 'Not printed yet',
                null, 'box_sticker', $b->sticker_printed_at ? 'Printed' : 'Pending', 'generated',
            ) + [
                'action_url' => "/api/p2p/spi/{$spi->id}/boxes/{$b->id}/sticker/download",
                'action'     => 'print',
            ];
        }

        $files = SpiBoxAttachment::whereIn('box_id', $boxes->pluck('id'))->orderBy('id')->get();
        $codes = $boxes->pluck('box_code', 'id');

        $images = [];
        foreach ($files as $a) {
            $images[] = $this->doc(
                $a->file_name ?: 'Packing image',
                ($a->box_item_id ? 'Against a product in ' : 'Box ') . ($codes[$a->box_id] ?? $a->box_id),
                $a->file_path, $a->box_item_id ? 'product_image' : 'box_image', 'Uploaded',
            );
        }

        return [$stickers, $images];
    }

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

    private function fromPoDocument(PurchaseOrderDocument $d, ?ClmSignatureRequest $sig = null): array
    {
        $pos = null;
        if ($sig && is_array($sig->trade_doc_ids)) {
            $mine = $sig->document_type === ClmSignatureRequest::DOC_P2P_PO_DOCUMENT || $d->source_id === null
                ? (int) $d->id
                : (int) $d->source_id;
            $at  = array_search($mine, array_map('intval', $sig->trade_doc_ids), true);
            $pos = $at === false ? null : $at;
        }

        return $this->doc(
            $d->name,
            trim(implode(' · ', array_filter([
                $d->code, $d->doc_sub, $d->generated_on ? $this->day($d->generated_on) : null,
            ]))),
            $d->file_path,
            $d->doc_kind,
            ucfirst((string) $d->status),
            $d->status === 'signed' ? 'signed' : ($d->doc_kind === 'purchase_order' ? 'generated' : 'uploaded'),
        ) + [
            'id'               => $d->id,
            'code'             => $d->code,
            'required'         => $d->needed === 'yes',
            'signature_status' => $sig?->status,
            'signed_at'        => optional($d->signed_at)->toDateTimeString(),
            'signed_file_url'  => ($d->status === 'signed' && $sig && $pos !== null)
                ? "/api/clm/signature-requests/{$sig->id}/view-file/{$pos}"
                : null,
            'action_url' => (!$d->file_path
                && $d->doc_kind === 'purchase_order'
                && $d->status === 'pending')
                ? "/api/p2p/orders/{$d->purchase_order_id}/documents/{$d->id}/generate"
                : null,
            'action'     => (!$d->file_path && $d->doc_kind === 'purchase_order' && $d->status === 'pending')
                ? 'generate'
                : null,
        ];
    }

    private function doc(string $name, string $meta, ?string $path, string $kind, string $status, string $source = 'uploaded'): array
    {
        return [
            'name'     => $name,
            'meta'     => $meta,
            'kind'     => $kind,
            'status'   => $status,
            'source'   => $path ? $source : ($source === 'uploaded' ? 'awaited' : $source),
            'file_url' => $path ? file_url($path) : null,
            'url'      => $path ? '/api/p2p/files/download?path=' . rawurlencode($path) : null,
            'modes'    => $path ? ['preview', 'download'] : [],
        ];
    }

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
