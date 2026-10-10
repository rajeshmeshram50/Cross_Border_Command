<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PoPaymentRequest;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\SpiPoFulfilment;
use App\Models\P2p\SupplierInvoice;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * P2P · Supplier Purchase Invoice — /api/p2p/spi
 *
 * Stage 01 creates a draft; Stage 02 saves the items. Boxes (Stage 03) and
 * put-away (Stage 04) have their own controllers.
 *
 * Tenant scoping comes from the global BelongsToTenant scope (set by the
 * `tenant` middleware); client_id / branch_id / created_by are always taken
 * from the authenticated user, never from the request body.
 */
class SupplierInvoiceController extends Controller
{
    use RunsInTransaction;

    public function __construct(private SupplierInvoiceService $svc) {}

    private function ok($data, int $code = 200): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data], $code);
    }

    private function fail(string $message, int $code = 422, array $extra = []): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message] + $extra, $code);
    }

    /** Writes need a tenant: a super admin has no client to raise an invoice under. */
    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        if (!$user?->branch_id) abort(response()->json(['status' => false, 'message' => 'No branch context — the invoice number is allocated per branch'], 403));
        return $user;
    }

    private function findSpi(int $id): SupplierInvoice
    {
        return SupplierInvoice::findOrFail($id);
    }

    /* ══════════════════════════ LOOKUPS ══════════════════════════ */

    /** GET /p2p/spi/next-code — preview only; nothing is written until Stage 01 is saved. */
    public function nextCode(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);

        return $this->ok([
            'code'           => $this->svc->previewCode((int) $user->client_id, (int) $user->branch_id),
            'financial_year' => $this->svc->financialYear(),
        ]);
    }

    /**
     * GET /p2p/spi/orders/{po}/lines — PO lines to prefill Stage 02, each with
     * what is still uninvoiced so the same line is not billed twice.
     */
    public function poLines(Request $request, int $po): JsonResponse
    {
        $this->tenantUser($request);
        $order = PurchaseOrder::findOrFail($po);
        $open  = $this->svc->openQtyByPoItem($po, $request->integer('exclude_spi') ?: null);

        // p2p_purchase_order_items has no deleted_at — it is hard-deleted.
        $lines = DB::table('p2p_purchase_order_items')
            ->where('purchase_order_id', $po)
            ->orderBy('line_no')
            ->get()
            ->map(fn($l) => [
                'po_item_id'   => $l->id,
                'pi_item_id'   => $l->pi_item_id,
                'product_id'   => $l->product_id,
                'description'  => $l->description,
                'qty_po'       => (float) $l->quantity,
                'qty_open'     => (float) ($open[$l->id] ?? 0),
                'rate'         => (float) $l->rate,
                'gst_pct'      => $l->gst_pct === null ? null : (float) $l->gst_pct,
            ]);

        return $this->ok([
            'purchase_order_id' => $order->id,
            'document_type'     => $order->document_type,
            'currency_code'     => $order->currency_code,
            'vendor_id'         => $order->vendor_id,
            'lines'             => $lines,
        ]);
    }

    /* ══════════════════════════ LIST AND DETAIL ══════════════════════════ */

    /** GET /p2p/spi — the list, filtered by the four flavours. */
    public function index(Request $request): JsonResponse
    {
        $this->tenantUser($request);

        /* A mistyped filter used to be ignored in silence — ?po_mode=withpo
           returned every row rather than an error, which reads as a bug in the
           tab rather than a typo in the URL. */
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

        /* Every column is table-qualified: the search joins out to the purchase
           order, and `po` carries its own status, vendor_id and code — unqualified
           names would be an ambiguous reference, which Postgres refuses. */
        $t = 'p2p_supplier_invoices';

        /* The screen-wide filters go on a bare query first. The counts run off
           a clone of THAT: cloning the list query instead drags its withCount
           subqueries and its `table.*` into the aggregate, which Postgres
           rejects for not being in a GROUP BY. */
        $base = SupplierInvoice::query();

        if (!empty($f['status']))    $base->where("$t.status", $f['status']);
        if (!empty($f['vendor_id'])) $base->where("$t.vendor_id", $f['vendor_id']);
        if (!empty($f['from']))      $base->whereDate("$t.invoice_date", '>=', $f['from']);
        if (!empty($f['to']))        $base->whereDate("$t.invoice_date", '<=', $f['to']);

        /* Counted BEFORE the tab and the search narrow the list: typing in the
           search box must not make "All SPI's 60" fall to 3. */
        $tabs = $this->tabCounts(clone $base, $f['po_mode'] ?? null);

        $q = $base->with([
            'vendor:id,vendor_code,company_name,legal_name,risk_level_id,supplier_category',
            // po_date was read by listRow but never selected, so the PO DATE
            // column came back blank on every row.
            'purchaseOrder:id,code,po_date,po_type,shipment_order_id,lead_id,proforma_invoice_id,'
                . 'procurement_request_code,physical_inspection,inspection_status,zoho_status,'
                . 'expected_delivery_date,grand_total,tds_amount,paid_amount,balance_amount',
            'warehouse:id,wh_id,wh_name,wh_type',
        ])
            /* The row's Payment Requests button shows a count and a ready-to-pay
               note. Subqueries, so a page of 10 rows costs two extra queries
               rather than twenty. */
            ->withCount(['paymentRequests as pending_payment_requests' =>
                fn ($r) => $r->where('status', PoPaymentRequest::STATUS_PENDING)])
            // The constants, not literals: the column stores them lowercase and
            // 'Approved' silently matched nothing.
            ->withSum(['paymentRequests as approved_unpaid_amount' =>
                fn ($r) => $r->where('status', PoPaymentRequest::STATUS_APPROVED)],
                DB::raw('GREATEST(approved_amount - paid_amount, 0)'));

        $this->applyPoMode($q, $f['po_mode'] ?? null);
        $this->applyShipmentMode($q, $f['shipment_mode'] ?? null);

        if ($term = trim((string) ($f['q'] ?? ''))) {
            $this->applySearch($q, $term);
        }

        $page = $q->orderByDesc("$t.id")->paginate((int) ($f['per_page'] ?? 10));
        $rows = collect($page->items());
        // Shipment and opportunity codes for the whole page in two queries.
        $refs = $this->linkRefs($rows);

        return response()->json([
            'status' => true,
            'data'   => $rows->map(fn ($s) => $this->listRow($s, $refs))->all(),
            'tabs'   => $tabs,
            'meta'   => [
                'page'      => $page->currentPage(),
                'per_page'  => $page->perPage(),
                'total'     => $page->total(),
                // useServerList, shared with the PO list, needs this to know
                // whether there is a next page.
                'last_page' => $page->lastPage(),
            ],
        ]);
    }

    /** GET /p2p/spi/{id} — one invoice with its items and the packing summary. */
    public function show(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        /* Every stage in one call — the detail screen renders all four, and
           three round trips to paint one page is three chances to show a
           half-loaded invoice. */
        $spi->load([
            'items',
            'vendor:id,vendor_code,company_name',
            'warehouse:id,wh_id,wh_name,wh_type',
            'purchaseOrder:id,code,po_date,po_type,shipment_order_id,lead_id,procurement_request_code,'
                . 'expected_delivery_date,grand_total,tds_amount,paid_amount,balance_amount',
            'purchaseOrder.shipmentOrder:id,shipment_code',
            'boxes.items',
            'boxes.attachments',
            'putaways.box:id,box_code',
        ]);

        $full    = $this->isOwnWarehouse($spi->warehouse_id);
        $packing = $this->svc->packingSummary($spi->id);

        return $this->ok([
            'invoice'        => $spi,
            'owns_zoho_bill' => $spi->ownsZohoBill(),

            // Stage 02 — ordered against billed.
            'match' => $this->matchSummary($spi),

            // Stage 03 — packed against pending, per line and in total.
            'packing_summary' => $packing,
            'packing_totals'  => $this->svc->packingTotals($packing) + ['boxes' => $spi->boxes->count()],

            // Stage 04 — where each box is, and what it still owes.
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
        ]);
    }

    /* ══════════════════════════ STAGE 01 ══════════════════════════ */

    /** POST /p2p/spi — the first write of the whole flow. Opening the form writes nothing. */
    public function store(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $data = $this->validateHeader($request, $user, null);

        $spi = $this->inTransaction('create the invoice', function () use ($user, $data) {
            $spi = SupplierInvoice::create($data + [
                'code'            => $this->svc->nextCode((int) $user->client_id, (int) $user->branch_id),
                'stage_completed' => 1,
                'status'          => SupplierInvoice::STATUS_DRAFT,
                'created_by'      => $user->id,
            ]);

            $this->svc->log($spi, 'created', ['new_value' => $spi->code]);

            return $spi;
        });

        return $this->ok($spi, 201);
    }

    /** PUT /p2p/spi/{id}/stage-1 — editable while the invoice is still a draft. */
    public function updateStage1(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        if (!$spi->isEditable()) return $this->fail("{$spi->code} is {$spi->status} and can no longer be edited.");

        $data = $this->validateHeader($request, $user, $spi);

        // Re-pointing at a different PO after items exist would orphan the match.
        if (
            array_key_exists('purchase_order_id', $data)
            && (int) $data['purchase_order_id'] !== (int) $spi->purchase_order_id
            && $spi->items()->exists()
        ) {
            return $this->fail(
                "Items are already mapped to this invoice — clear Stage 02 before changing the purchase order.",
                422,
                ['errors' => ['purchase_order_id' => ['Cannot be changed while items exist.']]]
            );
        }

        $spi = $this->inTransaction('update the invoice', function () use ($spi, $data, $user) {
            $spi->forceFill($data + ['updated_by' => $user->id])->save();
            $this->svc->log($spi, 'stage1_saved');

            return $spi->refresh();
        });

        return $this->ok($spi);
    }

    /* ══════════════════════════ STAGE 02 ══════════════════════════ */

    /**
     * PUT /p2p/spi/{id}/items — the whole grid saves at once.
     *
     * Never row by row: the header totals are rolled up from the lines in the
     * same transaction, so a partial save would leave the two disagreeing.
     */
    public function updateItems(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        if (!$spi->isEditable()) return $this->fail("{$spi->code} is {$spi->status} and can no longer be edited.");

        // The supplier's invoice number, date and e-way details are part of
        // this screen, not Stage 01 — so they save with the grid.
        $header = $this->validateInvoiceDetails($request, $user, $spi);

        /* The grid does its own arithmetic and posts the result; the server
           stores it. Only description, qty_po and pi_item_id are filled in
           here, and those are snapshots of the order rather than calculations. */
        $data = $request->validate([
            'items'              => ['required', 'array', 'min:1'],
            'items.*.po_item_id' => ['nullable', 'integer'],
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

            // The TOTALS row, also computed by the grid.
            'taxable_total' => ['required', 'numeric', 'min:0'],
            'total_cgst'    => ['nullable', 'numeric', 'min:0'],
            'total_sgst'    => ['nullable', 'numeric', 'min:0'],
            'total_igst'    => ['nullable', 'numeric', 'min:0'],
            'grand_total'   => ['required', 'numeric', 'min:0'],

            /* The attachments ride along with the save, so Stage 02 is one
               request. Send the whole thing as multipart when there are files;
               plain JSON still works when there are none. */
            'invoice_file' => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:10240'],
            'eway_file'    => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:10240'],
        ], [
            'invoice_file.mimes' => 'The invoice must be a PDF or an image.',
            'invoice_file.max'   => 'The invoice may not be larger than 10 MB.',
            'eway_file.mimes'    => 'The e-way bill must be a PDF or an image.',
            'eway_file.max'      => 'The e-way bill may not be larger than 10 MB.',
        ]);

        // Stored before the transaction opens; RunsInTransaction removes them
        // again if the write fails, so a failed save leaves no orphan file.
        $files = $this->storeAttachments($request, $spi);

        // An international supplier charges no Indian GST: the four tax columns
        // stay NULL, which is a different fact from "charged at zero rate".
        $rows = $this->priceLines($data['items'], $spi->isInternational());

        // Over-supply is accepted, not refused — the goods arrived. It comes
        // back as a warning beside the saved invoice.
        $warnings = $this->overBillWarnings($spi, $rows);

        // The TOTALS row the grid calculated, stored as sent.
        $totals = [
            'taxable_total' => $data['taxable_total'],
            'total_cgst'    => $spi->isInternational() ? 0 : ($data['total_cgst'] ?? 0),
            'total_sgst'    => $spi->isInternational() ? 0 : ($data['total_sgst'] ?? 0),
            'total_igst'    => $spi->isInternational() ? 0 : ($data['total_igst'] ?? 0),
            'grand_total'   => $data['grand_total'],
        ];

        $spi = $this->inTransaction('save the invoice items', function () use ($spi, $rows, $header, $totals, $files, $user) {
            $spi->forceFill($header + $totals + $files + [
                'stage_completed' => max(2, (int) $spi->stage_completed),
                'updated_by'      => $user->id,
            ])->save();

            foreach (['invoice' => 'invoice_uploaded', 'eway' => 'eway_uploaded'] as $kind => $event) {
                if (isset($files["{$kind}_file_name"])) {
                    $this->svc->log($spi, $event, ['new_value' => $files["{$kind}_file_name"], 'stage' => 2]);
                }
            }

            // rollUp: false — the grid owns the arithmetic, so recomputing here
            // would overwrite the figures the user actually saw with our own.
            return $this->svc->saveItems($spi, $rows, false);
        }, array_values(array_filter($files, fn($k) => str_ends_with($k, '_path'), ARRAY_FILTER_USE_KEY)));

        /* No packing summary here: nothing is packed at Stage 02, so it would
           be a row of zeros. What this stage owns is the MATCH — what the PO
           ordered against what the supplier billed. The packing figures belong
           to Stage 03 and have their own endpoint. */
        $spi->load('items');

        return $this->ok([
            'invoice'  => $spi,
            'match'    => $this->matchSummary($spi),
            'warnings' => $warnings,
        ]);
    }

    /* ══════════════════════════ CLOSE ══════════════════════════ */

    /** PUT /p2p/spi/{id}/submit — refuses while quantity is still unpacked. */
    public function submit(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        if (!$spi->items()->exists()) return $this->fail('Add at least one item before submitting.');

        $pending = collect($this->svc->packingSummary($spi->id))->firstWhere('qty_pending', '>', 0);
        if ($pending) {
            return $this->fail(
                number_format($pending['qty_pending'], 3) . ' is still unpacked. Goods not in a box have no box code, '
                    . 'so they cannot be scanned, racked or inspected.'
            );
        }

        $note = $request->input('note');

        $spi = $this->inTransaction('submit the invoice', function () use ($spi, $note) {
            $spi->forceFill([
                'status'          => SupplierInvoice::STATUS_MAPPED,
                'stage_completed' => 4,
            ])->save();

            $this->svc->log($spi, 'submitted', ['note' => $note]);

            return $spi->refresh();
        });

        return $this->ok($spi);
    }

    /** DELETE /p2p/spi/{id} — soft delete, refused once goods have moved on. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        if ($spi->status === SupplierInvoice::STATUS_CLOSED) {
            return $this->fail("{$spi->code} is closed — a received invoice cannot be deleted.");
        }

        $this->inTransaction('delete the invoice', function () use ($spi) {
            // Every line gives its quantity back to the PO before the invoice goes.
            foreach ($spi->items as $item) {
                $this->svc->syncFulfilment($item, SpiPoFulfilment::EVENT_CANCELLED, (float) $item->qty_spi);
            }

            $this->svc->log($spi, 'cancelled');
            $spi->items()->delete();
            $spi->delete();
        });

        return $this->ok(['id' => $id, 'deleted' => true]);
    }

    /**
     * GET /p2p/spi/{id}/payment-requests — the Payment Requests History popup.
     *
     * Two summaries sit on that screen and they measure different things:
     *
     *   invoice  what THIS invoice claims — base, GST, grand total
     *   requests what has been requested, approved and paid against it
     *
     * The ceiling and the balance still belong to the PURCHASE ORDER; an SPI
     * amount is the supplier's claim, not a ledger. So `po` is returned
     * alongside, and that is the figure a new request is validated against.
     */
    public function paymentRequests(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);
        $po  = $spi->purchaseOrder;

        $rows = PoPaymentRequest::where('supplier_invoice_id', $spi->id)
            ->orderBy('id')->get();

        $approved = $rows->where('status', 'Approved');
        $paid     = round((float) $rows->sum('paid_amount'), 2);
        $gst      = round((float) $spi->total_cgst + (float) $spi->total_sgst + (float) $spi->total_igst, 2);

        return $this->ok([
            'spi' => [
                'id' => $spi->id,
                'code' => $spi->code,
                'base_amount'  => (float) $spi->taxable_total,   // without GST
                'gst_amount'   => $gst,
                'grand_total'  => (float) $spi->grand_total,     // with GST
                'paid_amount'  => $paid,
                'balance'      => round((float) $spi->grand_total - $paid, 2),
            ],

            'requests_summary' => [
                'total'            => $rows->count(),
                'requested_amount' => round((float) $rows->sum('requested_amount'), 2),
                'awaiting'         => round((float) $rows->where('status', 'Pending')->sum('requested_amount'), 2),
                'approved_amount'  => round((float) $approved->sum('approved_amount'), 2),
                'paid_amount'      => $paid,
                // Approved but not yet released — what the Make Payment button owes.
                'ready_to_pay'     => round((float) $approved->sum(fn($r) => max(0, (float) $r->approved_amount - (float) $r->paid_amount)), 2),
            ],

            /* The real ceiling. A request against this invoice is still checked
               against the PO's balance, not the invoice's. */
            'po' => $po ? [
                'id' => $po->id,
                'code' => $po->code,
                'grand_total'    => (float) $po->grand_total,
                'tds_amount'     => (float) $po->tds_amount,
                'net_payable'    => round((float) $po->grand_total - (float) $po->tds_amount, 2),
                'paid_amount'    => (float) $po->paid_amount,
                'balance_amount' => (float) $po->balance_amount,
            ] : null,

            'requests' => $rows->map(fn($r) => [
                'id' => $r->id,
                'code' => $r->code,
                'payment_type'     => $r->payment_type,
                'percentage'       => $r->percentage !== null ? (float) $r->percentage : null,
                'requested_amount' => (float) $r->requested_amount,
                'requested_to'     => $r->requested_to,
                'requested_at'     => $r->requested_at,
                'status'           => $r->status,
                'approved_amount'  => $r->approved_amount !== null ? (float) $r->approved_amount : null,
                'paid_amount'      => (float) $r->paid_amount,
                'due'              => $r->approved_amount !== null
                    ? max(0, round((float) $r->approved_amount - (float) $r->paid_amount, 2))
                    : null,
            ])->values(),
        ]);
    }

    /* ══════════════════════════ ZOHO ══════════════════════════ */

    /** POST /p2p/spi/{id}/zoho-sync — only a standalone invoice creates its own bill. */
    public function zohoSync(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        if (!$spi->ownsZohoBill()) {
            $po = $spi->purchaseOrder;

            return $this->fail("This invoice is against {$po?->code} — its Zoho bill belongs to the purchase order.");
        }

        return $this->fail('Zoho sync for standalone invoices is not wired up yet.', 501);
    }

    /** GET /p2p/spi/{id}/zoho-tracker — says WHY there is no bill, rather than showing an empty state. */
    public function zohoTracker(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        if (!$spi->ownsZohoBill()) {
            $po = $spi->purchaseOrder;

            return $this->ok([
                'owns_bill'  => false,
                'bill_owner' => [
                    'type' => 'purchase_order',
                    'id' => $po?->id,
                    'code' => $po?->code,
                    'zoho_bill_id' => $po?->zoho_bill_id,
                    'zoho_bill_number' => $po?->zoho_bill_number,
                ],
                'can_retry' => false,
            ]);
        }

        return $this->ok([
            'owns_bill'        => true,
            'zoho_bill_id'     => $spi->zoho_bill_id,
            'zoho_bill_number' => $spi->zoho_bill_number,
            'zoho_status'      => $spi->zoho_status,
            'zoho_synced_at'   => $spi->zoho_synced_at,
            'zoho_error'       => $spi->zoho_error,
            'can_retry'        => $spi->zoho_status === 'failed',
        ]);
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /**
     * One row of the list, flat.
     *
     * The PO-side chips (PO number, type, shipment, opportunity, procurement)
     * and every money column are read THROUGH the purchase order — they are
     * deliberately not copied onto the invoice. A Direct SPI has no PO, so all
     * of them come back null and the UI shows a dash.
     */
    private function listRow(SupplierInvoice $s, array $refs = ['ship' => [], 'opp' => []]): array
    {
        $po   = $s->purchaseOrder;
        $ship = $po?->shipment_order_id   ? ($refs['ship'][$po->shipment_order_id] ?? null) : null;
        $opp  = $po?->proforma_invoice_id ? ($refs['opp'][$po->proforma_invoice_id] ?? null) : null;
        $day  = fn ($d) => $d ? substr((string) $d, 0, 10) : null;

        return [
            'id'          => $s->id,
            'spi_number'  => $s->code,
            // A draft has no supplier invoice date until Stage 02, so the
            // column would read blank for the whole of Stage 01.
            'spi_date'    => $day($s->invoice_date ?: $s->created_at),
            'invoice_no'  => $s->invoice_no,

            'is_direct'   => $s->isStandalone(),
            'po_number'   => $po?->code,
            'po_date'     => $day($po?->po_date),
            'po_type'     => $po?->po_type,
            'document_type'       => $s->document_type,
            // Drives the Physical Inspection badge under the PO number.
            'physical_inspection' => $po?->physical_inspection,
            'inspection_status'   => $po?->physical_inspection === 'yes'
                ? ($po->inspection_status ?: 'pending')
                : 'not_applicable',

            // Real references, not raw ids: the opportunity code lives on the
            // proforma invoice, and the row used to print lead_id (a number).
            'shipment_id'      => $ship->shipment_code ?? null,
            'shipment_date'    => $day($ship->created_at ?? null),
            'opportunity_id'   => $opp->opp_code ?? null,
            'opportunity_date' => $day($opp->created_at ?? null),
            'procurement_id'   => $po?->procurement_request_code,

            'supplier'    => [
                'id'            => $s->vendor?->id,
                'code'          => $s->vendor?->vendor_code,
                // Legal name first, as the PO list does — that is the name on
                // the paperwork; the trading name is the fallback.
                'name'          => $s->vendor?->legal_name ?: $s->vendor?->company_name,
                'risk_level_id' => $s->vendor?->risk_level_id,
                'category'      => $s->vendor?->supplier_category,
            ],

            'expected_delivery_date' => $day($po?->expected_delivery_date),

            /* A Direct SPI owns its own Zoho bill; one against a PO is billed
               through that order, so it shows the order's state. */
            'zoho_status' => $s->isStandalone() ? $s->zoho_status : $po?->zoho_status,

            // From the subqueries on the list, so the Payment Requests button
            // has its count and its ready-to-pay note without a call per row.
            'pending_payment_requests' => (int) ($s->pending_payment_requests ?? 0),
            'approved_unpaid_amount'   => round((float) ($s->approved_unpaid_amount ?? 0), 2),

            // Money lives on the PO: an SPI amount is the supplier's claim, it
            // is not what the balance is measured against.
            'total_po_amount'    => $po ? (float) $po->grand_total : null,
            'net_payable_amount' => $po ? round((float) $po->grand_total - (float) $po->tds_amount, 2) : null,
            'total_paid_amount'  => $po ? (float) $po->paid_amount : null,
            'balance_amount'     => $po ? (float) $po->balance_amount : null,
            'total_spi_amount'   => (float) $s->grand_total,

            'warehouse'   => $s->warehouse ? [
                'id'      => $s->warehouse->id,
                'code'    => $s->warehouse->wh_id,
                'name'    => $s->warehouse->wh_name,
                // Drives the OWN / 3PL badge. Read from the master, never stored.
                'is_own'  => $s->warehouse->wh_type === 'Own Warehouse',
            ] : null,

            'status'          => $s->status,
            'status_label'    => SupplierInvoice::STATUS_LABELS[$s->status] ?? $s->status,
            'stage_completed' => $s->stage_completed,
        ];
    }

    /**
     * The counts on the list's two rows of tabs. Four aggregates in one query
     * rather than four round trips — the global tenant scope still applies.
     */
    /** The top tab: with a purchase order, or a Direct SPI that has none. */
    private function applyPoMode($q, ?string $mode): void
    {
        if ($mode === 'with_po')    $q->whereNotNull('p2p_supplier_invoices.purchase_order_id');
        if ($mode === 'without_po') $q->whereNull('p2p_supplier_invoices.purchase_order_id');
    }

    /**
     * The sub-tab. The shipment hangs off the PO, so this has to reach through
     * it — and a Direct SPI has no PO at all.
     *
     * whereHas(PO where shipment IS NULL) dropped every Direct SPI from BOTH
     * sub-tabs, because the relation itself was absent. whereDoesntHave(PO
     * WITH a shipment) is the correct complement: no PO also means no shipment.
     */
    private function applyShipmentMode($q, ?string $mode): void
    {
        if ($mode === 'with_shipment') {
            $q->whereHas('purchaseOrder', fn ($p) => $p->whereNotNull('shipment_order_id'));
        }
        if ($mode === 'without_shipment') {
            $q->whereDoesntHave('purchaseOrder', fn ($p) => $p->whereNotNull('shipment_order_id'));
        }
    }

    /**
     * Shipment and opportunity references for a whole page, in two queries.
     *
     * The opportunity code lives on the proforma invoice, not on the lead — the
     * row used to print the raw lead_id (a number like 7) where the screen
     * wants OPP-0004. Same logic the PO list uses, so both read alike.
     *
     * @return array{ship: array<int,object>, opp: array<int,object>}
     */
    private function linkRefs($rows): array
    {
        $pos = collect($rows)->map(fn ($s) => $s->purchaseOrder)->filter();

        $ship = DB::table('shipment_orders')
            ->whereIn('id', $pos->pluck('shipment_order_id')->filter()->unique()->all() ?: [0])
            ->get(['id', 'shipment_code', 'created_at'])->keyBy('id');

        $opp = DB::table('proforma_invoices')
            ->whereIn('id', $pos->pluck('proforma_invoice_id')->filter()->unique()->all() ?: [0])
            ->get(['id', 'opp_code', 'created_at'])->keyBy('id');

        return ['ship' => $ship, 'opp' => $opp];
    }

    /**
     * The tab numbers.
     *
     * Counted from the query as it stands BEFORE the tab and the search are
     * applied, so the numbers hold still while you type — but after status,
     * supplier and date, which the whole screen is filtered by.
     *
     * The sub-tab counts are taken WITHIN the selected top tab, because the
     * screen nests them under it. With the Direct-SPI fix in
     * applyShipmentMode(), the two sub-tabs now add up to their parent.
     */
    private function tabCounts($base, ?string $poMode = null): array
    {
        // One pass for the top row of tabs.
        $r = (clone $base)->selectRaw(
            'COUNT(*) AS all_spi,
             COUNT(p2p_supplier_invoices.purchase_order_id) AS with_po,
             COUNT(*) FILTER (WHERE p2p_supplier_invoices.purchase_order_id IS NULL) AS direct_spi,
             COUNT(DISTINCT p2p_supplier_invoices.purchase_order_id) AS distinct_po'
        )->reorder()->first();

        /* The sub-tabs sit UNDER the selected top tab, so they are counted
           within it — before, they always counted every SPI and the two never
           added up to their parent. */
        $scoped = clone $base;
        $this->applyPoMode($scoped, $poMode);
        $scopedTotal = (clone $scoped)->count();

        $withShipment = (clone $scoped)
            ->whereHas('purchaseOrder', fn ($p) => $p->whereNotNull('shipment_order_id'))
            ->count();

        return [
            // Two names for one figure: `all_spi` reads alongside the other
            // tabs, `total_spi` is what the header chip calls it.
            'all_spi'          => (int) $r->all_spi,
            'total_spi'        => (int) $r->all_spi,
            'with_po'          => (int) $r->with_po,
            // Likewise — the tab reads "Without Purchase Order SPI (Direct SPI)".
            'direct_spi'       => (int) $r->direct_spi,
            'without_po'       => (int) $r->direct_spi,
            // How many ORDERS are represented, not how many invoices: several
            // SPIs can sit under one PO.
            'distinct_po'      => (int) $r->distinct_po,
            // Within the selected top tab, so the two add up to it.
            'with_shipment'    => $withShipment,
            'without_shipment' => $scopedTotal - $withShipment,
        ];
    }

    /**
     * The list's one search box: "Search SPI, supplier, PO or status…".
     *
     * Every chip on the row is searchable, which is why this joins out to the
     * purchase order and from there to the shipment, opportunity and supplier —
     * those columns are deliberately NOT copied onto the invoice, so the search
     * has to reach them. All joins are LEFT, because a standalone invoice has
     * no PO and must still match on its own code or supplier.
     *
     * One query with an OR group rather than several whereHas subqueries: a
     * subquery per column would run the list once per searchable field.
     */
    private function applySearch($q, string $term): void
    {
        $like = '%' . $term . '%';

        $q->leftJoin('p2p_purchase_orders as po', 'po.id', '=', 'p2p_supplier_invoices.purchase_order_id')
            ->leftJoin('vendors as v', 'v.id', '=', 'p2p_supplier_invoices.vendor_id')
            ->leftJoin('shipment_orders as sh', 'sh.id', '=', 'po.shipment_order_id')
            ->leftJoin('leads as ld', 'ld.id', '=', 'po.lead_id')
            ->select('p2p_supplier_invoices.*')
            ->where(function ($w) use ($like, $term) {
                $w->where('p2p_supplier_invoices.code', 'ilike', $like)                 // SPI/2026-27/001
                    ->orWhere('p2p_supplier_invoices.invoice_no', 'ilike', $like)       // the supplier's own number
                    ->orWhere('p2p_supplier_invoices.status', 'ilike', $like)
                    ->orWhere('p2p_supplier_invoices.document_type', 'ilike', $like)    // domestic / international
                    ->orWhere('po.code', 'ilike', $like)                                // PO/2026-27/016
                    ->orWhere('po.po_type', 'ilike', $like)                             // material_goods …
                    ->orWhere('po.procurement_request_code', 'ilike', $like)            // PROC-001
                    ->orWhere('sh.shipment_code', 'ilike', $like)                       // SHP-001
                    ->orWhere('ld.opp_code', 'ilike', $like)                            // OPP-001
                    ->orWhere('v.company_name', 'ilike', $like)
                    ->orWhere('v.vendor_code', 'ilike', $like);

                /* The prototype lets you search the WORDS "direct spi without
                   po" to pull up every standalone invoice — there is no column
                   holding that phrase, so it is matched here instead. */
                if (str_contains('direct spi without po', strtolower($term))) {
                    $w->orWhereNull('p2p_supplier_invoices.purchase_order_id');
                }
            });
    }

    /**
     * Stage 01 asks only who the invoice is from and, if any, which order it is
     * against. The supplier's own invoice number, date and attachments belong
     * to Stage 02 — so the draft (and its id) exist from the first save, and
     * the frontend never has to hold a half-filled form in memory.
     */
    private function validateHeader(Request $request, $user, ?SupplierInvoice $spi): array
    {
        return $request->validate([
            // Nullable: the prototype offers "Without Purchase Order", where
            // the supplier is picked directly instead of inherited.
            'purchase_order_id' => ['nullable', 'integer'],
            'vendor_id'         => ['required', 'integer'],
            // Decides whether the tax section renders at all, so it is asked
            // up front rather than discovered at Stage 02.
            'document_type'     => ['required', Rule::in(SupplierInvoice::DOC_TYPES)],
            'warehouse_id'      => ['nullable', 'integer'],
        ]);
    }

    /**
     * The Stage 02 header — the supplier's own invoice, saved alongside the
     * item grid because they are one screen and one decision.
     */
    private function validateInvoiceDetails(Request $request, $user, SupplierInvoice $spi): array
    {
        return $request->validate([
            'invoice_no' => [
                'required',
                'string',
                'max:60',
                Rule::unique('p2p_supplier_invoices', 'invoice_no')
                    ->where(fn($q) => $q->where('client_id', $user->client_id)->where('vendor_id', $spi->vendor_id))
                    ->ignore($spi->id),
            ],
            'invoice_date'  => ['required', 'date', 'before_or_equal:today'],
            'eway_no'       => ['nullable', 'string', 'max:40'],
            'currency_code' => ['nullable', 'string', 'size:3', 'required_if:document_type,international'],
            'exchange_rate' => ['nullable', 'numeric', 'gt:0'],
        ], [
            'invoice_no.unique' => 'This supplier has already billed that invoice number.',
        ]);
    }

    /**
     * Our own warehouse allocates rack and shelf; a third party is summary
     * only. Read from the master, never from a column here that could
     * contradict the warehouse it points at.
     */
    private function isOwnWarehouse(?int $warehouseId): bool
    {
        if (!$warehouseId) return true;

        return DB::table('master_warehouse_master')->where('id', $warehouseId)->value('wh_type') === 'Own Warehouse';
    }

    /**
     * The TOTALS row of the 3-way match grid: ordered against billed, and the
     * two sides of the gap. Every figure is a sum of columns already loaded —
     * no query, and nothing stored.
     */
    private function matchSummary(SupplierInvoice $spi): array
    {
        $items = $spi->items;

        return [
            'lines'       => $items->count(),
            'qty_po'      => round((float) $items->sum('qty_po'), 3),
            'qty_spi'     => round((float) $items->sum('qty_spi'), 3),
            // missing_qty is the accessor, extra_qty the column — only one of
            // the pair is ever non-zero on a given line.
            'missing_qty' => round((float) $items->sum('missing_qty'), 3),
            'extra_qty'   => round((float) $items->sum('extra_qty'), 3),
            'matched'     => $items->every(fn($i) => $i->missing_qty <= 0.001 && (float) $i->extra_qty <= 0.001),
        ];
    }

    /**
     * Move any attached invoice / e-way file onto the public disk and return
     * the four columns to write. Empty when the request carried no files —
     * Stage 02 is one call whether or not there are attachments.
     */
    private function storeAttachments(Request $request, SupplierInvoice $spi): array
    {
        $dir  = "p2p/spi/{$spi->id}";
        $data = [];

        if ($f = $request->file('invoice_file')) {
            $data['invoice_file_path'] = $f->store($dir, 'public');
            $data['invoice_file_name'] = $f->getClientOriginalName();
        }
        if ($f = $request->file('eway_file')) {
            $data['eway_file_path'] = $f->store($dir, 'public');
            $data['eway_file_name'] = $f->getClientOriginalName();
        }

        return $data;
    }

    /**
     * Take the grid's figures as posted and add the two things it cannot know:
     * the PO line's own quantity and description, snapshotted onto the invoice
     * line so a later PO revision cannot rewrite what was billed.
     *
     * The amounts are NOT recomputed here — the frontend owns that arithmetic
     * and this stores the result. The cost of that split is that the server
     * cannot tell a wrong total from a right one, so a crafted request is
     * accepted as sent.
     */
    private function priceLines(array $items, bool $international): array
    {
        $poLines = DB::table('p2p_purchase_order_items')
            ->whereIn('id', collect($items)->pluck('po_item_id')->filter())
            ->get()->keyBy('id');

        $products = DB::table('products as p')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->whereIn('p.id', collect($items)->pluck('product_id'))
            ->get(['p.id', 'p.name', 'p.description', 'p.gst_amount'])->keyBy('id');

        return collect($items)->map(function ($r) use ($international, $poLines, $products) {
            $po   = $r['po_item_id'] ? ($poLines[$r['po_item_id']] ?? null) : null;
            $prod = $products[$r['product_id']] ?? null;

            return [
                'po_item_id'  => $r['po_item_id'] ?? null,
                // Snapshots of the order, not calculations.
                'pi_item_id'  => $po->pi_item_id ?? null,
                'product_id'  => $r['product_id'],
                'description' => $po->description ?? $prod->description ?? $prod->name ?? null,
                'qty_po'      => $po ? (float) $po->quantity : null,

                'qty_spi'   => (float) $r['qty_spi'],
                'rate'      => (float) $r['rate'],
                'extra_qty' => (float) ($r['extra_qty'] ?? 0),

                'taxable_amount' => (float) $r['taxable_amount'],
                // NULL, not 0, on an international invoice: a foreign supplier
                // charges no Indian GST. "Does not apply" is not "zero rate".
                'gst_pct'        => $international ? null : ($r['gst_pct'] ?? null),
                'cgst_amount'    => $international ? null : ($r['cgst_amount'] ?? null),
                'sgst_amount'    => $international ? null : ($r['sgst_amount'] ?? null),
                'igst_amount'    => $international ? null : ($r['igst_amount'] ?? null),
                'line_total'     => (float) $r['line_total'],
            ];
        })->all();
    }

    /**
     * Billing past what the PO ordered WARNS, it does not block.
     *
     * A supplier really does ship 40 bags against an order for 36, and
     * refusing the invoice would mean refusing to record what arrived. The
     * excess is kept on the line as extra_qty and surfaced here so the
     * approver sees it — blocking would make that column unreachable.
     *
     * @return array<int,string> one message per over-billed line
     */
    private function overBillWarnings(SupplierInvoice $spi, array $rows): array
    {
        if ($spi->isStandalone()) return [];

        $open = $this->svc->openQtyByPoItem((int) $spi->purchase_order_id, $spi->id);
        $out  = [];

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
}
