<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PurchaseOrder;
use App\Models\SupplierPurchaseInvoice;
use App\Models\SupplierPurchaseInvoiceItem;
use App\Models\Vendor;
use App\Services\ZohoBooksService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Supplier Purchase Invoice API (P2P → Purchase Management).
 *
 * Conventions mirror PurchaseOrderController exactly: per-method tenant guard
 * off the Sanctum user, inline validation, per-client sequential code under a
 * clients row-lock + Postgres advisory lock, branch-aware read scope, and
 * `{status, data, pagination}` responses.
 *
 * An SPI is either linked to a Purchase Order (With PO → 3-way match) or is a
 * standalone Direct invoice (Without PO). Supplier / shipment / PI / customer
 * context is denormalised from the linked PO (or the chosen vendor for Direct).
 */
class SupplierPurchaseInvoiceController extends Controller
{
    /* ══════════════════════════ LIST ══════════════════════════ */

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = SupplierPurchaseInvoice::query()->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        // Top tab: with / without purchase order
        $poTab = $request->query('po_tab');
        if ($poTab === 'with')    $q->whereNotNull('purchase_order_id');
        if ($poTab === 'without') $q->whereNull('purchase_order_id');

        // Sub tab: with / without shipment id
        $shipTab = $request->query('ship_tab');
        if ($shipTab === 'with')    $q->whereNotNull('shipment_order_id');
        if ($shipTab === 'without') $q->whereNull('shipment_order_id');

        if ($doc = $request->query('document_type')) $q->where('document_type', $doc);
        if ($type = $request->query('po_type'))      $q->where('po_type', $type);

