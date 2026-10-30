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
    /* The PO service owns orderedByPiItem(), which is where PI quantity is
       counted for both documents. */
    public function __construct(
        private SupplierInvoiceService $svc,
        private PurchaseOrderService $poSvc,
    ) {}

    /** Writes need a tenant: a super admin has no client to raise an invoice under. */
    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        if (!$user?->branch_id) abort(response()->json(['status' => false, 'message' => 'No branch context — the invoice number is allocated per branch'], 403));
        return $user;
    }

    /**
     * The invoice, or a 404 that says so in words.
     *
     * findOrFail() throws ModelNotFoundException, which renders as "No query
     * results for model [App\Models\P2p\SupplierInvoice] 200" with the stack
     * trace attached — true, and no use to whoever is reading it. The id is
     * quoted back, so a wrong variable in a request is obvious at a glance.
     */
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

    /* ══════════════════════════ LOOKUPS ══════════════════════════ */

    /** GET /p2p/spi/next-code — preview only; nothing is written until Stage 01 is saved. */
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

    /**
     * GET /p2p/spi/orders/{po}/lines — PO lines to prefill Stage 02, each with
     * what is still uninvoiced so the same line is not billed twice.
     */
    public function poLines(Request $request, int $po)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $order = PurchaseOrder::findOrFail($po);
            $open  = $this->svc->openQtyByPoItem($po, $request->integer('exclude_spi') ?: null);

            // p2p_purchase_order_items has no deleted_at — it is hard-deleted.
            $lines = DB::table('p2p_purchase_order_items')
                ->where('purchase_order_id', $po)
                ->orderBy('line_no')
                ->get()
                ->map(function ($l) use ($open) {
                    $ordered = (float) $l->quantity;
                    // ordered - billed, which goes negative once a line is
                    // over-supplied. Split below so nothing downstream has to
                    // reason about a negative quantity.
                    $balance = (float) ($open[$l->id] ?? $ordered);
                    $billed  = round($ordered - $balance, 3);
                    // One method decides what a negative balance means.
                    $split   = $this->svc->splitBalance($balance);

                    return [
                        'po_item_id'  => $l->id,
                        'pi_item_id'  => $l->pi_item_id,
                        'product_id'  => $l->product_id,
                        'description' => $l->description,

                        // What the order asked for, once. Reference only — a
                        // second invoice that worked from this would re-claim
                        // quantity the first one already covered.
                        'qty_po'      => $ordered,
                        // What every OTHER invoice on this PO has taken.
                        'qty_billed'  => $billed,

                        /* What THIS invoice may still bill, and how far earlier
                           invoices already went past the order. qty_over is
                           deliberately not called extra_qty: that name is taken
                           by the invoice item, where it means what THAT invoice
                           billed over — an over-supply caused by SPI 2 is not
                           something SPI 3 did. Context for a tooltip, not a
                           column. */
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

    /* ══════════════════════════ LIST AND DETAIL ══════════════════════════ */

    /** GET /p2p/spi — the list, filtered by the four flavours. */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

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
            /* The same expression the row prints as spi_date. Filtering on
               invoice_date alone hid every Stage 01 draft, which has none yet:
               the row showed 29 Oct and a range covering 29 Oct could not find
               it. Cast to date so the `to` bound includes that whole day. */
            $spiDate = "COALESCE($t.invoice_date, $t.created_at)::date";
            if (!empty($f['from']))      $base->whereRaw("$spiDate >= ?", [$f['from']]);
            if (!empty($f['to']))        $base->whereRaw("$spiDate <= ?", [$f['to']]);

            /* The search goes on the base, so the tab numbers and the rows under
               them agree: a tab reading 60 over a list of 3 is the tab lying.
               Still applied BEFORE the tab itself — each tab has to show its own
               figure, not the selected one's.

               It must also run before withCount below: applySearch ends in
               ->select('p2p_supplier_invoices.*'), and select() REPLACES the
               column list rather than adding to it. */
            if ($term = trim((string) ($f['q'] ?? ''))) {
                $this->applySearch($base, $term);
            }

            $tabs = $this->tabCounts(clone $base, $f['po_mode'] ?? null);

            $q = $base->with([
                'vendor:id,vendor_code,company_name,legal_name,risk_level_id,supplier_category',
                'vendor.riskLevel:id,name',
                // po_date was read by listRow but never selected, so the PO DATE
                // column came back blank on every row.
                'purchaseOrder:id,code,po_date,po_type,shipment_order_id,lead_id,proforma_invoice_id,'
                    . 'procurement_request_code,physical_inspection,inspection_status,zoho_status,'
                    . 'expected_delivery_date,grand_total,tds_amount,paid_amount,balance_amount',
                'warehouse:id,code,wh_name,wh_type',
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
                    DB::raw('GREATEST(approved_amount - paid_amount, 0)'))
                /* Is the FLOOR finished — every packed box physically on a shelf.
                   A different fact from status/stage_completed, which is a person
                   pressing Submit. Both matter and they are not the same: an
                   invoice can be fully put away and still unsigned, and until now
                   nothing in a list could show that.
                   Subqueries on the one list query, like the two above, so a page
                   of ten rows costs two extra queries rather than twenty. Derived
                   every time rather than stored, so it cannot drift. */
                ->withCount([
                    'boxes as boxes_total',
                    'putaways as boxes_placed' => fn ($r) => $r->where('status', SpiPutaway::PLACED),
                ]);

            $this->applyPoMode($q, $f['po_mode'] ?? null);
            $this->applyShipmentMode($q, $f['shipment_mode'] ?? null);

            $page = $q->orderByDesc("$t.id")->paginate((int) ($f['per_page'] ?? 10));
            $rows = collect($page->items());
            // Shipment and opportunity codes for the whole page in two queries.
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
                    // useServerList, shared with the PO list, needs this to know
                    // whether there is a next page.
                    'last_page' => $page->lastPage(),
                ],
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /p2p/spi/{id} — one invoice with its items and the packing summary. */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            /* Every stage in one call — the detail screen renders all four, and
               three round trips to paint one page is three chances to show a
               half-loaded invoice. */
            $spi->load([
                'items',
                'vendor:id,vendor_code,company_name',
                'warehouse:id,code,wh_name,wh_type',
                'purchaseOrder:id,code,po_date,po_type,shipment_order_id,lead_id,procurement_request_code,'
                    . 'expected_delivery_date,grand_total,tds_amount,paid_amount,balance_amount',
                'purchaseOrder.shipmentOrder:id,shipment_code',
                /* A Direct SPI has no order to read its shipment through, so the
                   header lost its Shipment ID and PI number on reopen. */
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
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ STAGE 01 ══════════════════════════ */

    /** POST /p2p/spi — the first write of the whole flow. Opening the form writes nothing. */
    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $data = $this->validateHeader($request, $user, null);

            $spi = SupplierInvoice::create($data + [
                'code'            => $this->svc->nextCode((int) $user->client_id, (int) $user->branch_id),
                /* A DIRECT SPI is only a draft row at this point: the setup modal
                   has it, but Stage 01 itself — the invoice details, the
                   validation, the GST gate — has not been answered yet. Marking
                   it 1 here sent anyone who closed and reopened straight to
                   Stage 02. updateStage1() is what earns the 1.

                   An invoice raised against an ORDER keeps the old behaviour:
                   choosing the purchase order IS its Stage 01. */
                'stage_completed' => empty($data['purchase_order_id']) ? 0 : 1,
                'status'          => SupplierInvoice::STATUS_DRAFT,
                'created_by'      => $user->id,
            ]);

            $this->svc->log($spi, 'created', ['new_value' => $spi->code]);

            /* Columns the caller did not send are absent from a freshly created
               model, so the response shape changed with the payload. */
            $spi->refresh();

            DB::commit();

            return response()->json(['status' => true, 'data' => $spi], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /p2p/spi/{id}/stage-1 — editable while the invoice is still a draft. */
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

            // Re-pointing at a different PO after items exist would orphan the match.
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

            /* The supplier stays open until this invoice goes to a senior; a
               pending or approved request fixes it. Same guard the purchase
               order carries (PurchaseOrderController), and for the same
               reason: the senior approved THIS supplier's overdue filing, so
               a swap afterwards leaves the approval vouching for a risk
               nobody looked at.

               document_type is locked with it. gstGate() returns 'clear'
               outright for an international document, so a domestic ->
               international flip would step around the approval without the
               supplier moving at all. */
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

            /* What the supplier still owes before Stage 01 counts as answered.
               The fields are saved either way — an invoice records goods that
               have already arrived, so refusing the save would only mean the
               delivery goes unrecorded. The stage is withheld instead, and the
               reasons come back with it. */
            $blockers = $this->stage1Blockers($spi, $data, $user);

            $spi->forceFill($data + [
                'updated_by' => $user->id,
                /* max(), so a later stage never falls back — and so an invoice
                   already past Stage 01 is not dragged to 0 by a supplier whose
                   paperwork lapsed after the fact. */
                'stage_completed' => max($blockers ? 0 : 1, (int) $spi->stage_completed),
            ])->save();
            $this->svc->log($spi, 'stage1_saved');
            $spi->refresh();

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $spi,
                // Empty when Stage 01 is complete; each entry has code + message.
                'blockers' => $blockers,
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ STAGE 02 ══════════════════════════ */

    /**
     * PUT /p2p/spi/{id}/items — the whole grid saves at once.
     *
     * Never row by row: the header totals are rolled up from the lines in the
     * same transaction, so a partial save would leave the two disagreeing.
     */
    public function updateItems(Request $request, int $id)
    {
        // Named out here so the catch can clean them up — the files land on
        // disk before the transaction opens, and a failed save must not leave
        // an orphan behind.
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

            // The supplier's invoice number, date and e-way details are part of
            // this screen, not Stage 01 — so they save with the grid.
            $header = $this->validateInvoiceDetails($request, $user, $spi);

            /* The grid does its own arithmetic and posts the result; the server
               stores it. Only description, qty_po and pi_item_id are filled in
               here, and those are snapshots of the order rather than calculations. */
            $data = $request->validate([
                'items'              => ['required', 'array', 'min:1'],
                /* Which existing line each row IS. Optional: a payload without
                   ids still matches by position, as it always did. Sent, it is
                   what stops a reordered grid from rewriting rows in place —
                   Stage 03 boxes point at these ids. */
                'items.*.id'         => ['nullable', 'integer'],
                'items.*.po_item_id' => ['nullable', 'integer'],
                /* A Direct SPI has no PO line to take this from, so the caller
                   names the PI line it is billing. Ignored when there is a PO:
                   the order is the authority there. */
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

            // On disk now; the catch deletes them again if the write fails.
            $files = $this->storeAttachments($request, $spi);

            /* The file each upload REPLACES, read before the model is filled.
             *
             * One invoice and one e-way bill per SPI — a single column each, so
             * a second upload simply overwrites the first. What it did not do
             * was remove the first from disk: every re-upload left a file nobody
             * can reach, and SPI 1 had eight of them against two live paths.
             *
             * Deleted AFTER the commit, never before. A rollback leaves the old
             * path as the live one, and a file deleted on the way to a failed
             * save is a document lost for nothing. */
            $superseded = [];
            foreach (['invoice', 'eway'] as $kind) {
                $new = $files["{$kind}_file_path"] ?? null;
                $old = $spi->{"{$kind}_file_path"};
                if ($new && $old && $old !== $new) $superseded["{$kind}_file_path"] = $old;
            }

            // An international supplier charges no Indian GST: the four tax columns
            // stay NULL, which is a different fact from "charged at zero rate".
            $rows = $this->priceLines(
                $data['items'],
                $spi->isInternational(),
                $spi->purchase_order_id ? (int) $spi->purchase_order_id : null,
                $spi->id,
            );

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
            $spi = $this->svc->saveItems($spi, $rows, false);

            /* No packing summary here: nothing is packed at Stage 02, so it would
               be a row of zeros. What this stage owns is the MATCH — what the PO
               ordered against what the supplier billed. The packing figures belong
               to Stage 03 and have their own endpoint. */
            $spi->load('items');

            DB::commit();

            // The replaced files, now that the new paths are safely stored.
            $this->removeFiles($superseded);

            return response()->json(['status' => true, 'data' => [
                'invoice'  => $spi,
                'match'    => $this->matchSummary($spi),
                'warnings' => $warnings,
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->removeFiles($files);

            /* A validation failure is an answer, not a fault — only the rest
               earns a line. Logged here because the rethrow below reaches the
               caller as a bare "Server Error" once APP_DEBUG is off, which
               leaves nothing to act on. */
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

    /** Best effort: a file left behind after a rolled-back save is an orphan. */
    private function removeFiles(array $files): void
    {
        foreach ($files as $key => $path) {
            if (!str_ends_with($key, '_path') || !$path) continue;
            $disk = config('filesystems.documents') ?: config('filesystems.default', 'public');
            try { Storage::disk($disk)->delete($path); } catch (\Throwable) { /* nothing to do */ }
        }
    }

    /* ══════════════════════════ CLOSE ══════════════════════════ */

    /** PUT /p2p/spi/{id}/submit — refuses while quantity is still unpacked. */
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

            /* Every box has to actually be somewhere.
             *
             * This call is what closes Stage 04, and until now it only checked
             * PACKING — so an invoice could be submitted with a box that had
             * never been allocated a shelf. The progress block already computed
             * "complete: false" and then nothing acted on it.
             *
             * A box left behind this way is invisible afterwards: its stage is
             * finished, so no screen lists it as outstanding, and if it was
             * assigned its shelf stays reserved for a put-away nobody will
             * finish. */
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

    /** DELETE /p2p/spi/{id} — soft delete, refused once goods have moved on. */
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

            // Every line gives its quantity back to the PO before the invoice goes.
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
    public function paymentRequests(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $po  = $spi->purchaseOrder;

            $rows = PoPaymentRequest::where('supplier_invoice_id', $spi->id)
                ->orderBy('id')->get();

            /* The CONSTANT, not a literal.
             *
             * The column stores 'approved' / 'pending' in lower case; this
             * compared against 'Approved' and matched nothing, so awaiting,
             * approved_amount and ready_to_pay were all returned as 0 on every
             * invoice. Invisible on screen because the panel adds the figures
             * up from the request rows itself — the summary it was given was
             * simply never used. */
            $approved = $rows->where('status', PoPaymentRequest::STATUS_APPROVED);
            $paid     = round((float) $rows->sum('paid_amount'), 2);
            $gst      = round((float) $spi->total_cgst + (float) $spi->total_sgst + (float) $spi->total_igst, 2);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
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
                    'awaiting'         => round((float) $rows->where('status', PoPaymentRequest::STATUS_PENDING)->sum('requested_amount'), 2),
                    'approved_amount'  => round((float) $approved->sum('approved_amount'), 2),
                    'paid_amount'      => $paid,
                    // Approved but not yet released — what the Make Payment button owes.
                    'ready_to_pay'     => round((float) $approved->sum(fn($r) => max(0, (float) $r->approved_amount - (float) $r->paid_amount)), 2),
                ],

                /* The real ceiling for a PO-backed invoice: a request against
                   it is checked against the ORDER's balance, not the
                   invoice's. A Direct SPI has no order, so it is its own
                   ceiling — see `ledger` below, which says which of the two
                   is in force rather than leaving the caller to infer it
                   from a null. */
                'po' => $po ? [
                    'id' => $po->id,
                    'code' => $po->code,
                    'grand_total'    => (float) $po->grand_total,
                    'tds_amount'     => (float) $po->tds_amount,
                    'net_payable'    => round((float) $po->grand_total - (float) $po->tds_amount, 2),
                    'paid_amount'    => (float) $po->paid_amount,
                    'balance_amount' => (float) $po->balance_amount,
                ] : null,

                /* Whichever document the money is actually measured against.
                   The screen reads this and does not care which it is; the
                   `source` says so for anything that does. TDS comes off the
                   taxable base, so net_payable is grand_total - tds_amount
                   on both sides — the same arithmetic saveTds() caps. */
                'ledger' => $po ? [
                    'source'         => 'purchase_order',
                    'code'           => $po->code,
                    'grand_total'    => (float) $po->grand_total,
                    'tds_amount'     => (float) $po->tds_amount,
                    'net_payable'    => round((float) $po->grand_total - (float) $po->tds_amount, 2),
                    'paid_amount'    => (float) $po->paid_amount,
                    'balance_amount' => (float) $po->balance_amount,
                ] : [
                    'source'         => 'supplier_invoice',
                    'code'           => $spi->code,
                    'grand_total'    => (float) $spi->grand_total,
                    'tds_amount'     => (float) $spi->tds_amount,
                    'net_payable'    => round((float) $spi->grand_total - (float) $spi->tds_amount, 2),
                    /* Null until the first payment: the ledger has not been
                       opened, which is not the same as a zero balance. */
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
                    'requested_to'     => $r->requested_to,
                    'requested_at'     => $r->requested_at,
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

    /* ══════════════════════════ ZOHO ══════════════════════════ */

    /** POST /p2p/spi/{id}/zoho-sync — only a standalone invoice creates its own bill. */
    public function zohoSync(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            if (!$spi->ownsZohoBill()) {
                $po = $spi->purchaseOrder;

                abort(response()->json([
                    'status'  => false,
                    'message' => "This invoice is against {$po?->code} — its Zoho bill belongs to the purchase order.",
                ], 422));
            }

            abort(response()->json([
                'status'  => false,
                'message' => 'Zoho sync for standalone invoices is not wired up yet.',
            ], 501));
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /p2p/spi/{id}/summary — everything the Temporary Putaway Summary shows.
     *
     * One call for the whole dialog: the header pills, the eight analytics
     * tiles, the three trading parties, the PI/PO/SPI references, the
     * per-box placement and the per-box contents.
     *
     * Read-only, and it reads ROWS. The screen used to compute its zones and
     * racks from the invoice number, so it drew a full allocation for an
     * invoice whose boxes had never been scanned; this answers from
     * p2p_spi_putaways and returns nulls where nothing has been placed.
     */
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

    /**
     * GET /p2p/spi/{id}/packed-boxes — every box of this invoice, fully resolved.
     *
     * The packing screen reads /boxes, which returns the rows it edits. This is
     * the same boxes for a READER: products named, flags named, the put-away
     * location, the attachments and the sticker state, with the dimensions and
     * weights as measured.
     */
    public function packedBoxes(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            /* Paged and filtered on the server. An invoice can hold a hundred
               boxes and a box carries its products and attachments, so the
               whole list is far more than a screen of ten rows needs. */
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

    /**
     * GET /p2p/spi/{id}/evidence-vault — every document filed against this invoice.
     *
     * Grouped as the dialog reads: the purchase order, the invoice's own
     * uploads, the trade documents and agreements, and the packing evidence.
     * Read-only — the vault gathers paperwork produced elsewhere.
     *
     * The SUPPLIER's vault (KYC, DD, licences) is a different endpoint keyed on
     * the vendor: /segment-uploads/supplier/{id}/vault.
     */
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

    /** GET /p2p/spi/{id}/zoho-tracker — says WHY there is no bill, rather than showing an empty state. */
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

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /**
     * One row of the list, flat.
     *
     * The shipment, the procurement case and the money are read from the
     * invoice FIRST and from the purchase order only as a fallback: a Direct
     * SPI carries its own, a PO-backed one leaves them null so the order
     * stays the one authority.
     *
     * PO number and type still reach through the order alone — a Direct SPI
     * has neither, so they stay null and the UI shows a dash. The opportunity
     * falls back to the shipment's PI, so a Direct SPI with a shipment has one.
     */
    private function listRow(SupplierInvoice $s, array $refs = ['ship' => [], 'opp' => []]): array
    {
        $po = $s->purchaseOrder;

        // Own column first, then the order's.
        $shipId = $s->shipment_order_id ?? $po?->shipment_order_id;
        $ship   = $shipId ? ($refs['ship'][$shipId] ?? null) : null;
        // The opportunity code lives on the proforma invoice: the order's, else
        // the shipment's — a Direct SPI with a shipment reaches it that way.
        $piId   = $po?->proforma_invoice_id ?? $ship->proforma_invoice_id ?? null;
        $opp    = $piId ? ($refs['opp'][$piId] ?? null) : null;
        $day  = fn ($d) => $d ? substr((string) $d, 0, 10) : null;

        /* Counts come from withCount on the list query; null on any caller that
           did not ask for them, so the frontend can tell "not loaded" from
           "nothing placed" instead of reading 0 as complete. */
        $boxes  = $s->boxes_total  ?? null;
        $placed = $s->boxes_placed ?? null;

        return [
            'id'          => $s->id,
            'boxes_total'       => $boxes,
            'boxes_placed'      => $placed,
            // The floor is done. Null when the counts were not loaded, and
            // false for an invoice with no boxes — nothing packed is not done.
            'putaway_complete'  => ($boxes === null || $placed === null)
                ? null
                : ($boxes > 0 && $placed >= $boxes),
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
            'procurement_id'   => $s->procurement_request_code ?? $po?->procurement_request_code,

            'supplier'    => [
                'id'            => $s->vendor?->id,
                'code'          => $s->vendor?->vendor_code,
                // Legal name first, as the PO list does — that is the name on
                // the paperwork; the trading name is the fallback.
                'name'          => $s->vendor?->legal_name ?: $s->vendor?->company_name,
                'risk_level_id' => $s->vendor?->risk_level_id,
                // The Risk Alert column prints the level's name, not its id.
                'risk'          => $s->vendor?->riskLevel?->name,
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

            /* Money lives on the PO: an SPI amount is the supplier's claim, it
               is not what the balance is measured against. A Direct SPI has no
               order, so the invoice IS the ceiling and these came back null —
               leaving the payment screen nothing to compute against.

               TDS is cut on the taxable total, not on the grand total, and is
               already stored that way; what is subtracted here is the amount. */
            'total_po_amount'    => (float) ($po ? $po->grand_total : $s->grand_total),
            'net_payable_amount' => $po
                ? round((float) $po->grand_total - (float) $po->tds_amount, 2)
                : round((float) $s->grand_total - (float) $s->tds_amount, 2),
            'total_paid_amount'  => (float) ($po ? $po->paid_amount : $s->paid_amount),
            /* Derived for a Direct SPI rather than read: balance_amount is null
               until a payment opens the ledger, and a blank balance on an
               unpaid invoice reads as missing data, not as nothing paid. */
            'balance_amount'     => $po
                ? (float) $po->balance_amount
                : round((float) $s->grand_total - (float) $s->tds_amount - (float) $s->paid_amount, 2),
            'total_spi_amount'   => (float) $s->grand_total,

            'warehouse'   => $s->warehouse ? [
                'id'      => $s->warehouse->id,
                // The Inventory master's own columns: a stored per-branch code,
                // and a type of 'own' / 'tpl'.
                'code'    => $s->warehouse->code,
                'name'    => $s->warehouse->wh_name,
                // Drives the OWN / 3PL badge. Read from the master, never stored.
                'is_own'  => $s->warehouse->wh_type === 'own',
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
        /* Either place the link can live. Going through the order alone meant
           no Direct SPI could ever appear under "With Shipment ID", however
           plainly it carried one. Table-qualified: applySearch joins a `po`
           and an `sh` alias, and a bare shipment_order_id is ambiguous. */
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
        $rows = collect($rows);
        $pos  = $rows->map(fn ($s) => $s->purchaseOrder)->filter();

        /* A Direct SPI carries its own shipment id; a PO-backed invoice leaves
           the column null so the order stays the one authority. Both sources
           go into the same lookup. */
        $shipIds = $rows->pluck('shipment_order_id')
            ->merge($pos->pluck('shipment_order_id'))
            ->filter()->unique()->all();

        $ship = DB::table('shipment_orders')
            ->whereIn('id', $shipIds ?: [0])
            ->get(['id', 'shipment_code', 'proforma_invoice_id', 'created_at'])->keyBy('id');

        // The order's PI, plus the shipment's PI for a Direct SPI, which has
        // no order to carry one.
        $piIds = $pos->pluck('proforma_invoice_id')
            ->merge($ship->pluck('proforma_invoice_id'))
            ->filter()->unique()->all();

        $opp = DB::table('proforma_invoices')
            ->whereIn('id', $piIds ?: [0])
            ->get(['id', 'opp_code', 'created_at'])->keyBy('id');

        return ['ship' => $ship, 'opp' => $opp];
    }

    /**
     * The tab numbers.
     *
     * Counted from the query as it stands BEFORE the tab is applied, but AFTER
     * the search and the screen-wide status / supplier / date filters — so each
     * tab shows its own figure, and every figure describes the rows a search
     * has left behind.
     *
     * $base may therefore carry applySearch's left joins. They are all
     * many-to-one (po, vendor, shipment, lead), so COUNT(*) is unaffected.
     *
     * The sub-tab counts are taken WITHIN the selected top tab, because the
     * screen nests them under it. With the Direct-SPI fix in
     * applyShipmentMode(), the two sub-tabs now add up to their parent.
     */
    private function tabCounts($base, ?string $poMode = null): array
    {
        // One pass for the top row of tabs.
        $r = (clone $base)->select(DB::raw(
            'COUNT(*) AS all_spi,
             COUNT(p2p_supplier_invoices.purchase_order_id) AS with_po,
             COUNT(*) FILTER (WHERE p2p_supplier_invoices.purchase_order_id IS NULL) AS direct_spi,
             COUNT(DISTINCT p2p_supplier_invoices.purchase_order_id) AS distinct_po'
        ))->reorder()->first();

        /* The sub-tabs sit UNDER the selected top tab, so they are counted
           within it — before, they always counted every SPI and the two never
           added up to their parent. */
        $scoped = clone $base;
        $this->applyPoMode($scoped, $poMode);
        $scopedTotal = (clone $scoped)->count();

        /* Through applyShipmentMode, not a copy of its predicate: the count
           and the rows under it have to agree, and the copy that drifts is
           the one that makes a tab lie. */
        $shipQ = clone $scoped;
        $this->applyShipmentMode($shipQ, 'with_shipment');
        $withShipment = $shipQ->count();

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
            // COALESCE, so a Direct SPI's own shipment code is searchable too.
            ->leftJoin('shipment_orders as sh', fn ($j) => $j->whereRaw(
                'sh.id = COALESCE(p2p_supplier_invoices.shipment_order_id, po.shipment_order_id)'))
            /* The proforma invoice, not the lead: linkRefs() prints the code from
               pi.opp_code, and a search has to look where the row read it. */
            ->leftJoin('proforma_invoices as pfi', 'pfi.id', '=', 'po.proforma_invoice_id')
            ->select('p2p_supplier_invoices.*')
            ->where(function ($w) use ($like, $term) {
                $w->where('p2p_supplier_invoices.code', 'ilike', $like)                 // SPI/2026-27/001
                    ->orWhere('p2p_supplier_invoices.invoice_no', 'ilike', $like)       // the supplier's own number
                    ->orWhere('p2p_supplier_invoices.status', 'ilike', $like)
                    ->orWhere('p2p_supplier_invoices.document_type', 'ilike', $like)    // domestic / international
                    ->orWhere('po.code', 'ilike', $like)                                // PO/2026-27/016
                    ->orWhere('po.po_type', 'ilike', $like)                             // material_goods …
                    ->orWhere('po.procurement_request_code', 'ilike', $like)            // PROC-001
                    ->orWhere('p2p_supplier_invoices.procurement_request_code', 'ilike', $like)
                    ->orWhere('sh.shipment_code', 'ilike', $like)                       // SHP-001
                    ->orWhere('pfi.opp_code', 'ilike', $like)                           // OPP-001
                    // Legal name first, the order listRow prints them in.
                    ->orWhere('v.legal_name', 'ilike', $like)
                    ->orWhere('v.company_name', 'ilike', $like)
                    ->orWhere('v.vendor_code', 'ilike', $like);

                /* The prototype lets you search the WORDS "direct spi without
                   po" to pull up every standalone invoice — there is no column
                   holding that phrase, so it is matched here instead.
                   Four characters at least: the test is substring-of-the-phrase,
                   so 'po' and 'spi' would otherwise drag every standalone invoice
                   into an ordinary code search, and they appear in every PO code
                   and every invoice code there is. */
                if (strlen($term) >= 4 && str_contains('direct spi without po', strtolower($term))) {
                    $w->orWhereNull('p2p_supplier_invoices.purchase_order_id');
                }
            });
    }

    /**
     * Why a DIRECT SPI's Stage 01 is not finished yet.
     *
     * The same compliance a purchase order is held to at submit, asked here
     * instead: the supplier's GST position, the senior approval an overdue
     * return needs, and paperwork that has run out.
     *
     * The fields are saved either way. An invoice records goods that have
     * already arrived, so refusing the save would only mean the delivery goes
     * unrecorded — the stage is withheld instead, which stops the wizard
     * without losing anyone's work.
     *
     * Only for a Direct SPI. An invoice raised against an ORDER inherits that
     * order's clearance: the PO was refused at submit unless all of this
     * passed, so asking again would hold up an invoice for goods a cleared
     * order already brought in.
     *
     * @return array<int,array{code:string,message:string}>
     */
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
            /* The approval that counts is the one raised against THIS invoice.
               A different invoice's approval covers a different claim, even
               for the same supplier. */
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

            /* ── Direct SPI setup, steps 01 and 02 ──────────────────────
             * Only a Direct SPI sends these. A PO-backed invoice leaves them
             * out and goes on reading the order's own columns, so there is
             * never a second copy of the same fact to keep in step.
             *
             * Step 01 is answerable with "All Other's (Without Shipment ID)",
             * which is a real answer and not a skipped question — hence
             * nullable rather than required_if.
             *
             * Tenant-scoped the same way warehouse_id is: an id with no scope
             * behind it accepts another client's row. Shipment orders are
             * client-wide, so client_id alone is the right fence here. */
            /* No deleted_at clause: shipment_orders does not soft-delete,
               and filtering on a column that is not there throws. */
            'shipment_order_id' => ['nullable', 'integer', Rule::exists('shipment_orders', 'id')
                ->where(fn ($q) => $q->where('client_id', $user->client_id))],

            /* NOT fenced to `procurements` yet, deliberately. Step 02 of the
               Direct SPI setup is not wired, so an id arriving today is a
               placeholder and an exists rule would refuse an otherwise
               complete invoice. Restore the tenant scope — the same one
               shipment_order_id carries above — once real ids are sent. */
            'procurement_request_id' => ['nullable', 'integer'],
            // 30, as the purchase order validates it. Stored beside the id
            // because it is what the lists search and the sticker prints.
            'procurement_request_code' => ['nullable', 'string', 'max:30'],
            // Decides whether the tax section renders at all, so it is asked
            // up front rather than discovered at Stage 02.
            'document_type'     => ['required', Rule::in(SupplierInvoice::DOC_TYPES)],
            /* Must be a warehouse THIS INVOICE'S BRANCH can see.
             *
             * It was ['nullable','integer'] with no foreign key behind it, so
             * any number stuck — including an id belonging to another client,
             * or to the old master table the relation used to read.
             *
             * Client alone is not enough. A warehouse is branch-wise, and so is
             * everything under it: scoping only to the company let a branch-6
             * invoice be saved against a branch-7 warehouse, and putaway would
             * then hunt for zones in a building the invoice's branch does not
             * own. A null branch_id is a client-wide site and belongs to every
             * branch, which is the same rule the Inventory masters read by
             * (BaseInventoryController::scopeTenant).
             *
             * On create the invoice does not exist yet, so the branch is the
             * one it is about to be filed under — tenantUser() refuses a user
             * without one, so this is never null. */
            'warehouse_id'      => ['nullable', 'integer', Rule::exists('inventory_warehouses', 'id')
                ->where(fn ($q) => $q
                    ->where('client_id', $user->client_id)
                    ->where(fn ($w) => $w
                        ->whereNull('branch_id')
                        ->orWhere('branch_id', $spi?->branch_id ?? $user->branch_id)))],
        ]);
    }

    /**
     * The Stage 02 header — the supplier's own invoice, saved alongside the
     * item grid because they are one screen and one decision.
     */
    private function validateInvoiceDetails(Request $request, $user, SupplierInvoice $spi): array
    {
        /* The supplier cannot bill before the order was placed. A Direct SPI
           has no purchase order, so there is nothing to hold it to. */
        $poDate = $spi->purchase_order_id
            ? optional($spi->purchaseOrder)->po_date?->toDateString()
            : null;

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
                $poDate ? "after_or_equal:$poDate" : null,
            ])),
            'eway_no'       => ['nullable', 'string', 'max:40'],
            'currency_code' => ['nullable', 'string', 'size:3', 'required_if:document_type,international'],
            'exchange_rate' => ['nullable', 'numeric', 'gt:0'],
        ], [
            'invoice_no.unique' => 'This supplier has already billed that invoice number.',
            'invoice_date.after_or_equal' => $poDate
                ? 'The purchase invoice date cannot be earlier than the PO date (' . date('d-M-Y', strtotime($poDate)) . ').'
                : 'The purchase invoice date cannot be earlier than the PO date.',
        ]);
    }

    /**
     * Our own warehouse allocates rack and shelf; a third party is summary
     * only. Read from the master, never from a column here that could
     * contradict the warehouse it points at.
     */
    /**
     * Ours or a third party's — it decides whether Stage 4 runs the full
     * rack-and-shelf put-away or the 3PL summary.
     *
     * Read from inventory_warehouses, where the column holds 'own' / 'tpl'. It
     * used to ask master_warehouse_master for the string 'Own Warehouse',
     * which was wrong twice over once the Inventory masters landed: the wrong
     * table, and a value the new one cannot contain.
     *
     * No warehouse chosen yet still means TRUE — the screen must offer the
     * full flow until someone says otherwise, not quietly fall to summary.
     */
    private function isOwnWarehouse(?int $warehouseId): bool
    {
        if (!$warehouseId) return true;

        return DB::table('inventory_warehouses')->where('id', $warehouseId)->value('wh_type') === 'own';
    }

    /**
     * The TOTALS row of the 3-way match grid: ordered against billed, and the
     * two sides of the gap. Every figure is a sum of columns already loaded —
     * no query, and nothing stored.
     */
    private function matchSummary(SupplierInvoice $spi): array
    {
        $items = $spi->items;

        /* Ordered means the purchase order where there is one and the proforma
           invoice where there is not, so a Direct SPI is measured against
           something. qty_po stays for the screens already reading it. */
        $ordered = $items->sum(fn ($i) => (float) ($i->qty_po ?? $i->qty_pi ?? 0));

        return [
            'lines'       => $items->count(),
            'qty_po'      => round((float) $items->sum('qty_po'), 3),
            'qty_ordered' => round($ordered, 3),
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
     *
     * ONE FILE EACH, by the shape of the table: `invoice_file_path` and
     * `eway_file_path` are single columns, and the rules accept a single file
     * rather than a list. A new upload therefore replaces the old one; the
     * caller removes what it replaced once the save has committed.
     */
    /**
     * PUT /p2p/spi/{id}/stage-3 — packing is finished.
     *
     * Stage 3 is the one stage whose work happens over MANY requests (a box
     * at a time), so unlike stages 1 and 2 there is no natural save to hang
     * the stamp on. Hanging it on the box save instead would be wrong twice:
     * saving box 3 of 10 does not finish the stage, and deleting a box would
     * then have to walk the stamp back.
     *
     * The completeness rule is enforced HERE and not only in the wizard: the
     * browser's check is a courtesy, this is the one that holds when the call
     * arrives from anywhere else.
     *
     * max(), never a plain 3 — a re-visit from stage 4 must not demote an
     * invoice that is already further along.
     */
    public function completeStage3(Request $request, int $id)
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        $rows   = $this->svc->packingSummary($spi->id);
        $totals = $this->svc->packingTotals($rows);

        // An invoice with no lines is not "fully packed", it is empty —
        // every() is true over nothing, so say so before trusting it.
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

        /* The box saves already moved the column — this endpoint exists so
           Next has something to await and something to be refused by, not
           because the stamp depends on it. Same rule either way. */
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

        // Never empty: store() does array_key_exists() on this and a null
        // disk is a TypeError, which no guard below would catch.
        $disk = config('filesystems.documents') ?: config('filesystems.default', 'public');

        foreach (['invoice' => 'invoice_file', 'eway' => 'eway_file'] as $kind => $field) {
            $f = $request->file($field);
            if (!$f) continue;

            /* The upload has to have arrived before it can be stored. An
               unwritable PHP temp directory or a body over post_max_size hands
               back an UploadedFile that is not valid, and store() answers that
               with a FileException — which the caller sees as "Server Error"
               and nothing else. The box-photo path already checks this. */
            if (!$f->isValid()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "The {$kind} file did not upload completely ({$f->getErrorMessage()}). Try again.",
                ], 422));
            }

            $path = $f->store($dir, $disk);

            /* The documents disk carries 'throw' => false, so a refused write
               comes back as FALSE instead of raising. Stored as-is it left a
               saved invoice pointing at no file at all; say so instead. */
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
    /**
     * @param int|null $spiId The invoice being saved, excluded from the open
     *                        calculation so its own old quantity is not counted
     *                        against the line it is replacing.
     */
    private function priceLines(array $items, bool $international, ?int $poId = null, ?int $spiId = null): array
    {
        $poLines = DB::table('p2p_purchase_order_items')
            ->whereIn('id', collect($items)->pluck('po_item_id')->filter())
            ->get()->keyBy('id');

        /* extra_qty is worked out here rather than taken from the payload: the
           browser can only see its own grid, and whether a line is over depends
           on every OTHER invoice on the order. It stays a SNAPSHOT — correct at
           save time, and not revisited when a sibling invoice later changes. */
        $open = $poId ? $this->svc->openQtyByPoItem($poId, $spiId) : [];

        /* The two joins were here all along, selecting nothing: hsn_code and
           uom were in the table and never once written. */
        $products = DB::table('products as p')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->whereIn('p.id', collect($items)->pluck('product_id'))
            ->get(['p.id', 'p.name', 'p.description', 'p.gst_amount',
                'h.hsn_code', DB::raw('COALESCE(u.short_code, u.title) AS uom')])
            ->keyBy('id');

        /* What the proforma invoice ordered on each line this bills. The match
           panel has a qty_po for a PO-backed invoice and had nothing at all
           for a Direct SPI, which answers to a PI instead. */
        $piQty = DB::table('proforma_invoice_items')
            ->whereIn('id', collect($items)->pluck('pi_item_id')->filter())
            ->pluck('quantity', 'id');

        return collect($items)->map(function ($r) use ($international, $poLines, $products, $open, $piQty) {
            // ?? null: a Direct SPI grid sends no po_item_id key at all.
            $po   = ($r['po_item_id'] ?? null) ? ($poLines[$r['po_item_id']] ?? null) : null;
            $prod = $products[$r['product_id']] ?? null;

            /* How much of THIS line goes past what the order still had open.
               No PO behind it (a standalone invoice) means nothing to exceed,
               and the payload's own figure is the fallback when the open
               quantity could not be read. */
            $extra = $po && array_key_exists($r['po_item_id'], $open)
                ? $this->svc->splitBalance((float) $open[$r['po_item_id']] - (float) $r['qty_spi'])['over']
                : (float) ($r['extra_qty'] ?? 0);

            return [
                // Stripped before the write; saveItems() matches on it.
                'id'          => $r['id'] ?? null,
                'po_item_id'  => $r['po_item_id'] ?? null,
                /* Snapshots of the order, not calculations — except that a
                   Direct SPI has no order line, so its PI link comes from the
                   caller instead. */
                'pi_item_id'  => $po->pi_item_id ?? ($r['pi_item_id'] ?? null),
                'product_id'  => $r['product_id'],
                'description' => $po->description ?? $prod->description ?? $prod->name ?? null,
                /* From the product master, not the payload: the grid shows them
                   but they are the product's own facts, not the supplier's. */
                'hsn_code'    => $prod->hsn_code ?? null,
                'uom'         => $prod->uom ?? null,
                'qty_po'      => $po ? (float) $po->quantity : null,
                'qty_pi'      => isset($r['pi_item_id']) ? ($piQty[$r['pi_item_id']] ?? null) : null,

                'qty_spi'   => (float) $r['qty_spi'],
                'rate'      => (float) $r['rate'],
                'extra_qty' => $extra,

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
        $out = [];

        /* A Direct SPI answers to the proforma invoice instead of an order.
           Warned, never refused — the same judgement the PO side makes, that
           the goods have arrived and an invoice recording them is a fact, not
           a request. Its own lines are excluded so an edit is not read as a
           second claim. */
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
}
