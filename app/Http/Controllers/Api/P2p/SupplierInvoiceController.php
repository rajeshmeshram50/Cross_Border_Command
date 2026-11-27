<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\PoGstApproval;
use App\Models\P2p\PoPaymentRequest;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiPoFulfilment;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SupplierInvoice;
use App\Models\P2p\SupplierInvoiceItem;
use App\Services\P2p\PurchaseOrderService;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class SupplierInvoiceController extends Controller
{
    public function __construct(
        private SupplierInvoiceService $svc,
        private PurchaseOrderService $poSvc,
    ) {}

    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        if (!$user?->branch_id) abort(response()->json(['status' => false, 'message' => 'No branch context — the invoice number is allocated per branch'], 403));
        return $user;
    }

    private function findSpi(int $id): SupplierInvoice
    {
        $spi = SupplierInvoice::find($id);
        if (!$spi) {
            abort(response()->json([
                'status'  => false,
                'message' => "No supplier invoice found with id {$id}.",
            ], 404));
        }

        return $spi;
    }

    public function nextCode(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);

            $body = [
                'code'           => $this->svc->previewCode((int) $user->client_id, (int) $user->branch_id),
                'financial_year' => $this->svc->financialYear(),
            ];

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function poLines(Request $request, int $po)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $order = PurchaseOrder::findOrFail($po);
            $open  = $this->svc->openQtyByPoItem($po, $request->integer('exclude_spi') ?: null);

            $lines = DB::table('p2p_purchase_order_items')
                ->where('purchase_order_id', $po)
                ->orderBy('line_no')
                ->get()
                ->map(function ($l) use ($open) {
                    $ordered = (float) $l->quantity;
                    $balance = (float) ($open[$l->id] ?? $ordered);
                    $billed  = round($ordered - $balance, 3);
                    $split   = $this->svc->splitBalance($balance);

                    return [
                        'po_item_id'  => $l->id,
                        'pi_item_id'  => $l->pi_item_id,
                        'product_id'  => $l->product_id,
                        'description' => $l->description,

                        'qty_po'      => $ordered,
                        'qty_billed'  => $billed,

                        'qty_open'    => $split['open'],
                        'qty_over'    => $split['over'],
                        'closed'      => $split['closed'],

                        'rate'        => (float) $l->rate,
                        'gst_pct'     => $l->gst_pct === null ? null : (float) $l->gst_pct,
                    ];
                });

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'purchase_order_id' => $order->id,
                'document_type'     => $order->document_type,
                'currency_code'     => $order->currency_code,
                'vendor_id'         => $order->vendor_id,
                'lines'             => $lines,
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $f = $request->validate([
                'po_mode'       => ['nullable', Rule::in(['with_po', 'without_po'])],
                'shipment_mode' => ['nullable', Rule::in(['with_shipment', 'without_shipment'])],
                'status'        => ['nullable', Rule::in(SupplierInvoice::STATUSES)],
                'vendor_id'     => ['nullable', 'integer'],
                'from'          => ['nullable', 'date'],
                'to'            => ['nullable', 'date'],
                'q'             => ['nullable', 'string', 'max:120'],
                'page'          => ['nullable', 'integer', 'min:1'],
                'per_page'      => ['nullable', 'integer', 'min:1', 'max:100'],
            ]);

            $t = 'p2p_supplier_invoices';

            $base = SupplierInvoice::query();

            if (!empty($f['status']))    $base->where("$t.status", $f['status']);
            if (!empty($f['vendor_id'])) $base->where("$t.vendor_id", $f['vendor_id']);
            $spiDate = "COALESCE($t.invoice_date, $t.created_at)::date";
            if (!empty($f['from']))      $base->whereRaw("$spiDate >= ?", [$f['from']]);
            if (!empty($f['to']))        $base->whereRaw("$spiDate <= ?", [$f['to']]);

            if ($term = trim((string) ($f['q'] ?? ''))) {
                $this->applySearch($base, $term);
            }

            $tabs = $this->tabCounts(clone $base, $f['po_mode'] ?? null);

            $q = $base->with([
                'vendor:id,vendor_code,company_name,legal_name,risk_level_id,supplier_category',
                'vendor.riskLevel:id,name',
                'purchaseOrder:id,code,po_date,po_type,shipment_order_id,lead_id,proforma_invoice_id,'
                    . 'procurement_request_code,physical_inspection,inspection_status,zoho_status,'
                    . 'expected_delivery_date,grand_total,tds_amount,paid_amount,balance_amount',
                'warehouse:id,code,wh_name,wh_type',
            ])
                ->withCount(['paymentRequests as pending_payment_requests' =>
                    fn ($r) => $r->where('status', PoPaymentRequest::STATUS_PENDING)])
                ->withSum(['paymentRequests as approved_unpaid_amount' =>
                    fn ($r) => $r->where('status', PoPaymentRequest::STATUS_APPROVED)],
                    DB::raw('GREATEST(approved_amount - paid_amount, 0)'))
                ->withCount([
                    'boxes as boxes_total',
                    'putaways as boxes_placed' => fn ($r) => $r->where('status', SpiPutaway::PLACED),
                ]);

            $this->applyPoMode($q, $f['po_mode'] ?? null);
            $this->applyShipmentMode($q, $f['shipment_mode'] ?? null);

            $page = $q->orderByDesc("$t.id")->paginate((int) ($f['per_page'] ?? 10));
            $rows = collect($page->items());
            $refs = $this->linkRefs($rows);

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $rows->map(fn ($s) => $this->listRow($s, $refs))->all(),
                'tabs'   => $tabs,
                'meta'   => [
                    'page'      => $page->currentPage(),
                    'per_page'  => $page->perPage(),
                    'total'     => $page->total(),
                    'last_page' => $page->lastPage(),
                ],
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            $spi->load([
                'items',
                'vendor:id,vendor_code,company_name',
                'warehouse:id,code,wh_name,wh_type',
                'purchaseOrder:id,code,po_date,po_type,shipment_order_id,lead_id,procurement_request_code,'
                    . 'expected_delivery_date,grand_total,tds_amount,paid_amount,balance_amount',
                'purchaseOrder.shipmentOrder:id,shipment_code',
                'shipmentOrder:id,shipment_code,proforma_invoice_id,created_at',
                'shipmentOrder.proformaInvoice:id,code',
                'boxes.items',
                'boxes.attachments',
                'putaways.box:id,box_code',
            ]);

            $full    = $this->isOwnWarehouse($spi->warehouse_id);
            $packing = $this->svc->packingSummary($spi->id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'invoice'        => $spi,
                'owns_zoho_bill' => $spi->ownsZohoBill(),

                'match' => $this->matchSummary($spi),

                'packing_summary' => $packing,
                'packing_totals'  => $this->svc->packingTotals($packing) + ['boxes' => $spi->boxes->count()],

                'putaway' => [
                    'mode'     => $full ? 'full' : 'summary',
                    'placed'   => $spi->putaways->whereNotNull('confirmed_at')->count(),
                    'total'    => $spi->boxes->count(),
                    'rows'     => $spi->putaways->map(fn($p) => [
                        'id'               => $p->id,
                        'box_code'         => $p->box?->box_code,
                        'destination'      => $p->destination,
                        'confirmed_at'     => $p->confirmed_at,
                        'next_scan'        => $p->nextScan($full),
                        'ready_to_confirm' => $p->isReadyToConfirm($full),
                    ])->values(),
                ],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $data = $this->validateHeader($request, $user, null);

            if (!empty($data['purchase_order_id'])) {
                $po = PurchaseOrder::find((int) $data['purchase_order_id']);
                if (!$po) {
                    abort(response()->json(['status' => false, 'message' => 'Purchase order not found.',
                        'errors' => ['purchase_order_id' => ['Purchase order not found.']]], 422));
                }
                $open = $this->svc->openQtyByPoItem((int) $po->id);
                if ($open && array_sum(array_map(fn ($q) => max(0, (float) $q), $open)) <= 0) {
                    $msg = "{$po->code} is fully invoiced — every line is already billed on its SPIs, so there is nothing left to invoice.";
                    abort(response()->json(['status' => false, 'message' => $msg,
                        'errors' => ['purchase_order_id' => [$msg]]], 422));
                }
            }

            $spi = SupplierInvoice::create($data + [
                'code'            => $this->svc->nextCode((int) $user->client_id, (int) $user->branch_id),
                'stage_completed' => empty($data['purchase_order_id']) ? 0 : 1,
                'status'          => SupplierInvoice::STATUS_DRAFT,
                'created_by'      => $user->id,
            ]);

            $this->svc->log($spi, 'created', ['new_value' => $spi->code]);

            $spi->refresh();

            DB::commit();

            return response()->json(['status' => true, 'data' => $spi], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function updateStage1(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $spi  = $this->findSpi($id);

            if (!$spi->isEditable()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is {$spi->status} and can no longer be edited.",
                ], 422));
            }

            $data = $this->validateHeader($request, $user, $spi);

            if (
                array_key_exists('purchase_order_id', $data)
                && (int) $data['purchase_order_id'] !== (int) $spi->purchase_order_id
                && $spi->items()->exists()
            ) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Items are already mapped to this invoice — clear Stage 02 before changing the purchase order.',
                    'errors'  => ['purchase_order_id' => ['Cannot be changed while items exist.']],
                ], 422));
            }

            $sentToSenior = $spi->gstApprovals()
                ->whereIn('status', [PoGstApproval::STATUS_PENDING, PoGstApproval::STATUS_APPROVED])
                ->exists();

            if ($sentToSenior && (
                (int) $data['vendor_id'] !== (int) $spi->vendor_id
                || $data['document_type'] !== $spi->document_type
            )) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} has gone to a senior for GST approval — the supplier and document type can no longer change.",
                    'errors'  => [
                        'vendor_id'     => ['The supplier is fixed once the invoice is sent for senior approval.'],
                        'document_type' => ['The document type is fixed once the invoice is sent for senior approval.'],
                    ],
                ], 422));
            }

            $blockers = $this->stage1Blockers($spi, $data, $user);

            $spi->forceFill($data + [
                'updated_by' => $user->id,
                'stage_completed' => max($blockers ? 0 : 1, (int) $spi->stage_completed),
            ])->save();
            $this->svc->log($spi, 'stage1_saved');
            $spi->refresh();

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $spi,
                'blockers' => $blockers,
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function updateItems(Request $request, int $id)
    {
        $files = [];

        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $spi  = $this->findSpi($id);

            if (!$spi->isEditable()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is {$spi->status} and can no longer be edited.",
                ], 422));
            }

            $header = $this->validateInvoiceDetails($request, $user, $spi);

            $data = $request->validate([
                'items'              => ['required', 'array', 'min:1'],
                'items.*.id'         => ['nullable', 'integer'],
                'items.*.po_item_id' => ['nullable', 'integer'],
                'items.*.pi_item_id' => ['nullable', 'integer'],
                'items.*.product_id' => ['required', 'integer'],
                'items.*.qty_spi'    => ['required', 'numeric', 'gt:0'],
                'items.*.rate'       => ['required', 'numeric', 'min:0'],

                'items.*.extra_qty'      => ['nullable', 'numeric', 'min:0'],
                'items.*.gst_pct'        => ['nullable', 'numeric', 'min:0', 'max:100'],
                'items.*.taxable_amount' => ['required', 'numeric', 'min:0'],
                'items.*.cgst_amount'    => ['nullable', 'numeric', 'min:0'],
                'items.*.sgst_amount'    => ['nullable', 'numeric', 'min:0'],
                'items.*.igst_amount'    => ['nullable', 'numeric', 'min:0'],
                'items.*.line_total'     => ['required', 'numeric', 'min:0'],

                'taxable_total' => ['required', 'numeric', 'min:0'],
                'total_cgst'    => ['nullable', 'numeric', 'min:0'],
                'total_sgst'    => ['nullable', 'numeric', 'min:0'],
                'total_igst'    => ['nullable', 'numeric', 'min:0'],
                'grand_total'   => ['required', 'numeric', 'min:0'],

                'invoice_file' => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:10240'],
                'eway_file'    => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:10240'],
            ], [
                'invoice_file.mimes' => 'The invoice must be a PDF or an image.',
                'invoice_file.max'   => 'The invoice may not be larger than 10 MB.',
                'eway_file.mimes'    => 'The e-way bill must be a PDF or an image.',
                'eway_file.max'      => 'The e-way bill may not be larger than 10 MB.',
            ]);

            if (!$spi->purchase_order_id) {
                $this->guardSupplierSegments($spi, $data['items'], (int) $user->client_id);
            }

            $files = $this->storeAttachments($request, $spi);

            $superseded = [];
            foreach (['invoice', 'eway'] as $kind) {
                $new = $files["{$kind}_file_path"] ?? null;
                $old = $spi->{"{$kind}_file_path"};
                if ($new && $old && $old !== $new) $superseded["{$kind}_file_path"] = $old;
            }

            $rows = $this->priceLines(
                $data['items'],
                $spi->isInternational(),
                $spi->purchase_order_id ? (int) $spi->purchase_order_id : null,
                $spi->id,
            );

            $warnings = $this->overBillWarnings($spi, $rows);

            $totals = [
                'taxable_total' => $data['taxable_total'],
                'total_cgst'    => $spi->isInternational() ? 0 : ($data['total_cgst'] ?? 0),
                'total_sgst'    => $spi->isInternational() ? 0 : ($data['total_sgst'] ?? 0),
                'total_igst'    => $spi->isInternational() ? 0 : ($data['total_igst'] ?? 0),
                'grand_total'   => $data['grand_total'],
            ];

            $spi->forceFill($header + $totals + $files + [
                'stage_completed' => max(2, (int) $spi->stage_completed),
                'updated_by'      => $user->id,
            ])->save();

            foreach (['invoice' => 'invoice_uploaded', 'eway' => 'eway_uploaded'] as $kind => $event) {
                if (isset($files["{$kind}_file_name"])) {
                    $this->svc->log($spi, $event, ['new_value' => $files["{$kind}_file_name"], 'stage' => 2]);
                }
            }

            $spi = $this->svc->saveItems($spi, $rows, false);
            $this->svc->normaliseBoxScenarios($spi);
            $this->svc->syncPackingStage($spi);

            $spi->load('items');

            DB::commit();

            $this->removeFiles($superseded);

            return response()->json(['status' => true, 'data' => [
                'invoice'  => $spi,
                'match'    => $this->matchSummary($spi),
                'warnings' => $warnings,
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->removeFiles($files);

            if (!$e instanceof \Illuminate\Http\Exceptions\HttpResponseException
                && !$e instanceof \Illuminate\Validation\ValidationException) {
                Log::error('SPI items save failed', [
                    'spi_id'    => $id,
                    'items'     => is_array($request->input('items')) ? count($request->input('items')) : null,
                    'has_files' => $request->hasFile('invoice_file') || $request->hasFile('eway_file'),
                    'disk'      => config('filesystems.documents') ?: config('filesystems.default', 'public'),
                    'error'     => $e->getMessage(),
                    'at'        => $e->getFile() . ':' . $e->getLine(),
                ]);
            }

            throw $e;
        }
    }

    private function removeFiles(array $files): void
    {
        foreach ($files as $key => $path) {
            if (!str_ends_with($key, '_path') || !$path) continue;
            $disk = config('filesystems.documents') ?: config('filesystems.default', 'public');
            try { Storage::disk($disk)->delete($path); } catch (\Throwable) { }
        }
    }

    public function submit(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            if (!$spi->items()->exists()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Add at least one item before submitting.',
                ], 422));
            }

            $pending = collect($this->svc->packingSummary($spi->id))->firstWhere('qty_pending', '>', 0);
            if ($pending) {
                abort(response()->json([
                    'status'  => false,
                    'message' => number_format($pending['qty_pending'], 3)
                        . ' is still unpacked. Goods not in a box have no box code, '
                        . 'so they cannot be scanned, racked or inspected.',
                ], 422));
            }

            $unplaced = SpiBox::where('supplier_invoice_id', $spi->id)
                ->whereDoesntHave('putaway', fn ($q) => $q->where('status', SpiPutaway::PLACED))
                ->orderBy('box_code')
                ->pluck('box_code');

            if ($unplaced->isNotEmpty()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => $unplaced->count() === 1
                        ? "{$unplaced->first()} has not been put away. Place it before submitting."
                        : $unplaced->count() . ' boxes have not been put away: '
                            . $unplaced->take(5)->implode(', ')
                            . ($unplaced->count() > 5 ? ' …' : '') . '.',
                    'unplaced' => $unplaced->all(),
                ], 422));
            }

            $spi->forceFill([
                'status'          => SupplierInvoice::STATUS_MAPPED,
                'stage_completed' => 4,
            ])->save();

            $this->svc->log($spi, 'submitted', ['note' => $request->input('note')]);
            $spi->refresh();

            DB::commit();

            return response()->json(['status' => true, 'data' => $spi], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            if ($spi->status === SupplierInvoice::STATUS_CLOSED) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is closed — a received invoice cannot be deleted.",
                ], 422));
            }

            foreach ($spi->items as $item) {
                $this->svc->syncFulfilment($item, SpiPoFulfilment::EVENT_CANCELLED, (float) $item->qty_spi);
            }

            $this->svc->log($spi, 'cancelled');
            $spi->items()->delete();
            $spi->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function paymentRequests(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $po  = $spi->purchaseOrder;

            $rows = PoPaymentRequest::where('supplier_invoice_id', $spi->id)
                ->orderBy('id')->get();

            $approved = $rows->where('status', PoPaymentRequest::STATUS_APPROVED);
            $people = $this->requestPeople($rows->pluck('requested_by')->merge($rows->pluck('requested_to'))->all());
            $raisedAgainst = [
                'link_type' => $po ? (($spi->shipment_order_id || $po->shipment_order_id) ? 'with_shipment' : 'without_shipment') : 'direct_spi',
                'po'  => $po ? ['id' => $po->id, 'code' => $po->code, 'date' => $po->po_date] : null,
                'spi' => ['id' => $spi->id, 'code' => $spi->code, 'invoice_no' => $spi->invoice_no, 'date' => optional($spi->invoice_date)->toDateString()],
            ];
            $paid     = round((float) $rows->sum('paid_amount'), 2);
            $gst      = round((float) $spi->total_cgst + (float) $spi->total_sgst + (float) $spi->total_igst, 2);
            $tds      = round((float) $spi->tds_amount, 2);
            $tdsLock  = \App\Http\Controllers\Api\P2p\PoPaymentRequestController::spiTdsLockedBy((int) $spi->id);
            $net      = round((float) $spi->grand_total - $tds, 2);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'spi' => [
                    'id' => $spi->id,
                    'code' => $spi->code,
                    'base_amount'  => (float) $spi->taxable_total,
                    'gst_amount'   => $gst,
                    'grand_total'  => (float) $spi->grand_total,
                    'tds_percentage' => (float) $spi->tds_percentage,
                    'tds_amount'     => $tds,
                    'tds_saved'      => (bool) $spi->tds_updated_at,
                    'tds_locked'     => $tdsLock !== null,
                    'tds_locked_by'  => $tdsLock,
                    'tds_applies'    => !$spi->isInternational(),
                    'net_payable'    => $net,
                    'paid_amount'  => $paid,
                    'balance'      => round($net - $paid, 2),
                ],

                'requests_summary' => [
                    'total'            => $rows->count(),
                    'requested_amount' => round((float) $rows->sum('requested_amount'), 2),
                    'awaiting'         => round((float) $rows->where('status', PoPaymentRequest::STATUS_PENDING)->sum('requested_amount'), 2),
                    'approved_amount'  => round((float) $approved->sum('approved_amount'), 2),
                    'paid_amount'      => $paid,
                    'ready_to_pay'     => round((float) $approved->sum(fn($r) => max(0, (float) $r->approved_amount - (float) $r->paid_amount)), 2),
                ],

                'po' => $po ? [
                    'id' => $po->id,
                    'code' => $po->code,
                    'grand_total'    => (float) $po->grand_total,
                    'tds_amount'     => (float) $po->tds_amount,
                    'net_payable'    => round((float) $po->grand_total - (float) $po->tds_amount, 2),
                    'paid_amount'    => (float) $po->paid_amount,
                    'balance_amount' => (float) $po->balance_amount,
                ] : null,

                'ledger' => $po ? [
                    'source'         => 'purchase_order',
                    'code'           => $po->code,
                    'grand_total'    => (float) $po->grand_total,
                    'tds_percentage' => (float) $po->tds_percentage,
                    'tds_amount'     => (float) $po->tds_amount,
                    'tds_saved'      => (bool) $po->tds_updated_at,
                    'net_payable'    => round((float) $po->grand_total - (float) $po->tds_amount, 2),
                    'paid_amount'    => (float) $po->paid_amount,
                    'balance_amount' => (float) $po->balance_amount,
                ] : [
                    'source'         => 'supplier_invoice',
                    'code'           => $spi->code,
                    'grand_total'    => (float) $spi->grand_total,
                    'tds_percentage' => (float) $spi->tds_percentage,
                    'tds_amount'     => (float) $spi->tds_amount,
                    'tds_saved'      => (bool) $spi->tds_updated_at,
                    'tds_locked'     => $tdsLock !== null,
                    'tds_locked_by'  => $tdsLock,
                    'tds_applies'    => !$spi->isInternational(),
                    'net_payable'    => round((float) $spi->grand_total - (float) $spi->tds_amount, 2),
                    'paid_amount'    => $spi->paid_amount === null ? null : (float) $spi->paid_amount,
                    'balance_amount' => $spi->balance_amount === null
                        ? round((float) $spi->grand_total - (float) $spi->tds_amount, 2)
                        : (float) $spi->balance_amount,
                ],

                'requests' => $rows->map(fn($r) => [
                    'id' => $r->id,
                    'code' => $r->code,
                    'payment_type'     => $r->payment_type,
                    'percentage'       => $r->percentage !== null ? (float) $r->percentage : null,
                    'requested_amount' => (float) $r->requested_amount,
                    'requested_by'     => ['id' => $r->requested_by, 'name' => $people[$r->requested_by]['name'] ?? null, 'role' => $people[$r->requested_by]['role'] ?? null],
                    'requested_to'     => ['id' => $r->requested_to, 'name' => $people[$r->requested_to]['name'] ?? null, 'role' => $people[$r->requested_to]['role'] ?? null],
                    'requested_at'     => $r->requested_at,
                    'raised_against'   => $raisedAgainst,
                    'status'           => $r->status,
                    'approved_amount'  => $r->approved_amount !== null ? (float) $r->approved_amount : null,
                    'paid_amount'      => (float) $r->paid_amount,
                    'due'              => $r->approved_amount !== null
                        ? max(0, round((float) $r->approved_amount - (float) $r->paid_amount, 2))
                        : null,
                ])->values(),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function zohoSync(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $spi  = $this->findSpi($id);
            $zoho = app(\App\Services\P2p\PoZohoService::class);

            try {
                if (!$spi->ownsZohoBill()) {
                    $po = $spi->purchaseOrder;
                    if (!$po) {
                        abort(response()->json(['status' => false, 'message' => 'This invoice has no purchase order to sync.'], 422));
                    }
                    $result  = $zoho->syncAll($po, $user->id);
                    $message = 'Synced to Zoho Books — ' . $zoho->summary($result) . '.';
                } else {
                    $result  = $zoho->syncSpi($spi, $user->id);
                    $parts   = ['bill ' . ($result['bill_number'] ?: '—')];
                    if (($result['pushed'] ?? 0) > 0) {
                        $parts[] = $result['pushed'] . ' payment(s) of ₹' . number_format((float) $result['applied'], 2);
                    }
                    $message = 'Synced to Zoho Books — ' . implode(', ', $parts) . '.';
                }
            } catch (\RuntimeException $e) {
                abort(response()->json(['status' => false, 'message' => $e->getMessage()], 422));
            }

            DB::commit();

            return response()->json(['status' => true, 'message' => $message, 'data' => $result], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function summary(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $body = app(\App\Services\P2p\SpiSummaryService::class)->build($this->findSpi($id));

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function packedBoxes(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $opts = $request->validate([
                'bucket'   => ['nullable', 'in:all,ship,inv,damaged,mismatch'],
                'handling' => ['nullable', 'in:haz,non_haz,cold'],
                'search'   => ['nullable', 'string', 'max:120'],
                'page'     => ['nullable', 'integer', 'min:1'],
                'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            ]);

            $body = app(\App\Services\P2p\SpiSummaryService::class)->packedBoxes($this->findSpi($id), $opts);

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function evidenceVault(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $body = app(\App\Services\P2p\P2pVaultService::class)->forSpi($this->findSpi($id));

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function zohoTracker(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            if (!$spi->ownsZohoBill()) {
                $po = $spi->purchaseOrder;

                $body = [
                    'owns_bill'  => false,
                    'bill_owner' => [
                        'type'             => 'purchase_order',
                        'id'               => $po?->id,
                        'code'             => $po?->code,
                        'zoho_bill_id'     => $po?->zoho_bill_id,
                        'zoho_bill_number' => $po?->zoho_bill_number,
                    ],
                    'can_retry' => false,
                ];
            } else {
                $body = [
                    'owns_bill'        => true,
                    'zoho_bill_id'     => $spi->zoho_bill_id,
                    'zoho_bill_number' => $spi->zoho_bill_number,
                    'zoho_status'      => $spi->zoho_status,
                    'zoho_synced_at'   => $spi->zoho_synced_at,
                    'zoho_error'       => $spi->zoho_error,
                    'can_retry'        => $spi->zoho_status === 'failed',
                ];
            }

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    private function listRow(SupplierInvoice $s, array $refs = ['ship' => [], 'opp' => []]): array
    {
        $po = $s->purchaseOrder;

        $shipId = $s->shipment_order_id ?? $po?->shipment_order_id;
        $ship   = $shipId ? ($refs['ship'][$shipId] ?? null) : null;
        $piId   = $po?->proforma_invoice_id ?? $ship->proforma_invoice_id ?? null;
        $opp    = $piId ? ($refs['opp'][$piId] ?? null) : null;
        $day  = fn ($d) => $d ? substr((string) $d, 0, 10) : null;

        $boxes  = $s->boxes_total  ?? null;
        $placed = $s->boxes_placed ?? null;

        return [
            'id'          => $s->id,
            'boxes_total'       => $boxes,
            'boxes_placed'      => $placed,
            'putaway_complete'  => ($boxes === null || $placed === null)
                ? null
                : ($boxes > 0 && $placed >= $boxes),
            'spi_number'  => $s->code,
            'spi_date'    => $day($s->invoice_date ?: $s->created_at),
            'invoice_no'  => $s->invoice_no,

            'is_direct'   => $s->isStandalone(),
            'po_number'   => $po?->code,
            'po_date'     => $day($po?->po_date),
            'po_type'     => $po?->po_type,
            'document_type'       => $s->document_type,
            'physical_inspection' => $po?->physical_inspection,
            'inspection_status'   => $po?->physical_inspection === 'yes'
                ? ($po->inspection_status ?: 'pending')
                : 'not_applicable',

            'shipment_id'      => $ship->shipment_code ?? null,
            'shipment_date'    => $day($ship->created_at ?? null),
            'opportunity_id'   => $opp->opp_code ?? null,
            'opportunity_date' => $day($opp->created_at ?? null),
            'procurement_id'   => $s->procurement_request_code ?? $po?->procurement_request_code,

            'supplier'    => [
                'id'            => $s->vendor?->id,
                'code'          => $s->vendor?->vendor_code,
                'name'          => $s->vendor?->company_name ?: $s->vendor?->legal_name,
                'risk_level_id' => $s->vendor?->risk_level_id,
                'risk'          => $s->vendor?->riskLevel?->name,
                'category'      => $s->vendor?->supplier_category,
            ],

            'expected_delivery_date' => $day($po?->expected_delivery_date),

            'zoho_status' => $s->isStandalone() ? $s->zoho_status : $po?->zoho_status,

            'pending_payment_requests' => (int) ($s->pending_payment_requests ?? 0),
            'approved_unpaid_amount'   => round((float) ($s->approved_unpaid_amount ?? 0), 2),

            'total_po_amount'    => (float) ($po ? $po->grand_total : $s->grand_total),
            'net_payable_amount' => $po
                ? round((float) $po->grand_total - (float) $po->tds_amount, 2)
                : round((float) $s->grand_total - (float) $s->tds_amount, 2),
            'total_paid_amount'  => (float) ($po ? $po->paid_amount : $s->paid_amount),
            'balance_amount'     => $po
                ? (float) $po->balance_amount
                : round((float) $s->grand_total - (float) $s->tds_amount - (float) $s->paid_amount, 2),
            'total_spi_amount'   => (float) $s->grand_total,

            'warehouse'   => $s->warehouse ? [
                'id'      => $s->warehouse->id,
                'code'    => $s->warehouse->code,
                'name'    => $s->warehouse->wh_name,
                'is_own'  => $s->warehouse->wh_type === 'own',
            ] : null,

            'status'          => $s->status,
            'status_label'    => SupplierInvoice::STATUS_LABELS[$s->status] ?? $s->status,
            'stage_completed' => $s->stage_completed,
        ];
    }

    private function applyPoMode($q, ?string $mode): void
    {
        if ($mode === 'with_po')    $q->whereNotNull('p2p_supplier_invoices.purchase_order_id');
        if ($mode === 'without_po') $q->whereNull('p2p_supplier_invoices.purchase_order_id');
    }

    private function applyShipmentMode($q, ?string $mode): void
    {
        if ($mode === 'with_shipment') {
            $q->where(fn ($w) => $w
                ->whereNotNull('p2p_supplier_invoices.shipment_order_id')
                ->orWhereHas('purchaseOrder', fn ($p) => $p->whereNotNull('shipment_order_id')));
        }
        if ($mode === 'without_shipment') {
            $q->whereNull('p2p_supplier_invoices.shipment_order_id')
                ->whereDoesntHave('purchaseOrder', fn ($p) => $p->whereNotNull('shipment_order_id'));
        }
    }

    private function linkRefs($rows): array
    {
        $rows = collect($rows);
        $pos  = $rows->map(fn ($s) => $s->purchaseOrder)->filter();

        $shipIds = $rows->pluck('shipment_order_id')
            ->merge($pos->pluck('shipment_order_id'))
            ->filter()->unique()->all();

        $ship = DB::table('shipment_orders')
            ->whereIn('id', $shipIds ?: [0])
            ->get(['id', 'shipment_code', 'proforma_invoice_id', 'created_at'])->keyBy('id');

        $piIds = $pos->pluck('proforma_invoice_id')
            ->merge($ship->pluck('proforma_invoice_id'))
            ->filter()->unique()->all();

        $opp = DB::table('proforma_invoices')
            ->whereIn('id', $piIds ?: [0])
            ->get(['id', 'opp_code', 'created_at'])->keyBy('id');

        return ['ship' => $ship, 'opp' => $opp];
    }

    private function tabCounts($base, ?string $poMode = null): array
    {
        $r = (clone $base)->select(DB::raw(
            'COUNT(*) AS all_spi,
             COUNT(p2p_supplier_invoices.purchase_order_id) AS with_po,
             COUNT(*) FILTER (WHERE p2p_supplier_invoices.purchase_order_id IS NULL) AS direct_spi,
             COUNT(DISTINCT p2p_supplier_invoices.purchase_order_id) AS distinct_po'
        ))->reorder()->first();

        $scoped = clone $base;
        $this->applyPoMode($scoped, $poMode);
        $scopedTotal = (clone $scoped)->count();

        $shipQ = clone $scoped;
        $this->applyShipmentMode($shipQ, 'with_shipment');
        $withShipment = $shipQ->count();

        return [
            'all_spi'          => (int) $r->all_spi,
            'total_spi'        => (int) $r->all_spi,
            'with_po'          => (int) $r->with_po,
            'direct_spi'       => (int) $r->direct_spi,
            'without_po'       => (int) $r->direct_spi,
            'distinct_po'      => (int) $r->distinct_po,
            'with_shipment'    => $withShipment,
            'without_shipment' => $scopedTotal - $withShipment,
        ];
    }

    private function applySearch($q, string $term): void
    {
        $like = '%' . $term . '%';

        $q->leftJoin('p2p_purchase_orders as po', 'po.id', '=', 'p2p_supplier_invoices.purchase_order_id')
            ->leftJoin('vendors as v', 'v.id', '=', 'p2p_supplier_invoices.vendor_id')
            ->leftJoin('shipment_orders as sh', fn ($j) => $j->whereRaw(
                'sh.id = COALESCE(p2p_supplier_invoices.shipment_order_id, po.shipment_order_id)'))
            ->leftJoin('proforma_invoices as pfi', 'pfi.id', '=', 'po.proforma_invoice_id')
            ->leftJoin('master_risk_levels as rl', 'rl.id', '=', 'v.risk_level_id')
            ->leftJoin('inventory_warehouses as wh', 'wh.id', '=', 'p2p_supplier_invoices.warehouse_id')
            ->select('p2p_supplier_invoices.*')
            ->where(function ($w) use ($like, $term) {
                $w->where('p2p_supplier_invoices.code', 'ilike', $like)
                    ->orWhere('p2p_supplier_invoices.invoice_no', 'ilike', $like)
                    ->orWhere('p2p_supplier_invoices.status', 'ilike', $like)
                    ->orWhere('p2p_supplier_invoices.document_type', 'ilike', $like)
                    ->orWhere('po.code', 'ilike', $like)
                    ->orWhere('po.po_type', 'ilike', $like)
                    ->orWhere('po.procurement_request_code', 'ilike', $like)
                    ->orWhere('p2p_supplier_invoices.procurement_request_code', 'ilike', $like)
                    ->orWhere('sh.shipment_code', 'ilike', $like)
                    ->orWhere('pfi.opp_code', 'ilike', $like)
                    ->orWhere('v.legal_name', 'ilike', $like)
                    ->orWhere('v.company_name', 'ilike', $like)
                    ->orWhere('v.vendor_code', 'ilike', $like)
                    ->orWhere('rl.name', 'ilike', $like)
                    ->orWhere('wh.wh_name', 'ilike', $like)
                    ->orWhere('wh.code', 'ilike', $like);

                $t = strtolower(trim($term));
                if ($t === 'own') $w->orWhere('wh.wh_type', 'own');
                if (in_array($t, ['3pl', 'tpl'], true) || (strlen($t) >= 4 && str_contains('third party', $t))) {
                    $w->orWhere('wh.wh_type', 'tpl');
                }

                if (strlen($term) >= 4 && str_contains('direct spi without po', strtolower($term))) {
                    $w->orWhereNull('p2p_supplier_invoices.purchase_order_id');
                }
            });
    }

    private function stage1Blockers(SupplierInvoice $spi, array $data, $user): array
    {
        if (!empty($data['purchase_order_id'])) return [];

        $vendorId = (int) ($data['vendor_id'] ?? $spi->vendor_id);
        if (!$vendorId) return [['code' => 'no_supplier', 'message' => 'Select a supplier.']];

        $out = [];
        $international = ($data['document_type'] ?? $spi->document_type) === 'international';
        $gst = $this->poSvc->gstGate($vendorId, $international);

        if ($gst['gate'] === 'blocked') {
            $out[] = ['code' => 'gst_blocked', 'message' => 'GST scrutiny is older than '
                . PurchaseOrderService::GST_STALE_MONTHS
                . ' months — refresh it on the supplier record.'];
        } elseif ($gst['gate'] === 'approval_required') {
            $approval = $spi->gstApprovals()->latest('id')->first();
            if ($approval?->status !== PoGstApproval::STATUS_APPROVED) {
                $out[] = ['code' => 'gst_approval', 'message' => match ($approval?->status) {
                    PoGstApproval::STATUS_PENDING  => 'Senior approval is still pending.',
                    PoGstApproval::STATUS_REJECTED => 'The senior rejected this invoice: ' . $approval->reason,
                    default => 'The supplier\'s last GST return is overdue — send it for senior approval.',
                }];
            }
        }

        if ($expired = $this->poSvc->expiredStandardDocs($vendorId, (int) $user->client_id)) {
            $named = collect($expired)->take(3)
                ->map(fn ($d) => $d['name'] . ' (expired ' . $d['expiry'] . ')')->implode(', ');
            $rest = count($expired) - 3;
            $out[] = [
                'code'      => 'expired_documents',
                'message'   => 'The supplier\'s paperwork has expired: ' . $named
                    . ($rest > 0 ? ' and ' . $rest . ' more' : '')
                    . '. Renew it in the Evidence Vault.',
                'documents' => $expired,
            ];
        }

        return $out;
    }

    private function validateHeader(Request $request, $user, ?SupplierInvoice $spi): array
    {
        return $request->validate([
            'purchase_order_id' => ['nullable', 'integer'],
            'vendor_id'         => ['required', 'integer'],

            'shipment_order_id' => ['nullable', 'integer', Rule::exists('shipment_orders', 'id')
                ->where(fn ($q) => $q->where('client_id', $user->client_id))],

            'procurement_request_id' => ['nullable', 'integer'],
            'procurement_request_code' => ['nullable', 'string', 'max:30'],
            'document_type'     => ['required', Rule::in(SupplierInvoice::DOC_TYPES)],
            'warehouse_id'      => ['nullable', 'integer', Rule::exists('inventory_warehouses', 'id')
                ->where(fn ($q) => $q
                    ->where('client_id', $user->client_id)
                    ->where(fn ($w) => $w
                        ->whereNull('branch_id')
                        ->orWhere('branch_id', $spi?->branch_id ?? $user->branch_id)))],
        ]);
    }

    private function validateInvoiceDetails(Request $request, $user, SupplierInvoice $spi): array
    {
        $poDate = $spi->purchase_order_id
            ? optional($spi->purchaseOrder)->po_date?->toDateString()
            : null;
        $piDate = !$spi->purchase_order_id && $spi->shipmentOrder
            ? $this->poSvc->piDate($this->poSvc->piIdForShipment($spi->shipmentOrder))
            : null;
        $minDate = $poDate ?? $piDate;

        return $request->validate([
            'invoice_no' => [
                'required',
                'string',
                'max:60',
                Rule::unique('p2p_supplier_invoices', 'invoice_no')
                    ->where(fn($q) => $q->where('client_id', $user->client_id)->where('vendor_id', $spi->vendor_id))
                    ->ignore($spi->id),
            ],
            'invoice_date'  => array_values(array_filter([
                'required', 'date', 'before_or_equal:today',
                $minDate ? "after_or_equal:$minDate" : null,
            ])),
            'eway_no'       => ['nullable', 'string', 'max:40'],
            'currency_code' => ['nullable', 'string', 'size:3', 'required_if:document_type,international'],
            'exchange_rate' => ['nullable', 'numeric', 'gt:0'],
        ], [
            'invoice_no.unique' => 'This supplier has already billed that invoice number.',
            'invoice_date.before_or_equal' => 'The purchase invoice date cannot be a future date.',
            'invoice_date.after_or_equal' => $minDate
                ? 'The purchase invoice date cannot be earlier than the ' . ($poDate ? 'PO' : 'PI') . ' date (' . date('d-M-Y', strtotime($minDate)) . ').'
                : 'The purchase invoice date cannot be earlier than the PO date.',
        ]);
    }

    private function isOwnWarehouse(?int $warehouseId): bool
    {
        if (!$warehouseId) return true;

        return DB::table('inventory_warehouses')->where('id', $warehouseId)->value('wh_type') === 'own';
    }

    private function matchSummary(SupplierInvoice $spi): array
    {
        $items = $spi->items;

        $ordered = $items->sum(fn ($i) => (float) ($i->qty_po ?? $i->qty_pi ?? 0));

        return [
            'lines'       => $items->count(),
            'qty_po'      => round((float) $items->sum('qty_po'), 3),
            'qty_ordered' => round($ordered, 3),
            'qty_spi'     => round((float) $items->sum('qty_spi'), 3),
            'missing_qty' => round((float) $items->sum('missing_qty'), 3),
            'extra_qty'   => round((float) $items->sum('extra_qty'), 3),
            'matched'     => $items->every(fn($i) => $i->missing_qty <= 0.001 && (float) $i->extra_qty <= 0.001),
        ];
    }

    public function completeStage3(Request $request, int $id)
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        $rows   = $this->svc->packingSummary($spi->id);
        $totals = $this->svc->packingTotals($rows);

        if (!$rows) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$spi->code} has no products to pack.",
            ], 422));
        }

        if (!$totals['fully_packed']) {
            $short = collect($rows)->filter(fn ($r) => (float) $r['qty_pending'] > 0.001)->values();
            $names = SupplierInvoiceItem::whereIn('id', $short->pluck('supplier_invoice_item_id'))
                ->pluck('description', 'id');
            $list  = $short->take(5)
                ->map(fn ($r) => $names[$r['supplier_invoice_item_id']] ?? "item #{$r['supplier_invoice_item_id']}")
                ->implode(', ');

            abort(response()->json([
                'status'  => false,
                'message' => $short->count() === 1
                    ? "{$list} is not fully boxed. Box every unit before moving on."
                    : $short->count() . ' products are not fully boxed: ' . $list
                        . ($short->count() > 5 ? ' …' : '') . '.',
                'pending' => $short->all(),
            ], 422));
        }

        $missing = app(\App\Services\Inventory\WarehouseCapabilityService::class)
            ->missingFor($spi->id, $spi->warehouse_id ? (int) $spi->warehouse_id : null);
        if ($missing) {
            abort(response()->json([
                'status'                 => false,
                'message'                => 'The selected warehouse has no ' . implode(' and ', $missing)
                    . " — the boxes on {$spi->code} need it. Change the warehouse before moving to putaway.",
                'warehouse_incompatible' => true,
                'missing'                => $missing,
            ], 422));
        }

        if ($this->svc->syncPackingStage($spi) === 3 && !$spi->wasRecentlyCreated) {
            $spi->forceFill(['updated_by' => $user->id])->save();
            $this->svc->log($spi, 'packed', ['stage' => 3]);
        }

        return response()->json(['status' => true, 'data' => $spi->refresh()], 200);
    }

    private function storeAttachments(Request $request, SupplierInvoice $spi): array
    {
        $dir  = "p2p/spi/{$spi->id}";
        $data = [];

        $disk = config('filesystems.documents') ?: config('filesystems.default', 'public');

        foreach (['invoice' => 'invoice_file', 'eway' => 'eway_file'] as $kind => $field) {
            $f = $request->file($field);
            if (!$f) continue;

            if (!$f->isValid()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "The {$kind} file did not upload completely ({$f->getErrorMessage()}). Try again.",
                ], 422));
            }

            $path = $f->store($dir, $disk);

            if (!$path) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "The {$kind} file could not be saved to storage. Check the '{$disk}' disk.",
                ], 500));
            }

            $data["{$kind}_file_path"] = $path;
            $data["{$kind}_file_name"] = $f->getClientOriginalName();
        }

        return $data;
    }

    private function guardSupplierSegments(SupplierInvoice $spi, array $items, int $clientId): void
    {
        $vendorId = (int) $spi->vendor_id;
        if (!$vendorId) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Pick the supplier in Stage 01 before adding products.',
            ], 422));
        }

        $segments = DB::table('vendor_segments')->where('vendor_id', $vendorId)
            ->pluck('segment_id')->map(fn ($v) => (int) $v)->all();
        if (!$segments && ($legacy = DB::table('vendors')->where('id', $vendorId)->value('segment_id'))) {
            $segments = [(int) $legacy];
        }
        $mapped = $this->poSvc->vendorProductIds($vendorId);

        $products = DB::table('products as p')
            ->leftJoin('clm_segments as sg', 'sg.id', '=', 'p.segment_id')
            ->where('p.client_id', $clientId)
            ->whereNull('p.deleted_at')
            ->whereIn('p.id', collect($items)->pluck('product_id')->map(fn ($v) => (int) $v)->all())
            ->get(['p.id', 'p.name', 'p.segment_id', 'sg.name as segment_name'])
            ->keyBy('id');

        $errors = [];
        foreach ($items as $i => $line) {
            $pid  = (int) ($line['product_id'] ?? 0);
            $prod = $products->get($pid);
            if (!$prod) {
                $errors["items.$i.product_id"] = ['Product not found.'];
            } elseif (!in_array((int) $prod->segment_id, $segments, true) && !in_array($pid, $mapped, true)) {
                $seg = $prod->segment_name ?: 'no segment';
                $errors["items.$i.product_id"] = ["Segment mismatch — {$prod->name} is in {$seg}, and neither that segment nor the product is mapped to this supplier. Remove it, or map one of them in the Supplier master."];
            }
        }

        if ($errors) {
            abort(response()->json([
                'status'  => false,
                'message' => reset($errors)[0],
                'errors'  => $errors,
            ], 422));
        }
    }

    private function priceLines(array $items, bool $international, ?int $poId = null, ?int $spiId = null): array
    {
        $poLines = DB::table('p2p_purchase_order_items')
            ->whereIn('id', collect($items)->pluck('po_item_id')->filter())
            ->get()->keyBy('id');

        $open = $poId ? $this->svc->openQtyByPoItem($poId, $spiId) : [];

        $products = DB::table('products as p')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->whereIn('p.id', collect($items)->pluck('product_id'))
            ->get(['p.id', 'p.name', 'p.product_code', 'p.description', 'p.gst_amount',
                'h.hsn_code', DB::raw('COALESCE(u.short_code, u.title) AS uom')])
            ->keyBy('id');

        $piQty = DB::table('proforma_invoice_items')
            ->whereIn('id', collect($items)->pluck('pi_item_id')->filter())
            ->pluck('quantity', 'id');

        return collect($items)->map(function ($r) use ($international, $poLines, $products, $open, $piQty) {
            $po   = ($r['po_item_id'] ?? null) ? ($poLines[$r['po_item_id']] ?? null) : null;
            $prod = $products[$r['product_id']] ?? null;

            $extra = $po && array_key_exists($r['po_item_id'], $open)
                ? $this->svc->splitBalance((float) $open[$r['po_item_id']] - (float) $r['qty_spi'])['over']
                : (float) ($r['extra_qty'] ?? 0);

            return [
                'id'          => $r['id'] ?? null,
                'po_item_id'  => $r['po_item_id'] ?? null,
                'pi_item_id'  => $po->pi_item_id ?? ($r['pi_item_id'] ?? null),
                'product_id'  => $r['product_id'],
                'product_name' => $prod->name ?? null,
                'product_code' => $prod->product_code ?? null,
                'description' => $po->description ?? $prod->description ?? $prod->name ?? null,
                'hsn_code'    => $prod->hsn_code ?? null,
                'uom'         => $prod->uom ?? null,
                'qty_po'      => $po ? (float) $po->quantity : null,
                'qty_pi'      => isset($r['pi_item_id']) ? ($piQty[$r['pi_item_id']] ?? null) : null,

                'qty_spi'   => (float) $r['qty_spi'],
                'rate'      => (float) $r['rate'],
                'extra_qty' => $extra,

                'taxable_amount' => (float) $r['taxable_amount'],
                'gst_pct'        => $international ? null : ($r['gst_pct'] ?? null),
                'cgst_amount'    => $international ? null : ($r['cgst_amount'] ?? null),
                'sgst_amount'    => $international ? null : ($r['sgst_amount'] ?? null),
                'igst_amount'    => $international ? null : ($r['igst_amount'] ?? null),
                'line_total'     => (float) $r['line_total'],
            ];
        })->all();
    }

    private function overBillWarnings(SupplierInvoice $spi, array $rows): array
    {
        $out = [];

        if ($spi->isStandalone()) {
            $piIds = collect($rows)->pluck('pi_item_id')->filter()->unique()->all();
            if (!$piIds) return [];

            $lines   = DB::table('proforma_invoice_items')->whereIn('id', $piIds)->pluck('quantity', 'id');
            $claimed = $this->poSvc->orderedByPiItem((int) $spi->client_id, $piIds, null, $spi->id);

            foreach ($rows as $r) {
                if (empty($r['pi_item_id'])) continue;
                $left = round((float) ($lines[$r['pi_item_id']] ?? 0) - (float) ($claimed[$r['pi_item_id']] ?? 0), 3);
                $over = round((float) $r['qty_spi'] - $left, 3);
                if ($over > 0.001) {
                    $out[] = $r['description']
                        . ': billed ' . number_format((float) $r['qty_spi'], 3)
                        . ' against ' . number_format(max($left, 0), 3) . ' left on the proforma invoice — '
                        . number_format($over, 3) . ' over.';
                }
            }

            return $out;
        }

        $open = $this->svc->openQtyByPoItem((int) $spi->purchase_order_id, $spi->id);

        foreach ($rows as $r) {
            if (empty($r['po_item_id'])) continue;
            $left = (float) ($open[$r['po_item_id']] ?? 0);
            $over = round((float) $r['qty_spi'] - $left, 3);
            if ($over > 0.001) {
                $out[] = $r['description']
                    . ': billed ' . number_format((float) $r['qty_spi'], 3)
                    . ' against ' . number_format($left, 3) . ' open on the order — '
                    . number_format($over, 3) . ' over.';
            }
        }

        return $out;
    }

    private function requestPeople(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if (!$ids) return [];

        return DB::table('users as u')
            ->leftJoin('employees as e', fn ($j) => $j->on('e.user_id', '=', 'u.id')->whereNull('e.deleted_at'))
            ->leftJoin('master_departments as d', 'd.id', '=', 'e.department_id')
            ->leftJoin('master_designations as g', 'g.id', '=', 'e.designation_id')
            ->whereIn('u.id', $ids)
            ->get(['u.id', 'u.name', 'd.name as department', DB::raw('COALESCE(g.name, u.designation) as designation')])
            ->mapWithKeys(fn ($u) => [$u->id => [
                'name' => $u->name,
                'role' => implode(' · ', array_filter([$u->department, $u->designation])) ?: null,
            ]])
            ->all();
    }
}