        if ($term = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($term) {
                $w->where('code', 'like', "%{$term}%")
                    ->orWhere('invoice_no', 'like', "%{$term}%")
                    ->orWhere('po_code', 'like', "%{$term}%")
                    ->orWhere('supplier_name', 'like', "%{$term}%")
                    ->orWhere('supplier_code', 'like', "%{$term}%")
                    ->orWhere('shipment_code', 'like', "%{$term}%")
                    ->orWhere('customer_name', 'like', "%{$term}%")
                    ->orWhere('po_type', 'like', "%{$term}%");
            });
        }

        $perPage = min(max((int) $request->query('per_page', 10), 1), 200);
        $paginator = $q->paginate($perPage, ['*'], 'page', max(1, (int) $request->query('page', 1)));

        return response()->json([
            'status' => true,
            'data' => collect($paginator->items())->map(fn ($spi) => $this->shapeListRow($spi))->all(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    /* ══════════════════════════ SHOW ══════════════════════════ */

    public function show(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $spi = SupplierPurchaseInvoice::with('items')->findOrFail($id);
        $this->assertScope($spi, $user);
        return response()->json(['status' => true, 'data' => $this->shapeDetail($spi)]);
    }

    /* ══════════════════════════ CREATE ══════════════════════════ */

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);

        // A PO may be invoiced across multiple SPIs — but only until its full
        // quantity is covered. Reject once the PO is already fully invoiced.
        if ($data['_po'] && $this->poFullyInvoiced($data['_po']->id)) {
            return response()->json([
                'status' => false,
                'message' => "This purchase order ({$data['_po']->code}) is already fully invoiced.",
            ], 422);
        }

        if ($this->overInvoiced($data)) {
            return response()->json([
                'status' => false,
                'message' => 'Invoiced quantity exceeds the remaining PO quantity.',
            ], 422);
        }

        $spi = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode($user->client_id);

            $header = $this->buildHeader($user, $data);
            $header['client_id'] = $user->client_id;
            $header['branch_id'] = $user->branch_id;            // stamped from user, never the request
            $header['code'] = $code;
            $header['created_by'] = $user->id;
            $header['updated_by'] = $user->id;

            $spi = SupplierPurchaseInvoice::create($header);
            $this->syncItems($spi, $data['items'] ?? [], $data['_intra']);
            $this->recomputeTotals($spi, $data);
            return $spi;
        });

        return response()->json(['status' => true, 'data' => $this->shapeDetail($spi->fresh('items'))], 201);
    }

    /* ══════════════════════════ UPDATE ══════════════════════════ */

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $spi = SupplierPurchaseInvoice::findOrFail($id);
        $this->assertScope($spi, $user, 'write');

        // Once pushed to Zoho Books the bill is the source of truth — block edits
        // here so the app and Zoho can't silently diverge.
        if (!empty($spi->zoho_bill_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'This invoice is synced to Zoho Books (bill ' . ($spi->zoho_bill_number ?: $spi->zoho_bill_id) . ') and can no longer be edited — edit it in Zoho Books instead.',
            ], 422);
        }

        // Editing after money has moved (TDS cut or any payment recorded) would
        // recompute net_payable/balance while the frozen TDS + existing payment
        // rows stay put, desyncing the ledger (total_paid could exceed the new
        // net and a later sync would over-post to Zoho). Lock the line items once
        // the invoice has entered its payment lifecycle.
        if ($spi->tds_cut || $spi->spiPayments()->exists()) {
            return response()->json([
                'status'  => false,
                'message' => 'This invoice already has a cut TDS / recorded payment and can no longer be edited — reverse the payments and TDS first.',
            ], 422);
        }

        $data = $this->validatePayload($request);

        if ($this->overInvoiced($data, $spi->id)) {
            return response()->json([
                'status' => false,
                'message' => 'Invoiced quantity exceeds the remaining PO quantity.',
            ], 422);
        }

        DB::transaction(function () use ($spi, $user, $data) {
            $header = $this->buildHeader($user, $data);
            $header['updated_by'] = $user->id;
            $spi->update($header);
            $spi->items()->delete();
            $this->syncItems($spi, $data['items'] ?? [], $data['_intra']);
            $this->recomputeTotals($spi, $data);
        });

        return response()->json(['status' => true, 'data' => $this->shapeDetail($spi->fresh('items'))]);
    }

    /* ══════════════════════════ DELETE ══════════════════════════ */

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $spi = SupplierPurchaseInvoice::findOrFail($id);
        $this->assertScope($spi, $user, 'write');
        // A synced invoice has a live bill in Zoho — deleting it here would orphan
        // that bill and its vendor payments. Block it.
        if (!empty($spi->zoho_bill_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'This invoice is synced to Zoho Books and cannot be deleted here — remove the bill in Zoho Books first.',
            ], 422);
        }
        $spi->delete();
        return response()->json(['status' => true]);
    }

    /* ══════════════════════════ ZOHO SYNC ══════════════════════════ */

    public function sync(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $spi = SupplierPurchaseInvoice::with('items')->findOrFail($id);
        $this->assertScope($spi, $user, 'write');

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) {
            return response()->json([
                'status'  => false,
                'message' => 'Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again.',
            ], 503);
        }

        // Serialize concurrent syncs of the SAME invoice — a double-submit must not
        // create two bills. Everything that writes to Zoho runs inside this lock.
        $lock = \Illuminate\Support\Facades\Cache::lock('zoho:sync:spi:' . $spi->id, 120);
        if (!$lock->get()) {
            return response()->json(['status' => false, 'message' => 'A Zoho sync for this invoice is already in progress — try again in a moment.'], 409);
        }
        try {

        // Idempotent on the BILL — never push a second bill for the same invoice.
        // But re-sync still TOPS UP any payments that didn't fully post last time
        // (a mid-push failure or a partial multi-SPI split), so the bill can be
        // brought fully paid without a duplicate.
        if (!empty($spi->zoho_bill_id)) {
            $msg = 'This invoice is already synced to Zoho Books (bill ' . ($spi->zoho_bill_number ?: $spi->zoho_bill_id) . ').';
            try {
                $vendor = Vendor::with('primaryAddress')->find($spi->vendor_id);
                if ($vendor) {
                    $gstin = DB::table('vendor_gst_scrutiny')->where('vendor_id', $vendor->id)->latest('id')->value('gst_number') ?: null;
                    $zohoVendorId = $books->findOrCreateVendorId($vendor, $gstin, optional($vendor->primaryAddress)->state_code);
                    $bill = $books->getBill((string) $spi->zoho_bill_id);
                    $r = $this->pushPaymentsToZoho($spi, $books, $zohoVendorId, (string) $spi->zoho_bill_id, (float) ($bill['balance'] ?? 0));
                    if ($r['pushed'] > 0)        $msg = 'Posted ₹' . number_format($r['applied'], 2) . ' of previously-unsynced payment(s) to bill ' . ($spi->zoho_bill_number ?: $spi->zoho_bill_id) . '.';
                    elseif ($r['noAccount'])     $msg .= ' Payments still not posted — add a Bank/Cash account in Zoho, then re-sync.';
                }
            } catch (\Throwable $e) {
                Log::warning('Zoho bill payment top-up failed', ['spi' => $spi->id, 'err' => $e->getMessage()]);
            }
            return response()->json(['status' => true, 'message' => $msg, 'data' => $this->shapeListRow($spi->fresh())]);
        }
        if (!$spi->vendor_id) {
            return response()->json(['status' => false, 'message' => 'Attach a supplier to this invoice before syncing to Zoho Books.'], 422);
        }
        if ($spi->items->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'Add at least one product line before syncing to Zoho Books.'], 422);
        }
        // The payable amount must be fully utilised (balance cleared) before this
        // invoice can be synced to Zohobook — the linked PO for a With-PO SPI, or
        // the invoice itself for a Direct SPI.
        if (!$this->spiSyncUtilized($spi)) {
            $where = $spi->purchase_order_id ? 'the linked purchase order' : 'this invoice';
            return response()->json([
                'status'  => false,
                'message' => "Utilise the full amount first — record payments against {$where} until its balance is cleared before syncing to Zohobook.",
                'errors'  => ['amount' => ['The payable amount must be fully utilised before syncing.']],
            ], 422);
        }

        try {
            $vendor    = Vendor::with('primaryAddress')->findOrFail($spi->vendor_id);
            $gstin     = DB::table('vendor_gst_scrutiny')->where('vendor_id', $vendor->id)->latest('id')->value('gst_number') ?: null;
            $stateCode = optional($vendor->primaryAddress)->state_code;

            // Intra- vs inter-state decides GST(CGST+SGST) vs IGST in Zoho. Prefer
            // the Zoho org's own state; fall back to this tenant's home state.
            $orgState   = $books->orgStateCode() ?: $this->homeStateCode($spi->branch_id);
            $interState = $stateCode && (string) $stateCode !== (string) $orgState;

            $zohoVendorId = $books->findOrCreateVendorId($vendor, $gstin, $stateCode);
            $bill   = $books->createBill($this->buildZohoBillPayload($spi, $books, $zohoVendorId, (bool) $gstin, $interState));
            $billId = (string) $bill['bill_id'];

            // Post each recorded payment against this invoice to Zoho as a vendor
            // payment applied to the new bill (best-effort — a payment hiccup must
            // not undo an otherwise-successful bill push; any un-posted portion is
            // topped up on the next re-sync via the zoho_applied_amount ledger).
            $pay = ['applied' => 0.0, 'pushed' => 0, 'pending' => 0, 'noAccount' => false, 'error' => false];
            try {
                $pay = array_merge($pay, $this->pushPaymentsToZoho($spi, $books, $zohoVendorId, $billId, (float) ($bill['balance'] ?? $bill['total'] ?? 0)));
            } catch (\Throwable $e) {
                Log::warning('Zoho bill payments partially posted', ['spi' => $spi->id, 'err' => $e->getMessage()]);
                $pay['error'] = true;
            }

            // Cache Zoho's own rendered bill PDF — best-effort.
            $pdfPath = null;
            try {
                $rel = 'zoho/bill/' . $spi->client_id . '/BILL-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($spi->code ?: $spi->id)) . '.pdf';
                Storage::disk('public')->put($rel, $books->getBillPdf($billId));
                $pdfPath = '/storage/' . $rel;
            } catch (\Throwable $e) {
                Log::warning('Zoho bill PDF cache failed', ['spi' => $spi->id, 'err' => $e->getMessage()]);
            }

            $spi->update([
                'zoho_status'      => 'Sync',
                'zoho_bill_id'     => $billId,
                'zoho_bill_number' => $bill['bill_number'] ?? null,
                'zoho_synced_at'   => now(),
                'zoho_error'       => null,
                'zoho_pdf_path'    => $pdfPath,
                'updated_by'       => $user->id,
            ]);

            // TDS is withheld (not paid to the supplier), so the Zoho bill keeps an
            // open balance equal to the TDS — flag it so the accountant records TDS
            // in Zoho. (Also true drift for an unregistered vendor whose bill is
            // pre-tax; see ZohoBooksService GST rules.)
            $tds = round((float) $spi->tds_amount, 2);
            $note = $tds > 0.005
                ? ' ₹' . number_format($tds, 2) . ' TDS remains as an open balance in Zoho — record the TDS there.'
                : '';
            // Truthfully surface payments that could NOT be posted, so "Synced"
            // never implies a fully-paid bill when it isn't.
            if ($pay['noAccount']) {
                $note .= ' NOTE: payments were NOT posted — add a Bank/Cash account in Zoho, then re-sync to post them.';
            } elseif ($pay['error'] || $pay['pending'] > 0) {
                $note .= ' Some payments could not be posted yet — re-sync to retry.';
            }

            return response()->json([
                'status'  => true,
                'message' => 'Synced to Zoho Books as bill ' . ($bill['bill_number'] ?? $billId) . '.' . $note,
                'data'    => $this->shapeListRow($spi->fresh()),
            ]);
        } catch (RuntimeException $e) {
            $spi->update(['zoho_status' => 'Not Sync', 'zoho_error' => $e->getMessage(), 'updated_by' => $user->id]);
            return response()->json(['status' => false, 'message' => $e->getMessage()], 422);
        }

        } finally {
            $lock->release();
        }
    }

    /**
     * Build the Zoho Books bill payload from a local SPI + its items. Mirrors
     * PurchaseOrderController::buildZohoPayload: forward GST is attached only for
     * a GST-registered supplier (Zoho rejects forward tax on an unregistered
     * vendor — reverse-charge rule), and the effective tax rate the app actually
     * applied (cgst+sgst halves, or full igst) is what's sent so Zoho's recomputed
     * total reconciles with ours.
     */
    private function buildZohoBillPayload(SupplierPurchaseInvoice $spi, ZohoBooksService $books, string $zohoVendorId, bool $registered, bool $interState): array
    {
        $lineItems = $spi->items->map(function ($it) use ($books, $registered, $interState) {
            $name = (string) ($it->product_name ?: $it->product_code ?: 'Item');
            $rate = (float) $it->rate;
            $effRate = $interState ? (float) $it->igst_pct : ((float) $it->cgst_pct + (float) $it->sgst_pct);
            $taxId = $registered ? $books->resolveTaxId($effRate, $interState) : null;
            $line = [
                'item_id'     => $books->findOrCreateItemId($name, $rate, $taxId, $it->product_id),
                'name'        => $name,
                'description' => (string) $it->product_code,
                'rate'        => $rate,
                'quantity'    => (float) $it->quantity,
            ];
            if (!empty($it->hsn_code)) $line['hsn_or_sac'] = (string) $it->hsn_code;
            if ($taxId) $line['tax_id'] = $taxId;
            return $line;
        })->values()->all();

        // bill_number is required + unique per vendor in Zoho: prefer the
        // supplier's own invoice number, fall back to our SPI code.
        $billNumber = trim((string) ($spi->invoice_no ?: $spi->code));

        $payload = [
            'vendor_id'        => $zohoVendorId,
            'bill_number'      => $billNumber !== '' ? $billNumber : (string) $spi->code,
            'date'             => optional($spi->invoice_date)->toDateString() ?: now()->toDateString(),
            'reference_number' => (string) $spi->code,
            'line_items'       => $lineItems,
        ];

        // Additional (shipping/packaging/other) charges have no native bill field
        // → fold into a single adjustment line so the bill total matches ours.
        $adjustment = (float) $spi->additional_charges;
        if ($adjustment != 0.0) {
            $payload['adjustment']             = $adjustment;
            $payload['adjustment_description'] = 'Additional charges';
        }

        // Currency (INR = org base, omitted); send exchange rate for non-base ccy.
        if ($ccyId = $books->resolveCurrencyId($spi->currency)) {
            $payload['currency_id'] = $ccyId;
            if ((float) $spi->exchange_rate > 0) $payload['exchange_rate'] = (float) $spi->exchange_rate;
        }

        return $payload;
    }

    /**
     * Post the recorded payments for this SPI to Zoho Books as vendor payments
     * applied to a bill. Source ledger: a With-PO SPI pays through its PO
     * (po_payments), a Direct SPI pays itself (spi_payments).
     *
     * Each row tracks its cumulative posted amount in `zoho_applied_amount`, so:
     *   • a row can be split across bills (multi-SPI PO) without losing the rest,
     *   • a payment that failed to post is topped up on the next re-sync,
     *   • nothing is ever double-posted.
     * The per-bill total is capped at the bill's balance (an unregistered-vendor
     * bill is pre-tax, and a bill keeps a TDS-sized open balance — Zoho rejects
     * applying more than a bill owes). The bank name is mapped to the matching
     * Zoho Bank ledger. Returns ['applied','pushed','pending','noAccount'].
     */
    private function pushPaymentsToZoho(SupplierPurchaseInvoice $spi, ZohoBooksService $books, string $zohoVendorId, string $billId, float $billBalance): array
    {
        $result = ['applied' => 0.0, 'pushed' => 0, 'pending' => 0, 'noAccount' => false];

        // Rows that still have an un-posted portion (posted < recorded amount).
        // Only CLEARED payments are pushed — an uncleared cheque must not become a
        // real Zoho vendor payment.
        $payments = $spi->purchase_order_id
            ? \App\Models\PoPayment::where('purchase_order_id', $spi->purchase_order_id)->where('status', 'Cleared')->whereColumn('zoho_applied_amount', '<', 'amount')->orderBy('id')->get()
            : \App\Models\SpiPayment::where('supplier_purchase_invoice_id', $spi->id)->where('status', 'Cleared')->whereColumn('zoho_applied_amount', '<', 'amount')->orderBy('id')->get();

        if ($payments->isEmpty()) return $result;

        // Any Bank/Cash ledger at all? If not, we can post nothing — flag it so
        // the caller can tell the user (rather than silently "succeeding").
        if (!$books->resolvePaidThroughAccountId(null)) {
            $result['pending']   = $payments->count();
            $result['noAccount'] = true;
            Log::warning('Zoho vendor payment skipped — no Bank/Cash account in the org', ['spi' => $spi->id]);
            return $result;
        }

        $exchangeRate = ((float) $spi->exchange_rate > 0 && $books->resolveCurrencyId($spi->currency)) ? (float) $spi->exchange_rate : null;
        $remaining = round($billBalance, 2);

        foreach ($payments as $p) {
            $available = round((float) $p->amount - (float) $p->zoho_applied_amount, 2);
            if ($available <= 0.005) continue;
            if ($remaining <= 0.005) { $result['pending']++; continue; } // bill full → leave for a sibling bill
            $amt = round(min($available, $remaining), 2);

            $payload = [
                'vendor_id'               => $zohoVendorId,
                'payment_mode'            => 'banktransfer',
                'amount'                  => $amt,
                'date'                    => optional($p->utr_cheque_date)->toDateString() ?: now()->toDateString(),
                'paid_through_account_id' => $books->resolvePaidThroughAccountId($p->bank_name),
                'bills'                   => [['bill_id' => $billId, 'amount_applied' => $amt]],
            ];
            if (!empty($p->utr_cheque_number)) $payload['reference_number'] = (string) $p->utr_cheque_number;
            // Stamp the vendor payment with the SPI number + payment date (+ bank)
            // so it's fully traceable to the supplier invoice inside Zoho Books.
            $descParts = ['SPI ' . $spi->code];
            $descParts[] = 'Date: ' . (optional($p->utr_cheque_date)->toDateString() ?: now()->toDateString());
            if (!empty($p->utr_cheque_number)) $descParts[] = 'Ref: ' . $p->utr_cheque_number;
            if (!empty($p->bank_name))         $descParts[] = 'Bank: ' . $p->bank_name;
            $payload['description'] = implode(' · ', $descParts);
            if ($exchangeRate)                 $payload['exchange_rate']     = $exchangeRate;

            $zpay = $books->recordVendorPayment($payload);

            $newApplied = round((float) $p->zoho_applied_amount + $amt, 2);
            $fields = ['zoho_applied_amount' => $newApplied, 'zoho_payment_id' => (string) ($zpay['payment_id'] ?? $p->zoho_payment_id)];
            $p->forceFill($fields)->saveQuietly();

            $remaining        = round($remaining - $amt, 2);
            $result['applied'] = round($result['applied'] + $amt, 2);
            $result['pushed']++;
            if ($newApplied + 0.005 < (float) $p->amount) $result['pending']++; // remainder for a sibling bill
        }

        return $result;
    }

    /** Stream the cached Zoho Books bill PDF for a synced SPI ("View in Zoho"). */
    public function zohoPdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $spi = SupplierPurchaseInvoice::findOrFail($id);
        $this->assertScope($spi, $user);

        if (!$spi->zoho_pdf_path) abort(404, 'No Zoho bill PDF cached for this invoice.');
        $rel = ltrim(str_replace('/storage/', '', $spi->zoho_pdf_path), '/');
        if (!Storage::disk('public')->exists($rel)) abort(404, 'Zoho bill PDF file missing.');

        return response(Storage::disk('public')->get($rel), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ZOHO-BILL-' . ($spi->code ?: $spi->id) . '.pdf"',
        ]);
    }

    /* ══════════════════════════ NEXT CODE ══════════════════════════ */

    public function previewCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $code = ($user && $user->client_id) ? $this->peekCode($user->client_id) : null;
        return response()->json(['status' => true, 'data' => ['code' => $code]]);
    }

    /* ══════════════════════════ PURCHASE ORDER DROPDOWN ══════════════════════════ */

    /**
     * Purchase orders available to map an invoice to (the "Select Purchase
     * Order" dropdown in the Map-SPI modal). Tenant-scoped; newest first.
     */
    public function purchaseOrders(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = PurchaseOrder::query()->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        // Show a PO until it is fully invoiced — hide only the fully-covered ones.
        $rows = $q->get(['id', 'code', 'supplier_name', 'po_type', 'shipment_order_id'])
            ->reject(fn ($po) => $this->poFullyInvoiced($po->id))
            ->map(fn ($po) => [
                'id' => $po->id,
                'code' => $po->code,
                'supplier' => $po->supplier_name,
                'has_shipment' => !empty($po->shipment_order_id),
            ])
            ->values();
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /**
     * Full detail of a linked PO — used to pre-fill the SPI wizard (supplier,
     * shipment/PI/customer context, and the product lines that seed the
     * PI-vs-PO-vs-SPI 3-way match table).
     */
    public function purchaseOrder(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $po = PurchaseOrder::with('items')->findOrFail($id);
        $this->assertScope($po, $user);

        // HSN codes for the PO's products. PO items don't carry HSN, so we read
        // it from the source PI line items (keyed by product) like the PO wizard.
        $hsn = [];
        if ($po->proforma_invoice_id) {
            $hsn = DB::table('proforma_invoice_items')
                ->where('proforma_invoice_id', $po->proforma_invoice_id)
                ->whereNotNull('product_id')
                ->pluck('hsn_code', 'product_id')
                ->all();
        }

        // Already-invoiced quantity per product on this PO, so the wizard can
        // seed each row with the REMAINING qty (partial-invoicing support).
        $invoicedByProduct = DB::table('supplier_purchase_invoice_items as spii')
            ->join('supplier_purchase_invoices as spi', 'spi.id', '=', 'spii.supplier_purchase_invoice_id')
            ->where('spi.purchase_order_id', $po->id)
            ->whereNull('spi.deleted_at')
            ->whereNotNull('spii.product_id')
            ->groupBy('spii.product_id')
            ->selectRaw('spii.product_id, SUM(spii.quantity) as qty')
            ->pluck('qty', 'spii.product_id');

        return response()->json(['status' => true, 'data' => [
            'id' => $po->id,
            'code' => $po->code,
            'po_type' => $po->po_type,
            'document_type' => $po->document_type,
            'mode_of_transport' => $po->mode_of_transport,
            'po_date' => optional($po->po_date)->toDateString(),
            'expected_delivery_date' => optional($po->expected_delivery_date)->toDateString(),
            'delivery_location' => $po->delivery_location,
            'payment_type' => $po->payment_type,
            'physical_inspection' => (bool) $po->physical_inspection,
            // International (document_type = International) — carried from the PO.
            'currency' => $po->currency_code,
            'exchange_rate' => $po->exchange_rate !== null ? (float) $po->exchange_rate : null,
            'inco_term' => $po->inco_term,
            'port_of_loading' => $po->port_of_loading,
            'port_of_discharge' => $po->port_of_discharge,
            'final_destination' => $po->final_destination,
            'country_of_origin' => $po->country_of_origin,
            'vendor_id' => $po->vendor_id,
            'supplier_code' => $po->supplier_code,
            'supplier_name' => $po->supplier_name,
            'supplier' => $this->supplierDetail($user, $po->vendor_id),
            'next_spi_code' => $user->client_id ? $this->peekCode($user->client_id) : null,
            'shipment_order_id' => $po->shipment_order_id,
            'shipment_code' => $po->shipment_code,
            'proforma_invoice_id' => $po->proforma_invoice_id,
            'pi_number' => $po->pi_number,
            'opportunity_id' => $po->opportunity_id,
            'opportunity_code' => $po->opportunity_code,
            'customer_name' => $po->customer_name,
            'consignee_name' => $po->consignee_name,
            'grand_total' => (float) $po->grand_total,
            'items' => $po->items->map(function ($it) use ($hsn, $invoicedByProduct) {
                $poQty = (float) $it->quantity;
                $already = $it->product_id ? (float) ($invoicedByProduct[$it->product_id] ?? 0) : 0;
                return [
                    'product_id' => $it->product_id,
                    'code' => $it->product_code,
                    'pi_name' => $it->pi_product_name,
                    'pi_qty' => $it->pi_quantity !== null ? (float) $it->pi_quantity : null,
                    'po_name' => $it->product_name,
                    'po_qty' => $poQty,
                    'invoiced_qty' => $already,
                    'remaining_qty' => max(0, $poQty - $already),
                    'rate_po' => (float) $it->rate,
                    'hsn' => $it->product_id ? ($hsn[$it->product_id] ?? null) : null,
                    'gst' => (float) $it->gst_pct,
                ];
            })->all(),
        ]]);
    }

    /* ══════════════════════════ SUPPLIER DROPDOWN (Direct SPI) ══════════════════════════ */

    public function suppliers(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $rows = Vendor::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->orderBy('company_name')
            ->get(['id', 'vendor_code', 'company_name', 'legal_name'])
            ->map(fn ($v) => [
                'id' => $v->id,
                'code' => $v->vendor_code,
                'name' => $v->company_name ?: $v->legal_name,
            ]);
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /** Single supplier's full detail — prefills the Without-PO Step 1 form. */
    public function supplier(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $data = $this->supplierDetail($user, $id);
        if (!$data) return response()->json(['status' => false, 'message' => 'Supplier not found.'], 404);
        return response()->json(['status' => true, 'data' => $data]);
    }

    /* ══════════════════════════ ATTACHMENT UPLOAD ══════════════════════════ */

    /**
     * Store the invoice attachment and return its public path. The wizard
     * uploads the file first, then includes the returned path in the save.
     */
    public function upload(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $request->validate([
            'file' => 'required|file|max:2048|mimes:pdf,jpg,jpeg,png,webp',
        ]);

        $path = $request->file('file')->store('spi/' . ($user->client_id ?: 'x'), 'public');

        return response()->json(['status' => true, 'data' => [
            'path' => '/storage/' . $path,
            'name' => $request->file('file')->getClientOriginalName(),
        ]]);
    }

    /**
     * Stream a stored SPI attachment THROUGH the backend (same-origin, with a
     * download disposition). Mirrors SegmentDocUploadController::download — the
     * public disk is Azure Blob on prod, a different origin with no CORS, so a
     * client-side fetch of the raw blob URL is blocked. Streaming here fixes it.
     */
    public function download(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Accept a full "/storage/spi/…" path or a disk-relative "spi/…" path.
        $raw = (string) $request->query('path', '');
        $raw = preg_replace('/\?.*$/', '', $raw);          // drop any query string
        if (!preg_match('#(spi/.+)$#i', $raw, $m)) abort(404);
        $path = $m[1];

        if (str_contains($path, '..') || !str_starts_with($path, 'spi/')) abort(404);

        // Files live under spi/{client_id}/… — a tenant may only pull its own.
        if ($user->user_type !== 'super_admin'
            && !str_starts_with($path, 'spi/' . ($user->client_id ?: 'x') . '/')) {
            abort(403);
        }

        if (!Storage::disk('public')->exists($path)) abort(404);

        // ?disposition=inline → open in-browser (View); otherwise force a download.
        if ($request->query('disposition') === 'inline') {
            return Storage::disk('public')->response($path, basename($path));
        }
        return Storage::disk('public')->download($path, basename($path));
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    /**
     * Full supplier detail for the Step-1 form (Supplier Details + Address &
     * Contact + GST Scrutiny). Mirrors PurchaseOrderController::supplier.
     */
    private function supplierDetail($user, ?int $vendorId): ?array
    {
        if (!$vendorId) return null;

        $v = Vendor::with(['primaryAddress', 'vendorType', 'gstScrutiny' => fn ($g) => $g->latest('id')])
            ->forUser($user, null)->find($vendorId);
        if (!$v) return null;

        $a = $v->primaryAddress;
        // Newest scrutiny = current GST status (order-safe; see PurchaseOrderController).
        $g = $v->gstScrutiny->sortByDesc('id')->first();
        $country = $a && $a->country_id ? DB::table('master_countries')->where('id', $a->country_id)->value('name') : null;
        $state = $a && $a->state_id ? DB::table('master_states')->where('id', $a->state_id)->value('name') : null;

        return [
            'id' => $v->id,
            'code' => $v->vendor_code,
            'name' => $v->company_name ?: $v->legal_name,
            'type' => optional($v->vendorType)->name,
            'addr' => optional($a)->address_line,
            'country' => $country,
            'state' => $state,
            'stateCode' => optional($a)->state_code,
            'city' => optional($a)->city,
            'contact' => optional($a)->contact_name,
            'desig' => optional($a)->designation,
            'phone' => optional($a)->contact_no,
            'email' => optional($a)->email,
            'scrutiny' => $g ? optional($g->created_at)->toDateString() : null,
            'gstNo' => optional($g)->gst_number,
            'gstStatus' => optional($g)->status,
            'filing' => $g && $g->last_filing_date ? $g->last_filing_date->toDateString() : null,
            'remarks' => $g ? ($g->prev_non_gst_2a_invoice ?: $g->red_flags) : null,
        ];
    }

    /**
     * True once a PO's full ordered quantity has been invoiced across all its
     * (non-deleted) SPIs. A PO with no quantity is never "fully invoiced".
     */
    private function poFullyInvoiced(int $poId): bool
    {
        // Count only product-bearing lines on both sides so a junk/null-product
        // line can't inflate the invoiced total and falsely lock the PO. Matches
        // overInvoiced(), which also filters on product_id.
        $ordered = (float) DB::table('purchase_order_items')
            ->where('purchase_order_id', $poId)->whereNotNull('product_id')->sum('quantity');
        if ($ordered <= 0) return false;

        $invoiced = (float) DB::table('supplier_purchase_invoice_items as spii')
            ->join('supplier_purchase_invoices as spi', 'spi.id', '=', 'spii.supplier_purchase_invoice_id')
            ->where('spi.purchase_order_id', $poId)
            ->whereNull('spi.deleted_at')
            ->whereNotNull('spii.product_id')
            ->sum('spii.quantity');

        return $invoiced >= $ordered;
    }

    /** True once this SPI's payable amount has been fully utilised — gates the
     *  Zoho sync. With-PO SPI → the linked PO's (post-TDS) balance must be
     *  cleared by PO payments; Direct SPI → the SPI's own (post-TDS) balance
     *  must be cleared by SPI payments. */
    private function spiSyncUtilized(SupplierPurchaseInvoice $spi): bool
    {
        if ($spi->purchase_order_id) {
            $po = DB::table('purchase_orders')->where('id', $spi->purchase_order_id)->first();
            if (!$po) return false;
            $net = round((float) $po->grand_total - (float) ($po->tds_amount ?? 0), 2);
            if ($net <= 0.005) return false;
            // Only CLEARED payments count toward "fully utilised" (Pending/uncleared
            // must not unlock the Zoho bill+payment push).
            $paid = (float) \App\Models\PoPayment::where('purchase_order_id', $spi->purchase_order_id)->where('status', 'Cleared')->sum('amount');
            return round($net - $paid, 2) <= 0.005;
        }
        // Direct SPI — pay against the invoice itself.
        $net = round((float) $spi->net_payable - (float) ($spi->tds_amount ?? 0), 2);
        if ($net <= 0.005) return false;
        $paid = (float) \App\Models\SpiPayment::where('supplier_purchase_invoice_id', $spi->id)->where('status', 'Cleared')->sum('amount');
        return round($net - $paid, 2) <= 0.005;
    }

    /**
     * True if the proposed items would push any product's total invoiced qty
     * (other SPIs + this payload) past what the PO ordered. `$excludeSpiId` is the
     * SPI being updated (so its own current items don't count as "other").
     */
    private function overInvoiced(array $data, ?int $excludeSpiId = null): bool
    {
        $po = $data['_po'] ?? null;
        if (!$po) return false;

        $ordered = DB::table('purchase_order_items')
            ->where('purchase_order_id', $po->id)->whereNotNull('product_id')
            ->groupBy('product_id')->selectRaw('product_id, SUM(quantity) as qty')
            ->pluck('qty', 'product_id');

        $q = DB::table('supplier_purchase_invoice_items as spii')
            ->join('supplier_purchase_invoices as s', 's.id', '=', 'spii.supplier_purchase_invoice_id')
            ->where('s.purchase_order_id', $po->id)->whereNull('s.deleted_at')->whereNotNull('spii.product_id');
        if ($excludeSpiId) $q->where('s.id', '!=', $excludeSpiId);
        $others = $q->groupBy('spii.product_id')->selectRaw('spii.product_id, SUM(spii.quantity) as qty')
            ->pluck('qty', 'spii.product_id');

        $proposed = [];
        foreach ($data['items'] ?? [] as $it) {
            if (empty($it['product_id'])) continue;
            $proposed[$it['product_id']] = ($proposed[$it['product_id']] ?? 0) + (float) ($it['quantity'] ?? 0);
        }

        foreach ($proposed as $pid => $qty) {
            $ord = (float) ($ordered[$pid] ?? 0);
            if ($ord > 0 && ((float) ($others[$pid] ?? 0) + $qty) > $ord + 0.0001) return true;
        }
        return false;
    }

    private function validatePayload(Request $request): array
    {
        $v = $request->validate([
            'invoice_no' => 'nullable|string|max:128',
            'invoice_date' => 'nullable|date',
            'document_type' => 'nullable|string|max:32',
            'po_type' => 'nullable|string|max:64',
            'mode_of_transport' => 'nullable|string|max:64',
            'payment_type' => 'nullable|string|max:64',
            'delivery_location' => 'nullable|string|max:255',
            'expected_delivery_date' => 'nullable|date',
            'physical_inspection' => 'nullable|boolean',
            'supplier_type' => 'nullable|string|max:128',
            'currency' => 'nullable|string|max:8',
            'exchange_rate' => 'nullable|numeric|min:0',
            'inco_term' => 'nullable|string|max:16',
            'port_of_loading' => 'nullable|string|max:128',
            'port_of_discharge' => 'nullable|string|max:128',
            'final_destination' => 'nullable|string|max:128',
            'country_of_origin' => 'nullable|string|max:128',
            'purchase_order_id' => 'nullable|integer',
            'vendor_id' => 'nullable|integer',
            'total_paid' => 'nullable|numeric|min:0',
            'shipping_charges' => 'nullable|numeric|min:0',
            'packaging_charges' => 'nullable|numeric|min:0',
            'other_charges' => 'nullable|numeric|min:0',
            'attachment_path' => 'nullable|string|max:255',
            'items' => 'array',
            'items.*.product_id' => 'nullable|integer',
            'items.*.product_code' => 'nullable|string|max:64',
            'items.*.pi_product_name' => 'nullable|string|max:255',
            'items.*.pi_quantity' => 'nullable|numeric|min:0',
            'items.*.po_product_name' => 'nullable|string|max:255',
            'items.*.po_quantity' => 'nullable|numeric|min:0',
            'items.*.rate_po' => 'nullable|numeric|min:0',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.quantity' => 'nullable|numeric|min:0',
            'items.*.hsn_code' => 'nullable|string|max:32',
            'items.*.rate' => 'nullable|numeric|min:0',
            'items.*.gst_pct' => 'nullable|numeric|min:0|max:100',
        ]);

        $user = $request->user();

        // Resolve the linked PO (preferred) — carries supplier + all context.
        $v['_po'] = null;
        $v['_vendor'] = null;
        $v['_supplierStateCode'] = '27';

        if (!empty($v['purchase_order_id'])) {
            $q = PurchaseOrder::query();
            $this->applyScope($q, $user, null);
            $po = $q->find($v['purchase_order_id']);
            if ($po) {
                $v['_po'] = $po;
                if ($po->vendor_id) {
                    $vendor = Vendor::with('primaryAddress')->forUser($user, null)->find($po->vendor_id);
                    if ($vendor) {
                        $v['_vendor'] = $vendor;
                        $v['_supplierStateCode'] = optional($vendor->primaryAddress)->state_code ?: '27';
                    }
                }
            } else {
                $v['purchase_order_id'] = null;
            }
        }

        // Direct SPI (no PO): resolve the supplier straight from vendor_id.
        if (!$v['_po'] && !empty($v['vendor_id'])) {
            $vendor = Vendor::with('primaryAddress')->forUser($user, null)->find($v['vendor_id']);
            if ($vendor) {
                $v['_vendor'] = $vendor;
                $v['_supplierStateCode'] = optional($vendor->primaryAddress)->state_code ?: '27';
            } else {
                $v['vendor_id'] = null;
            }
        }

        // Intra- vs inter-state: compare the vendor's state against THIS tenant's
        // own registered home state (branch GST state code), not a hardcoded '27'.
        $v['_intra'] = (string) $v['_supplierStateCode'] === (string) $this->homeStateCode($user->branch_id);
        return $v;
    }

    private function buildHeader($user, array $data): array
    {
        $po = $data['_po'] ?? null;
        $vendor = $data['_vendor'] ?? null;

        return [
            'invoice_no' => $data['invoice_no'] ?? null,
            'invoice_date' => $data['invoice_date'] ?? now()->toDateString(),
            'document_type' => $data['document_type'] ?? ($po?->document_type ?? 'Domestics'),
            'po_type' => $data['po_type'] ?? $po?->po_type,
            // Basic details — captured directly for Direct SPIs, else inherited from the PO.
            'mode_of_transport' => $data['mode_of_transport'] ?? $po?->mode_of_transport,
            'payment_type' => $data['payment_type'] ?? $po?->payment_type,
            'delivery_location' => $data['delivery_location'] ?? $po?->delivery_location,
            'expected_delivery_date' => $data['expected_delivery_date'] ?? $po?->expected_delivery_date,
            'physical_inspection' => $data['physical_inspection'] ?? (bool) ($po?->physical_inspection ?? false),
            // International extras
            'currency' => $data['currency'] ?? $po?->currency_code,
            'exchange_rate' => $data['exchange_rate'] ?? $po?->exchange_rate,
            'inco_term' => $data['inco_term'] ?? $po?->inco_term,
            'port_of_loading' => $data['port_of_loading'] ?? $po?->port_of_loading,
            'port_of_discharge' => $data['port_of_discharge'] ?? $po?->port_of_discharge,
            'final_destination' => $data['final_destination'] ?? $po?->final_destination,
            'country_of_origin' => $data['country_of_origin'] ?? $po?->country_of_origin,
            'attachment_path' => $data['attachment_path'] ?? null,

            'purchase_order_id' => $po?->id,
            'po_code' => $po?->code,

            'vendor_id' => $vendor?->id ?? $po?->vendor_id,
            'supplier_code' => $vendor?->vendor_code ?? $po?->supplier_code,
            'supplier_name' => $vendor ? ($vendor->company_name ?: $vendor->legal_name) : $po?->supplier_name,
            'supplier_type' => $data['supplier_type'] ?? optional($vendor?->vendorType)->name,

            'shipment_order_id' => $po?->shipment_order_id,
            'shipment_code' => $po?->shipment_code,
            'proforma_invoice_id' => $po?->proforma_invoice_id,
            'pi_number' => $po?->pi_number,
            'opportunity_id' => $po?->opportunity_id,
            'opportunity_code' => $po?->opportunity_code,
            'customer_name' => $po?->customer_name,
            'consignee_name' => $po?->consignee_name,

            'total_po_amount' => (float) ($po?->grand_total ?? 0),
            'total_paid' => (float) ($data['total_paid'] ?? 0),
        ];
    }

    private function syncItems(SupplierPurchaseInvoice $spi, array $items, bool $intra): void
    {
        $line = 0;
        foreach ($items as $it) {
            $qty = (float) ($it['quantity'] ?? 0);
            $rate = (float) ($it['rate'] ?? 0);
            $gst = (float) ($it['gst_pct'] ?? 0);
            // Intra-state (home 27) → CGST + SGST (each gst/2). Inter-state → single IGST (full gst).
            $cgstP = $intra ? $gst / 2 : 0;
            $sgstP = $intra ? $gst / 2 : 0;
            $igstP = $intra ? 0 : $gst;
            $base = $qty * $rate;
            $cgstA = $base * $cgstP / 100;
            $sgstA = $base * $sgstP / 100;
            $igstA = $base * $igstP / 100;

            $poQty = isset($it['po_quantity']) && $it['po_quantity'] !== '' ? (float) $it['po_quantity'] : null;

            SupplierPurchaseInvoiceItem::create([
                'supplier_purchase_invoice_id' => $spi->id,
                'product_id' => $it['product_id'] ?? null,
                'product_code' => $it['product_code'] ?? null,
                'pi_product_name' => $it['pi_product_name'] ?? null,
                'pi_quantity' => isset($it['pi_quantity']) && $it['pi_quantity'] !== '' ? (float) $it['pi_quantity'] : null,
                'po_product_name' => $it['po_product_name'] ?? null,
                'po_quantity' => $poQty,
                'rate_po' => (float) ($it['rate_po'] ?? 0),
                'product_name' => $it['product_name'] ?? null,
                'quantity' => $qty,
                'missing_qty' => $poQty !== null ? round($poQty - $qty, 4) : 0,
                'hsn_code' => $it['hsn_code'] ?? null,
                'rate' => $rate,
                'gst_pct' => $gst,
                'cgst_pct' => $cgstP,
                'sgst_pct' => $sgstP,
                'igst_pct' => $igstP,
                'cgst_amount' => round($cgstA, 2),
                'sgst_amount' => round($sgstA, 2),
                'igst_amount' => round($igstA, 2),
                'cost' => round($base + $cgstA + $sgstA + $igstA, 2),
                'line_no' => ++$line,
            ]);
        }
    }

    private function recomputeTotals(SupplierPurchaseInvoice $spi, array $data): void
    {
        $items = $spi->items()->get();
        $prod = (float) $items->sum('cost');
        $cgst = (float) $items->sum('cgst_amount');
        $sgst = (float) $items->sum('sgst_amount');
        $igst = (float) $items->sum('igst_amount');
        $addl = (float) ($data['shipping_charges'] ?? 0) + (float) ($data['packaging_charges'] ?? 0) + (float) ($data['other_charges'] ?? 0);
        $paid = (float) ($data['total_paid'] ?? 0);
        $net = round($prod + $addl, 2);
        $spi->update([
            'total_product_cost' => round($prod, 2),
            'total_cgst' => round($cgst, 2),
            'total_sgst' => round($sgst, 2),
            'total_igst' => round($igst, 2),
            'additional_charges' => round($addl, 2),
            'net_payable' => $net,
            'total_paid' => round($paid, 2),
            'balance' => round($net - $paid, 2),
        ]);
    }

    private function shapeListRow(SupplierPurchaseInvoice $spi): array
    {
        // Payment figures: a With-PO SPI is paid THROUGH its linked PO (po_payments),
        // so its paid/balance/net-payable must reflect the PO's post-TDS state — not
        // the SPI's static columns (which stay 0). A Direct SPI keeps its own columns
        // (SpiPaymentController updates them on each payment).
        if ($spi->purchase_order_id) {
            $po = DB::table('purchase_orders')->where('id', $spi->purchase_order_id)->first();
            $netPayable = $po ? round((float) $po->grand_total - (float) ($po->tds_amount ?? 0), 2) : (float) $spi->net_payable;
            $totalPaid  = round((float) \App\Models\PoPayment::where('purchase_order_id', $spi->purchase_order_id)->sum('amount'), 2);
            $balance    = round($netPayable - $totalPaid, 2);
        } else {
            $netPayable = round((float) $spi->net_payable - (float) $spi->tds_amount, 2);
            $totalPaid  = (float) $spi->total_paid;
            $balance    = (float) $spi->balance;
        }

        return [
            'id' => $spi->id,
            'vendor_id' => $spi->vendor_id,
            'spiNo' => $spi->code,
            'spiDate' => optional($spi->invoice_date)->toDateString(),
            'invoice_no' => $spi->invoice_no,
            'poId' => $spi->purchase_order_id,   // linked PO — drives "pay PO from SPI"
            'poNo' => $spi->po_code,
            'poType' => $spi->po_type,
            'doc' => $spi->document_type,
            'shipId' => $spi->shipment_code,
            'piNo' => $spi->pi_number,
            'procId' => $spi->procurement_code,
            'customer' => $spi->customer_name,
            'supCode' => $spi->supplier_code,
            'supplier' => $spi->supplier_name,
            // "Total PO Amount": a With-PO SPI shows the linked PO's amount; a
            // Direct SPI has no PO, so its own grand total (net_payable = product
            // cost + additional charges, pre-TDS) IS the total to show — otherwise
            // the column reads ₹0.
            'totalPo' => $spi->purchase_order_id
                ? (float) $spi->total_po_amount
                : (float) $spi->net_payable,
            'netPayable' => $netPayable,
            'totalPaid' => $totalPaid,
            'balance' => $balance,
            'attach' => $spi->attachment_path,
            'zoho' => $spi->zoho_status === 'Sync' ? 'sync' : 'not',
            'zohoBill' => $spi->zoho_bill_number,       // Zoho Books bill no. once synced
            'zohoPdf' => $spi->zoho_pdf_path ? true : false,
            'status' => $spi->status,
            // This SPI's payable amount fully utilised — gates the Zoho sync button.
            'po_fully_utilized' => $this->spiSyncUtilized($spi),
        ];
    }

    private function shapeDetail(SupplierPurchaseInvoice $spi): array
    {
        // For a With-PO SPI: qty already invoiced by OTHER (non-deleted) SPIs on
        // the same PO, per product — so the edit view's "Missing" reflects the
        // TRUE remaining across all invoices, not just this one.
        $otherInvoiced = collect();
        if ($spi->purchase_order_id) {
            $otherInvoiced = DB::table('supplier_purchase_invoice_items as spii')
                ->join('supplier_purchase_invoices as s', 's.id', '=', 'spii.supplier_purchase_invoice_id')
                ->where('s.purchase_order_id', $spi->purchase_order_id)
                ->where('s.id', '!=', $spi->id)
                ->whereNull('s.deleted_at')
                ->whereNotNull('spii.product_id')
                ->groupBy('spii.product_id')
                ->selectRaw('spii.product_id, SUM(spii.quantity) as qty')
                ->pluck('qty', 'spii.product_id');
        }

        return array_merge($this->shapeListRow($spi), [
            'purchase_order_id' => $spi->purchase_order_id,
            'shipment_order_id' => $spi->shipment_order_id,
            'proforma_invoice_id' => $spi->proforma_invoice_id,
            'opportunity_id' => $spi->opportunity_id,
            'opportunity_code' => $spi->opportunity_code,
            'consignee_name' => $spi->consignee_name,
            'invoice_date' => optional($spi->invoice_date)->toDateString(),
            'attachment_path' => $spi->attachment_path,
            // TDS deducted → the wizard locks this invoice read-only.
            'tds_cut' => (bool) $spi->tds_cut,
            // Basic Purchase Order Details (for the edit form's Step 1)
            'po_type' => $spi->po_type,
            'document_type' => $spi->document_type,
            'mode_of_transport' => $spi->mode_of_transport,
            'payment_type' => $spi->payment_type,
            'delivery_location' => $spi->delivery_location,
            'expected_delivery_date' => optional($spi->expected_delivery_date)->toDateString(),
            'physical_inspection' => (bool) $spi->physical_inspection,
            'currency' => $spi->currency,
            'exchange_rate' => $spi->exchange_rate !== null ? (float) $spi->exchange_rate : null,
            'inco_term' => $spi->inco_term,
            'port_of_loading' => $spi->port_of_loading,
            'port_of_discharge' => $spi->port_of_discharge,
            'final_destination' => $spi->final_destination,
            'country_of_origin' => $spi->country_of_origin,
            'supplier_type' => $spi->supplier_type,
            // Full supplier detail so the Step-1 supplier section can re-render.
            'supplier_detail' => $this->supplierDetail(auth()->user(), $spi->vendor_id),
            'total_product_cost' => (float) $spi->total_product_cost,
            'total_cgst' => (float) $spi->total_cgst,
            'total_sgst' => (float) $spi->total_sgst,
            'total_igst' => (float) $spi->total_igst,
            'additional_charges' => (float) $spi->additional_charges,
            'items' => $spi->items->map(fn ($it) => [
                'id' => $it->id,
                'product_id' => $it->product_id,
                'code' => $it->product_code,
                'piName' => $it->pi_product_name,
                'piQty' => $it->pi_quantity !== null ? (float) $it->pi_quantity : null,
                'poName' => $it->po_product_name,
                'poQty' => $it->po_quantity !== null ? (float) $it->po_quantity : null,
                // Qty invoiced by OTHER SPIs on this PO → drives the true "Missing" on edit.
                'invoiced' => $it->product_id ? (float) ($otherInvoiced[$it->product_id] ?? 0) : 0,
                'ratePo' => (float) $it->rate_po,
                'name' => $it->product_name,
                'qty' => (float) $it->quantity,
                'missing' => (float) $it->missing_qty,
                'hsn' => $it->hsn_code,
                'rate' => (float) $it->rate,
                'gst' => (float) $it->gst_pct,
                'cgstA' => (float) $it->cgst_amount,
                'sgstA' => (float) $it->sgst_amount,
                'igstA' => (float) $it->igst_amount,
                'cost' => (float) $it->cost,
            ])->all(),
        ]);
    }

    /* ── Sequential SPI code (per client + FY, locked) ── */

    private function peekCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        return "SPI/{$fy}/" . str_pad((string) ($this->maxSeq($clientId, $fy) + 1), 3, '0', STR_PAD_LEFT);
    }

    private function nextCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("spi-code:{$clientId}:{$fy}")]);
        }
        // withTrashed: the unique(client_id, code) index also covers soft-deleted rows,
        // so a reused code would collide. Skip codes held by trashed invoices too.
        $codes = SupplierPurchaseInvoice::withTrashed()->where('client_id', $clientId)->where('code', 'like', "SPI/{$fy}/%")->pluck('code')->all();
        $taken = [];
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('#^SPI/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do { $n++; $code = "SPI/{$fy}/" . str_pad((string) $n, 3, '0', STR_PAD_LEFT); } while (isset($taken[$code]));
        return $code;
    }

    private function maxSeq(int $clientId, string $fy): int
    {
        $max = 0;
        foreach (SupplierPurchaseInvoice::withTrashed()->where('client_id', $clientId)->where('code', 'like', "SPI/{$fy}/%")->pluck('code') as $c) {
            if (preg_match('#^SPI/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return $max;
    }

    private function currentFinancialYear(): string
    {
        $now = now();
        $startYear = (int) $now->format('Y');
        if ((int) $now->format('n') < 4) $startYear -= 1;
        $endShort = str_pad((string) (($startYear + 1) % 100), 2, '0', STR_PAD_LEFT);
        return "{$startYear}-{$endShort}";
    }

    /* ── Tenant / branch scope (mirrors PurchaseOrderController) ── */

    /**
     * This tenant's own registered GST state code for the intra- vs inter-state
     * (CGST/SGST vs IGST) decision. From the branch's `gst_state_code`, deriving
     * from its GSTIN when blank; '27' only if no GST state is captured at all.
     */
    private function homeStateCode(?int $branchId): string
    {
        $branch = $branchId ? \App\Models\Branch::find($branchId) : null;
        $code = optional($branch)->gst_state_code ?: substr((string) optional($branch)->gst_number, 0, 2);
        return $code !== '' && $code !== null ? (string) $code : '27';
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }
        if (!$user->client_id) { $q->whereRaw('1 = 0'); return; }
        $q->where('client_id', $user->client_id);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) {
            if ($branchFilter !== null) {
                $ok = \App\Models\Branch::where('id', $branchFilter)->where('client_id', $user->client_id)->exists();
                if ($ok) $q->where('branch_id', $branchFilter);
            }
            return;
        }
        $q->where('branch_id', $user->branch_id);
    }

    private function assertScope($row, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;
        abort(404);
    }
}
