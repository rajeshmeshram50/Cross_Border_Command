<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Vendor;
use App\Models\ShipmentOrder;
use App\Services\ZohoBooksService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Purchase Order API (P2P → Procurement).
 *
 * Conventions mirror QuotationController: per-method tenant guard off the
 * Sanctum user, inline validation, per-client sequential code allocated under
 * a clients row-lock + Postgres advisory lock, branch-aware read scope, and
 * `{status, data, pagination}` responses. Dropdown values sourced from masters
 * (warehouse, currency) are stored as their master id with a cached label.
 */
class PurchaseOrderController extends Controller
{
    /* ══════════════════════════ LIST ══════════════════════════ */

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        // withSum → per-row payment total in one query (shapeListRow reads it to
        // compute the "fully utilised" flag without an N+1 per-row sum).
        $q = PurchaseOrder::query()
            ->withSum('payments as paid_sum', 'amount')
            ->withCount('supplierPurchaseInvoices as spi_count')
            ->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        // Tab: with / without shipment id
        $tab = $request->query('tab');
        if ($tab === 'with')    $q->whereNotNull('shipment_order_id');
        if ($tab === 'without') $q->whereNull('shipment_order_id');

        if ($doc = $request->query('document_type')) $q->where('document_type', $doc);
        if ($type = $request->query('po_type'))      $q->where('po_type', $type);

        if ($term = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($term) {
                $w->where('code', 'like', "%{$term}%")
                    ->orWhere('supplier_name', 'like', "%{$term}%")
                    ->orWhere('supplier_code', 'like', "%{$term}%")
                    ->orWhere('shipment_code', 'like', "%{$term}%")
                    ->orWhere('customer_name', 'like', "%{$term}%")
                    ->orWhere('po_type', 'like', "%{$term}%")
                    ->orWhere('document_type', 'like', "%{$term}%");
            });
        }

        $perPage = min(max((int) $request->query('per_page', 10), 1), 200);
        $paginator = $q->paginate($perPage, ['*'], 'page', max(1, (int) $request->query('page', 1)));

        return response()->json([
            'status' => true,
            'data' => collect($paginator->items())->map(fn ($po) => $this->shapeListRow($po))->all(),
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
        $po = PurchaseOrder::with('items')->findOrFail($id);
        $this->assertScope($po, $user);
        return response()->json(['status' => true, 'data' => $this->shapeDetail($po)]);
    }

    /* ══════════════════════════ CREATE ══════════════════════════ */

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);
        $this->assertWithinPiAllocation($data, null);

        $po = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode($user->client_id);

            $header = $this->buildHeader($user, $data);
            $header['client_id'] = $user->client_id;
            $header['branch_id'] = $user->branch_id;            // stamped from user, never the request
            $header['code'] = $code;
            $header['created_by'] = $user->id;
            $header['updated_by'] = $user->id;

            $po = PurchaseOrder::create($header);
            $this->syncItems($po, $data['items'] ?? [], $data['_intra'], $header);
            $this->recomputeTotals($po, $data);
            return $po;
        });

        return response()->json(['status' => true, 'data' => $this->shapeDetail($po->fresh('items'))], 201);
    }

    /* ══════════════════════════ UPDATE ══════════════════════════ */

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = PurchaseOrder::findOrFail($id);
        $this->assertScope($po, $user, 'write');

        // Once a PO is pushed to Zoho Books it is locked — editing it here would
        // silently drift from the Zoho copy. Mirrors the disabled Edit button.
        if (!empty($po->zoho_purchaseorder_id)) {
            return response()->json([
                'status' => false,
                'message' => 'This PO is locked — it has already been synced to Zoho Books and can no longer be edited.',
            ], 422);
        }

        // Once a PO is out for e-signature (or already signed) its content is
        // frozen — editing after signers have the document would invalidate it.
        if ($po->status === 'Sent for Sign' || $this->isPoSigned($po)) {
            return response()->json([
                'status' => false,
                'message' => 'This PO has been sent for signature and can no longer be edited.',
            ], 422);
        }

        // Once a supplier invoice (SPI) is mapped to this PO, the PO is frozen —
        // the invoice was reconciled against these figures.
        if ($po->supplierPurchaseInvoices()->exists()) {
            return response()->json([
                'status' => false,
                'message' => 'This PO has a supplier invoice mapped to it and can no longer be edited.',
            ], 422);
        }

        $data = $this->validatePayload($request);
        $this->assertWithinPiAllocation($data, $po->id);

        DB::transaction(function () use ($po, $user, $data) {
            $header = $this->buildHeader($user, $data);
            $header['updated_by'] = $user->id;
            $po->update($header);
            $po->items()->delete();
            $this->syncItems($po, $data['items'] ?? [], $data['_intra'], $header);
            $this->recomputeTotals($po, $data);
        });

        return response()->json(['status' => true, 'data' => $this->shapeDetail($po->fresh('items'))]);
    }

    /* ══════════════════════════ DELETE ══════════════════════════ */

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = PurchaseOrder::findOrFail($id);
        $this->assertScope($po, $user, 'write');
        // A PO already pushed to Zoho Books can't be deleted locally — doing so
        // would orphan the Zoho record and re-free its ordered qty for other POs.
        if ($po->zoho_purchaseorder_id) {
            return response()->json([
                'status' => false,
                'message' => 'This PO is synced to Zoho Books and can no longer be deleted.',
            ], 422);
        }
        $po->delete();
        return response()->json(['status' => true]);
    }

    /* ══════════════════════════ ZOHO SYNC ══════════════════════════ */

    /**
     * Push this PO into Zoho Books (org from config) and remember the Zoho id.
     *
     * Idempotent: a PO that already carries a zoho_purchaseorder_id is never
     * pushed twice. On any Zoho error the PO stays "Not Sync" with the upstream
     * message saved to zoho_error and returned as a truthful 422, so the UI can
     * show what actually went wrong instead of a fake success.
     */
    public function sync(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = PurchaseOrder::with('items')->findOrFail($id);
        $this->assertScope($po, $user, 'write');

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) {
            return response()->json([
                'status' => false,
                'message' => 'Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again.',
            ], 503);
        }

        // Serialize concurrent syncs of the SAME PO — a double-submit must not
        // create two Zoho purchase orders.
        $lock = \Illuminate\Support\Facades\Cache::lock('zoho:sync:po:' . $po->id, 120);
        if (!$lock->get()) {
            return response()->json(['status' => false, 'message' => 'A Zoho sync for this purchase order is already in progress — try again in a moment.'], 409);
        }
        try {

        if (!empty($po->zoho_purchaseorder_id)) {
            return response()->json([
                'status' => true,
                'message' => 'This PO is already synced with Zoho Books.',
                'data' => $this->shapeListRow($po),
            ]);
        }
        if (!$po->vendor_id) {
            return response()->json(['status' => false, 'message' => 'Attach a supplier to this PO before syncing to Zoho Books.'], 422);
        }
        if ($po->items->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'Add at least one product line before syncing to Zoho Books.'], 422);
        }
        // The full PO amount must be utilised (all payments recorded so the
        // net-payable balance is cleared) before the PO is pushed to Zoho Books.
        // Only CLEARED payments count — an uncleared/Pending cheque must never
        // satisfy the gate (else Zoho would receive a payment for money not yet
        // received).
        $paid = (float) $po->payments()->where('status', 'Cleared')->sum('amount');
        $netPayable = round((float) $po->grand_total - (float) $po->tds_amount, 2);
        if (!($netPayable > 0.005 && round($netPayable - $paid, 2) <= 0.005)) {
            return response()->json([
                'status'  => false,
                'message' => 'Utilise the full PO amount first — record payments until the outstanding balance is cleared before syncing to Zoho Books.',
                'errors'  => ['amount' => ['The PO amount must be fully utilised before syncing.']],
            ], 422);
        }

        try {
            $vendor = Vendor::with('primaryAddress')->findOrFail($po->vendor_id);
            $gstin = DB::table('vendor_gst_scrutiny')->where('vendor_id', $vendor->id)->latest('id')->value('gst_number') ?: null;
            $stateCode = optional($vendor->primaryAddress)->state_code;

            // Intra- vs inter-state decides GST(CGST+SGST) vs IGST in Zoho.
            // Prefer the Zoho org's own state; fall back to this tenant's home state.
            $orgState = $books->orgStateCode() ?: $this->homeStateCode($po->branch_id);
            $interState = $stateCode && (string) $stateCode !== (string) $orgState;

            $zohoVendorId = $books->findOrCreateVendorId($vendor, $gstin, $stateCode);
            $created = $books->createPurchaseOrder($this->buildZohoPayload($po, $books, $zohoVendorId, (bool) $gstin, $interState));
            $zohoId = (string) $created['purchaseorder_id'];

            // Cache Zoho's own rendered PDF — best-effort; a PDF hiccup must not
            // undo an otherwise-successful sync.
            $pdfPath = null;
            try {
                $rel = 'zoho/po/' . $po->client_id . '/PO-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($po->code ?: $po->id)) . '.pdf';
                Storage::disk('public')->put($rel, $books->getPurchaseOrderPdf($zohoId));
                $pdfPath = '/storage/' . $rel;
            } catch (\Throwable $e) {
                Log::warning('Zoho PO PDF cache failed', ['po' => $po->id, 'err' => $e->getMessage()]);
            }

            $po->update([
                'zoho_status' => 'Sync',
                'zoho_purchaseorder_id' => $zohoId,
                'zoho_synced_at' => now(),
                'zoho_error' => null,
                'zoho_pdf_path' => $pdfPath,
                'updated_by' => $user->id,
            ]);

            // Reconcile totals — log (don't fail) when Zoho's total drifts from ours.
            $delta = abs((float) ($created['total'] ?? 0) - (float) $po->grand_total);
            if ($delta > 1.0) {
                Log::warning('Zoho PO total mismatch', [
                    'po' => $po->code, 'local' => (float) $po->grand_total, 'zoho' => (float) ($created['total'] ?? 0),
                ]);
            }

            return response()->json([
                'status' => true,
                'message' => 'Synced to Zoho Books (' . ($created['purchaseorder_number'] ?? $zohoId) . ').',
                'data' => $this->shapeListRow($po->fresh()),
            ]);
        } catch (RuntimeException $e) {
            $po->update(['zoho_status' => 'Not Sync', 'zoho_error' => $e->getMessage(), 'updated_by' => $user->id]);
            return response()->json(['status' => false, 'message' => $e->getMessage()], 422);
        }

        } finally {
            $lock->release();
        }
    }

    /**
     * Send this Purchase Order's PDF to the supplier for e-signature via Zoho
     * Sign. Mirrors ClmSignatureController::ctcSend for a single rendered PDF
     * and one signer (the mapped supplier), persisting a purchase_order-tagged
     * ClmSignatureRequest so the existing Zoho Sign webhook flips it to
     * 'completed' on sign — which is what gates the Zoho Books sync above.
     */
    public function sendForSignature(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = PurchaseOrder::with('items')->findOrFail($id);
        $this->assertScope($po, $user, 'write');

        // Note: the PO PDF can be sent for signature at any time — the TDS
        // deduction is NOT a prerequisite here. (TDS is still cut once in the PO
        // Payment screen before any payment can be recorded; see PoPaymentController.)

        $zoho = app(\App\Services\ZohoSignService::class);
        if (!$zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured. Contact your administrator.'], 503);
        }
        if (!$po->vendor_id) {
            return response()->json(['status' => false, 'message' => 'Attach a supplier to this PO before sending it for signature.'], 422);
        }

        $data = $request->validate([
            'signers'           => 'nullable|array|max:1',
            'signers.*.name'    => 'required_with:signers|string|max:255',
            'signers.*.email'   => 'required_with:signers|email|max:255',
            'expiry_days'       => 'nullable|integer|min:1|max:90',
            'is_sequential'     => 'nullable|boolean',
            'notes'             => 'nullable|string|max:1000',
            'document_settings' => 'nullable|array',
        ]);

        $vendor = Vendor::with('primaryAddress')->find($po->vendor_id);
        // Signer: the supplied one, else the supplier's primary contact.
        $signerName  = $data['signers'][0]['name'] ?? (optional($vendor?->primaryAddress)->contact_name ?: ($vendor?->company_name ?: 'Supplier'));
        $signerEmail = strtolower((string) ($data['signers'][0]['email'] ?? (optional($vendor?->primaryAddress)->email ?: ($vendor?->primary_email ?? ''))));
        if (!$signerEmail || !filter_var($signerEmail, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['status' => false, 'message' => 'No valid email for this supplier. Set a primary contact email on the supplier first.'], 422);
        }
        $signers = [['name' => (string) $signerName, 'email' => $signerEmail, 'role' => 'supplier', 'order' => 1]];

        $tempPaths = [];
        try {
            // PO PDF rendered WITH the org signature; the supplier's dragged
            // signature box is added on top when submitted to Zoho.
            $pdfBytes = app(SalesPdfController::class)->renderPoPdfBytes($po, true, $vendor);
            $tmp = storage_path('app/temp/' . \Illuminate\Support\Str::uuid()->toString() . '.pdf');
            if (!is_dir(dirname($tmp))) @mkdir(dirname($tmp), 0775, true);
            file_put_contents($tmp, $pdfBytes);
            $tempPaths[] = $tmp;

            $expiryDays  = min(90, max(1, (int) ($data['expiry_days'] ?? 30)));  // Zoho caps expiration_days at 2 digits
            $requestName = 'Purchase Order ' . ($po->code ?: $po->id);
            $requestBody = ['requests' => [
                'request_name'    => $requestName,
                'is_sequential'   => (bool) ($data['is_sequential'] ?? false),
                'expiration_days' => $expiryDays,
                'notes'           => (string) ($data['notes'] ?? 'Please review and sign this purchase order.'),
                'actions'         => [[
                    'recipient_email'  => $signerEmail,
                    'recipient_name'   => (string) $signerName,
                    'action_type'      => 'SIGN',
                    'signing_order'    => 1,
                    'verify_recipient' => false,
                ]],
            ]];
            $filenames = [\Illuminate\Support\Str::slug($requestName) ?: ('po_' . $po->id)];

            $createResp    = $zoho->createRequestMultipart([$tmp], $filenames, $requestBody);
            $zohoRequestId = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));

            $details         = $zoho->getRequest($zohoRequestId);
            $zohoActions     = data_get($details, 'requests.actions', []);
            $zohoDocumentIds = data_get($details, 'requests.document_ids', []);
            foreach ($zohoActions as &$za) { $za['cbc_role'] = 'supplier'; } // harmless for the flat single-box shape
            unset($za);

            // Single doc → single coord entry. document_settings is keyed by the
            // PO id (the synthetic doc id the SPA drags), value {x,y,page,width,height}.
            $clientCoords   = (array) ($data['document_settings'] ?? []);
            $settings       = $clientCoords[$po->id] ?? $clientCoords[(string) $po->id] ?? [];
            $firstZohoDocId = data_get($zohoDocumentIds, '0.document_id');
            $perDocCoords   = ($firstZohoDocId && is_array($settings) && $settings) ? [$firstZohoDocId => $settings] : [];

            $submitResp  = $zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $finalStatus = 'inprogress';
            if (isset($submitResp['requests'])) {
                try {
                    sleep(1);
                    $after = $zoho->getRequest($zohoRequestId);
                    $finalStatus = strtolower((string) data_get($after, 'requests.request_status', 'inprogress'));
                } catch (\Throwable $e) { $finalStatus = 'inprogress'; }
            }

            $sigReq = new \App\Models\ClmSignatureRequest();
            $sigReq->client_id         = $po->client_id;
            $sigReq->branch_id         = $po->branch_id ?? ($user->branch_id ?? null);
            $sigReq->document_type     = \App\Models\ClmSignatureRequest::DOC_PURCHASE_ORDER;
            $sigReq->trade_doc_id      = $po->id;
            $sigReq->trade_doc_ids     = [$po->id];
            $sigReq->document_names    = [$requestName];
            $sigReq->zoho_document_ids = array_values(array_filter(array_map(fn ($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
            $sigReq->model_name        = 'Vendor';
            $sigReq->party_id          = $po->vendor_id;
            $sigReq->zoho_request_id   = $zohoRequestId;
            $sigReq->request_name      = $requestName;
            $sigReq->status            = $finalStatus;
            $sigReq->signers           = $signers;
            $sigReq->expiry_date       = now()->addDays($expiryDays);
            $sigReq->metadata          = [
                'document_type'     => \App\Models\ClmSignatureRequest::DOC_PURCHASE_ORDER,
                'purchase_order_id' => $po->id,
                'po_code'           => $po->code,
                'document_settings' => $data['document_settings'] ?? null,
                'sent_at'           => now()->toIso8601String(),
            ];
            $sigReq->created_by = $user->id;
            $sigReq->save();

            // Reflect the send on the PO row so the list shows "Sent for Sign".
            $po->update(['status' => 'Sent for Sign', 'updated_by' => $user->id]);

            $message = 'Purchase order sent for signature via Zoho Sign.';
            if ($zoho->isTestingMode()) $message .= ' (Sandbox mode — signer emails are only delivered to Zoho Sign users on this org.)';

            return response()->json(['status' => true, 'message' => $message, 'data' => [
                'signature_request_id' => $sigReq->id,
                'zoho_request_id'      => $zohoRequestId,
                'status'               => $finalStatus,
                'signers'              => $signers,
                'expiry_date'          => $sigReq->expiry_date,
            ]]);
        } catch (\Throwable $e) {
            Log::error('PO send-for-signature failed', ['error' => $e->getMessage(), 'po' => $po->id]);
            return response()->json(['status' => false, 'message' => 'Failed to send for signature: ' . $e->getMessage()], 500);
        } finally {
            foreach ($tempPaths as $p) @unlink($p);
        }
    }

    /**
     * True when this PO has a completed Zoho-Sign signature request.
     *
     * Two send paths produce a signed PO:
     *  - Direct send (sendForSignature above): a `purchase_order`-typed request
     *    whose trade_doc_id holds the PO id.
     *  - Bundled send (ClmSignatureController@send): the PO PDF rides inside a
     *    `trade_doc` request alongside CLM trade documents; the PO appears
     *    nowhere in trade_doc_ids and is resolved via metadata.purchase_order_id
     *    — the same key the Trade Documents modal uses to mark the PO row
     *    "Signed". Missing this case made the modal say Signed while the Zoho
     *    Books sync still demanded "Sign the PO first".
     */
    private function isPoSigned(PurchaseOrder $po): bool
    {
        return \App\Models\ClmSignatureRequest::query()
            ->where('client_id', $po->client_id)
            ->where('status', 'completed')
            ->where(function ($q) use ($po) {
                $q->where(function ($direct) use ($po) {
                    $direct->where('document_type', \App\Models\ClmSignatureRequest::DOC_PURCHASE_ORDER)
                        ->where('trade_doc_id', $po->id);
                })
                // JSON ->> yields text in Postgres, so bind the id as a string.
                ->orWhere('metadata->purchase_order_id', (string) $po->id);
            })
            ->exists();
    }

    /**
     * Build the Zoho Books purchase-order payload from a local PO + its items.
     * Forward GST is only attached when the supplier is GST-registered; for an
     * unregistered supplier Zoho rejects forward tax (reverse-charge rule), so
     * lines go in tax-free and the tax delta is logged during reconciliation.
     */
    private function buildZohoPayload(PurchaseOrder $po, ZohoBooksService $books, string $zohoVendorId, bool $registered, bool $interState = false): array
    {
        $lineItems = $po->items->map(function ($it) use ($books, $registered, $interState) {
            $name = (string) ($it->product_name ?: $it->product_code ?: 'Item');
            // Effective tax the app ACTUALLY applied (covers the Maharashtra
            // intra-state 9+9 override, not just the nominal gst_pct) so Zoho's
            // recomputed total reconciles with ours — registered vendors only.
            $taxId = $registered ? $books->resolveTaxId((float) $it->cgst_pct + (float) $it->sgst_pct, $interState) : null;
            $line = [
                // Zoho POs need a purchasable item id, not a free-text line.
                'item_id' => $books->findOrCreateItemId($name, (float) $it->rate, $taxId, $it->product_id),
                'name' => $name,
                'description' => (string) $it->product_code,
                'rate' => (float) $it->rate,
                'quantity' => (float) $it->quantity,
            ];
            if ($taxId) $line['tax_id'] = $taxId;
            return $line;
        })->values()->all();

        $payload = [
            'vendor_id' => $zohoVendorId,
            'date' => optional($po->po_date)->toDateString() ?: now()->toDateString(),
            'reference_number' => (string) $po->code,
            'line_items' => $lineItems,
        ];

        if ($po->expected_delivery_date) $payload['delivery_date'] = optional($po->expected_delivery_date)->toDateString();
        if (trim((string) $po->terms) !== '') $payload['terms'] = (string) $po->terms;

        // Shipping is native; packaging + other have no native field → adjustment.
        if ((float) $po->shipping_charges != 0.0) $payload['shipping_charge'] = (float) $po->shipping_charges;
        $adjustment = (float) $po->packaging_charges + (float) $po->other_charges;
        if ($adjustment != 0.0) {
            $payload['adjustment'] = $adjustment;
            $payload['adjustment_description'] = 'Packaging & other charges';
        }

        // Currency (INR = org base, omitted); send exchange rate for non-base ccy.
        if ($ccyId = $books->resolveCurrencyId($po->currency_code)) {
            $payload['currency_id'] = $ccyId;
            if ((float) $po->exchange_rate > 0) $payload['exchange_rate'] = (float) $po->exchange_rate;
        }

        return $payload;
    }

    /* ══════════════════════════ ZOHO PDF ══════════════════════════ */

    /** Stream the cached Zoho Books PDF for a synced PO ("View in Zoho"). */
    public function zohoPdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = PurchaseOrder::findOrFail($id);
        $this->assertScope($po, $user);

        if (!$po->zoho_pdf_path) abort(404, 'No Zoho PDF cached for this PO.');
        $rel = ltrim(str_replace('/storage/', '', $po->zoho_pdf_path), '/');
        if (!Storage::disk('public')->exists($rel)) abort(404, 'Zoho PDF file missing.');

        return response(Storage::disk('public')->get($rel), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ZOHO-' . ($po->code ?: $po->id) . '.pdf"',
        ]);
    }

    /* ══════════════════════════ NEXT CODE ══════════════════════════ */

    public function previewCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $code = ($user && $user->client_id) ? $this->peekCode($user->client_id) : null;
        return response()->json(['status' => true, 'data' => ['code' => $code]]);
    }

    /* ══════════════════════════ PDF PREVIEW (unsaved form) ══════════════════════════ */

    /**
     * Render the PO PDF from the CURRENT (unsaved) wizard form data — so the
     * "View" button previews the document during Add-PO before the row exists.
     * Builds a transient PurchaseOrder + items in memory (same math as store),
     * never touches the DB, and hands off to SalesPdfController for rendering.
     */
    public function previewPdf(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);

        $header = $this->buildHeader($user, $data);
        $header['client_id'] = $user->client_id;
        $header['branch_id'] = $user->branch_id;
        $header['code'] = $request->input('code') ?: $this->peekCode($user->client_id);
        $po = new PurchaseOrder($header);

        $intra = $data['_intra'];
        $items = collect($data['items'] ?? [])->values()->map(function ($it, $i) use ($intra) {
            $qty = (float) ($it['quantity'] ?? 0);
            $rate = (float) ($it['rate'] ?? 0);
            $gst = (float) ($it['gst_pct'] ?? 0);
            // GST always splits into equal CGST + SGST halves of the item's own
            // rate (a 12% item → 6% + 6%). Intra- vs inter-state only changes the
            // LABEL (CGST/SGST vs IGST), never the amount — so never hard-code 9%.
            $cgstP = $gst / 2;
            $sgstP = $gst / 2;
            $base = $qty * $rate;
            $cgstA = $base * $cgstP / 100;
            $sgstA = $base * $sgstP / 100;
            return new PurchaseOrderItem([
                'product_id' => $it['product_id'] ?? null,
                'product_code' => $it['product_code'] ?? null,
                'pi_product_name' => $it['pi_product_name'] ?? null,
                'product_name' => $it['product_name'] ?? null,
                'quantity' => $qty,
                'rate' => $rate,
                'gst_pct' => $gst,
                'cgst_pct' => $cgstP,
                'sgst_pct' => $sgstP,
                'cgst_amount' => round($cgstA, 2),
                'sgst_amount' => round($sgstA, 2),
                'cost' => round($base + $cgstA + $sgstA, 2),
                'line_no' => $i + 1,
            ]);
        });

        $prod = (float) $items->sum('cost');
        $addl = (float) ($data['shipping_charges'] ?? 0) + (float) ($data['packaging_charges'] ?? 0) + (float) ($data['other_charges'] ?? 0);
        $po->total_product_cost = round($prod, 2);
        $po->total_cgst = round((float) $items->sum('cgst_amount'), 2);
        $po->total_sgst = round((float) $items->sum('sgst_amount'), 2);
        $po->additional_charges = round($addl, 2);
        $po->grand_total = round($prod + $addl, 2);
        $po->setRelation('items', $items);

        $vendor = $data['_vendor'] ?? null; // already loaded with primaryAddress in validatePayload
        return app(\App\Http\Controllers\Api\SalesPdfController::class)
            ->streamPoPdf($po, $request->boolean('signature', true), $vendor);
    }

    /* ══════════════════════════ SUPPLIER DROPDOWN + DETAIL ══════════════════════════ */

    /** All suppliers (vendors) for the Stage-1 "Select Supplier" dropdown. */
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

    /** Full supplier detail to auto-fill Stage 1 after a supplier is selected. */
    public function supplier(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $v = Vendor::with(['primaryAddress', 'vendorType', 'gstScrutiny' => fn ($g) => $g->latest('id')])
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->findOrFail($id);

        $a = $v->primaryAddress;
        // Newest scrutiny is the current GST status. The relation carries a
        // baked-in orderBy('id') ASC, so a `latest('id')` in the eager-load
        // closure only appends a redundant secondary sort and ->first() would
        // return the OLDEST row — sort the loaded collection to be order-safe.
        $g = $v->gstScrutiny->sortByDesc('id')->first();
        $country = $a && $a->country_id ? DB::table('master_countries')->where('id', $a->country_id)->value('name') : null;
        $state = $a && $a->state_id ? DB::table('master_states')->where('id', $a->state_id)->value('name') : null;

        return response()->json(['status' => true, 'data' => [
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
        ]]);
    }

    /* ══════════════════════════ SHIPMENT DROPDOWN + PI PRODUCTS ══════════════════════════ */

    /** Shipments (With Shipment ID dropdown): shipment code + customer + linked PI/opportunity. */
    public function shipments(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ShipmentOrder::query()->with(['lead.customer', 'lead.consignee', 'proformaInvoice'])->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        $rows = $q->get()->map(function ($s) {
            $lead = $s->lead;
            return [
                'id' => $s->id,
                'code' => $s->shipment_code,
                'customer' => $lead && $lead->customer ? $lead->customer->company_name : null,
                'consignee' => $lead && $lead->consignee ? $lead->consignee->company_name : null,
                'opportunity_id' => $s->lead_id,
                'opportunity_code' => $lead->opp_code ?? null,
                'proforma_invoice_id' => $s->proforma_invoice_id,
                'pi_number' => optional($s->proformaInvoice)->code,
            ];
        });
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /** PI products for a shipment — seeds the Stage-2 PI-vs-PO mapping table. */
    public function shipmentPiProducts(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $shipment = ShipmentOrder::query();
        $this->applyScope($shipment, $user, $request->integer('branch_id') ?: null);
        $shipment = $shipment->findOrFail($id);

        // Resolve the PI: direct link, else via the shared lead/opportunity.
        $piId = $shipment->proforma_invoice_id;
        if (!$piId && $shipment->lead_id) {
            $piId = DB::table('proforma_invoices')->where('opp_id', $shipment->lead_id)->value('id');
        }
        if (!$piId) return response()->json(['status' => true, 'data' => []]);

        $items = DB::table('proforma_invoice_items')
            ->where('proforma_invoice_id', $piId)
            ->orderBy('line_no')->orderBy('id')
            ->get();

        $codes = DB::table('products')
            ->whereIn('id', $items->pluck('product_id')->filter()->all())
            ->pluck('product_code', 'id');

        // Quantity already ordered against this shipment across existing POs, so a
        // second PO only sees the REMAINING PI quantity (PI qty − already ordered).
        // Editing a PO excludes its own lines (exclude_po) so they don't count
        // twice. Keyed by product_id (preferred) and product_code (fallback).
        $excludePo = $request->integer('exclude_po') ?: null;
        $orderedRows = DB::table('purchase_order_items as poi')
            ->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->where('po.shipment_order_id', $id)
            ->whereNull('po.deleted_at')
            ->when($excludePo, fn ($q) => $q->where('po.id', '!=', $excludePo))
            ->selectRaw('poi.product_id, poi.product_code, SUM(poi.quantity) as qty')
            ->groupBy('poi.product_id', 'poi.product_code')
            ->get();
        $orderedById = [];
        $orderedByCode = [];
        foreach ($orderedRows as $row) {
            if ($row->product_id) {
                $orderedById[(int) $row->product_id] = ($orderedById[(int) $row->product_id] ?? 0) + (float) $row->qty;
            } elseif ($row->product_code) {
                $orderedByCode[$row->product_code] = ($orderedByCode[$row->product_code] ?? 0) + (float) $row->qty;
            }
        }

        $data = $items->map(function ($it) use ($codes, $orderedById, $orderedByCode) {
            $rawName = (string) $it->product_name;
            $code = $it->product_id ? ($codes[$it->product_id] ?? null) : null;
            $name = $rawName;
            // PI item names are often stored as "P-119 – Rice" (code + separator +
            // name). Split so the code lands in its own column and the name is clean.
            if (preg_match('/^\s*([A-Za-z]{1,5}[-\s]?\d{1,6})\s*[–—:|\-]\s*(.+)$/u', $rawName, $m)) {
                $code = trim($m[1]);
                $name = trim($m[2]);
            }
            $piQty = (float) $it->quantity;
            $ordered = $it->product_id ? ($orderedById[(int) $it->product_id] ?? 0)
                : ($code ? ($orderedByCode[$code] ?? 0) : 0);
            $remaining = max(0, $piQty - $ordered);
            return [
                'product_id' => $it->product_id,
                'code' => $code,
                'name' => $name,
                'hsn' => $it->hsn_code,
                // qty = REMAINING PI quantity available for this PO (drives the
                // seeded PI/PO quantities). pi_qty/ordered kept for reference.
                'qty' => $remaining,
                'pi_qty' => $piQty,
                'ordered' => $ordered,
                'rate' => (float) $it->rate,
                'gst' => (float) $it->tax_pct,
            ];
        })
        // Fully-ordered PI products (nothing left) drop out — a new PO can only be
        // built while at least one PI product still has remaining quantity.
        ->filter(fn ($r) => $r['qty'] > 0)
        ->values();

        /* An empty list has two very different causes and the caller must be
         * able to tell them apart: the PI genuinely has no products, or every
         * PI product has already been consumed by earlier POs on this shipment.
         * The second is the common one (2 POs covering 4 PI products) and needs
         * to be reported instead of opening an empty product table. */
        return response()->json([
            'status' => true,
            'data'   => $data,
            'meta'   => [
                'pi_item_count'  => $items->count(),
                'available'      => $data->count(),
                'fully_ordered'  => $items->count() > 0 && $data->isEmpty(),
            ],
        ]);
    }

    /* ══════════════════════════ TRADE DOCS + AGREEMENTS (Stage 4) ══════════════════════════ */

    /**
     * Applicable Trade Documents + Agreements for a supplier's Stage-4 tabs.
     * Sourced from the CLM masters (clm_trade_doc_library / clm_agreement_library)
     * where the applicable party is a Supplier AND the row's segment matches one
     * of the vendor's segments. Only "Purchase Order" (trade) is a constant;
     * agreements — including "Purchase Agreement" — come from the masters.
     */
    public function supplierTradeDocs(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $cid = $user->client_id;

        // Only "Purchase Order" is a constant (rendered from the PI blade,
        // viewable & downloadable). Agreements — including "Purchase Agreement"
        // if present — are fetched from the CLM masters like any other document.
        $out = [
            'trade' => [[
                'id' => 'po', 'name' => 'Purchase Order', 'sub' => 'Purchase Order', 'required' => true, 'cat' => 'trade',
            ]],
            'agreements' => [],
        ];

        $vendor = Vendor::forUser($user, $request->integer('branch_id') ?: null)->find($id);
        if (!$vendor || !$cid) return response()->json(['status' => true, 'data' => $out]);

        // Segments to match documents against — the trade docs / agreements
        // shown are the ones applicable to the PO's PRODUCT segments. Priority:
        //   1. explicit product_ids (the wizard's Stage-2 rows — works even
        //      before the PO is saved, which is when this screen is used),
        //   2. the saved PO's items (po_id),
        //   3. the supplier's own segments (last-ditch fallback).
        $productIds = array_values(array_filter(array_map('intval', preg_split('/\s*,\s*/', (string) $request->query('product_ids', ''), -1, PREG_SPLIT_NO_EMPTY))));
        $poId       = $request->integer('po_id');
        if (!empty($productIds)) {
            $segIds = DB::table('products')
                ->where('client_id', $cid)
                ->whereIn('id', $productIds)
                ->whereNotNull('segment_id')
                ->pluck('segment_id')->map(fn ($x) => (int) $x)->unique()->values()->all();
        } elseif ($poId && PurchaseOrder::where('id', $poId)->where('client_id', $cid)->exists()) {
            $segIds = DB::table('purchase_order_items as poi')
                ->join('products as p', 'p.id', '=', 'poi.product_id')
                ->where('poi.purchase_order_id', $poId)
                ->whereNotNull('p.segment_id')
                ->pluck('p.segment_id')->map(fn ($x) => (int) $x)->unique()->values()->all();
        } else {
            $segIds = DB::table('vendor_segments')->where('vendor_id', $vendor->id)->pluck('segment_id')->map(fn ($x) => (int) $x)->unique()->values()->all();
            if (empty($segIds) && $vendor->segment_id) $segIds = [(int) $vendor->segment_id];
        }
        if (empty($segIds)) return response()->json(['status' => true, 'data' => $out]);

        $segments = DB::table('clm_segments')->whereIn('id', $segIds)->get(['name', 'code', 'regulatory_status']);

        $trade = collect();
        $agr = collect();
        foreach ($segments as $seg) {
            $trade = $trade->merge($this->matchLibrary('clm_trade_doc_library', 'status', 'active', $cid, $seg));
            $agr = $agr->merge($this->matchLibrary('clm_agreement_library', 'agr_status', 'Active', $cid, $seg));
        }

        foreach ($trade->unique('id') as $r) {
            if ($this->supplierApplicable($r->party ?? '')) $out['trade'][] = $this->shapeDoc($r, 'trade');
        }
        foreach ($agr->unique('id') as $r) {
            if ($this->supplierApplicable($r->party ?? '')) $out['agreements'][] = $this->shapeDoc($r, 'agreement');
        }

        return response()->json(['status' => true, 'data' => $out]);
    }

    private function matchLibrary(string $table, string $statusCol, string $statusVal, int $cid, object $seg)
    {
        $needles = array_values(array_filter([$seg->name, $seg->code]));
        return DB::table($table)
            ->where('client_id', $cid)
            ->where('regulatory', $seg->regulatory_status)
            ->where(function ($q) use ($needles) {
                foreach ($needles as $n) {
                    $q->orWhere('segment', $n)
                        ->orWhere('segment', 'LIKE', $n . ',%')->orWhere('segment', 'LIKE', $n . ', %')
                        ->orWhere('segment', 'LIKE', '%,' . $n)->orWhere('segment', 'LIKE', '%, ' . $n)
                        ->orWhere('segment', 'LIKE', '%,' . $n . ',%')->orWhere('segment', 'LIKE', '%, ' . $n . ',%');
                }
            })
            ->where($statusCol, $statusVal)
            ->get();
    }

    private function supplierApplicable(?string $party): bool
    {
        $party = trim((string) $party);
        if ($party === '') return true; // no party restriction → applies to all
        foreach (explode(',', $party) as $tok) {
            $t = strtolower(trim($tok));
            if ($t === 'supplier' || str_starts_with($t, 'supplier')) return true;
        }
        return false;
    }

    private function shapeDoc(object $r, string $cat): array
    {
        $name = $cat === 'trade' ? ($r->title ?: ($r->name ?? '')) : ($r->title ?: ($r->agreement_type ?? ''));
        $sub = $cat === 'trade' ? ($r->doc_type ?? '') : ($r->agreement_type ?? 'Agreement');
        return [
            'id' => $cat . '-' . $r->id,
            'name' => $name ?: ($cat === 'trade' ? 'Trade Document' : 'Agreement'),
            'sub' => $sub ?: '',
            'required' => ($r->regulatory ?? 'less') === 'highly',
            'cat' => $cat,
        ];
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    private function validatePayload(Request $request): array
    {
        $v = $request->validate([
            'po_type' => 'nullable|string|max:64',
            'document_type' => 'nullable|string|max:32',
            'mode_of_transport' => 'nullable|string|max:64',
            'po_date' => 'nullable|date',
            'expected_delivery_date' => 'nullable|date',
            'warehouse_id' => 'nullable|integer',
            'delivery_location' => 'nullable|string|max:255',
            'payment_type' => 'nullable|string|max:64',
            'physical_inspection' => 'nullable|boolean',
            'currency_id' => 'nullable|integer',
            'currency_code' => 'nullable|string|max:16',
            'exchange_rate' => 'nullable|numeric|min:0',
            'inco_term' => 'nullable|string|max:32',
            'port_of_loading' => 'nullable|string|max:128',
            'port_of_discharge' => 'nullable|string|max:128',
            'final_destination' => 'nullable|string|max:128',
            'country_of_origin' => 'nullable|string|max:128',
            'vendor_id' => 'nullable|integer',
            'shipment_order_id' => 'nullable|integer',
            'terms' => 'nullable|string',
            'shipping_charges' => 'nullable|numeric|min:0',
            'packaging_charges' => 'nullable|numeric|min:0',
            'other_charges' => 'nullable|numeric|min:0',
            'items' => 'array',
            'items.*.product_id' => 'nullable|integer',
            'items.*.product_code' => 'nullable|string|max:64',
            'items.*.pi_product_name' => 'nullable|string|max:255',
            'items.*.pi_quantity' => 'nullable|numeric|min:0',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.quantity' => 'nullable|numeric|min:0',
            'items.*.rate' => 'nullable|numeric|min:0',
            'items.*.gst_pct' => 'nullable|numeric|min:0|max:100',
        ]);

        // Resolve supplier + shipment context (tenant-checked) and cache labels.
        $user = $request->user();
        $v['_vendor'] = null;
        $v['_supplierStateCode'] = '27';
        if (!empty($v['vendor_id'])) {
            $vendor = Vendor::with('primaryAddress')->forUser($user, null)->find($v['vendor_id']);
            if ($vendor) {
                $v['_vendor'] = $vendor;
                $v['_supplierStateCode'] = optional($vendor->primaryAddress)->state_code ?: '27';
            } else {
                $v['vendor_id'] = null;
            }
        }
        $v['_shipment'] = null;
        if (!empty($v['shipment_order_id'])) {
            $q = ShipmentOrder::with(['lead.customer', 'lead.consignee', 'proformaInvoice']);
            $this->applyScope($q, $user, null);
            $ship = $q->find($v['shipment_order_id']);
            if ($ship) $v['_shipment'] = $ship; else $v['shipment_order_id'] = null;
        }
        // Intra- vs inter-state: compare the vendor's state against THIS tenant's
        // own registered home state (branch GST state code), not a hardcoded '27'.
        $v['_intra'] = (string) $v['_supplierStateCode'] === (string) $this->homeStateCode($user->branch_id);
        return $v;
    }

    /**
     * Guard against over-allocating a PI. The quantity a PO orders for each
     * product may not exceed the PI quantity still AVAILABLE — the full PI
     * quantity minus what OTHER POs on the same shipment already ordered (this
     * PO's own lines are excluded on update via $excludePoId). Mirrors the
     * remaining quantity surfaced by shipmentPiProducts() and the frontend cap,
     * so a direct API call can't bypass it. The Without-Shipment flow has no PI
     * and is left uncapped.
     *
     * @throws ValidationException 422 listing every product that overflows.
     */
    private function assertWithinPiAllocation(array $data, ?int $excludePoId): void
    {
        $ship = $data['_shipment'] ?? null;
        $items = $data['items'] ?? [];
        if (!$ship || empty($items)) return;

        // Resolve the PI: direct link, else via the shared lead/opportunity.
        $piId = $ship->proforma_invoice_id;
        if (!$piId && $ship->lead_id) {
            $piId = DB::table('proforma_invoices')->where('opp_id', $ship->lead_id)->value('id');
        }
        if (!$piId) return;

        $piItems = DB::table('proforma_invoice_items')->where('proforma_invoice_id', $piId)->get();
        if ($piItems->isEmpty()) return;

        $codes = DB::table('products')
            ->whereIn('id', $piItems->pluck('product_id')->filter()->all())
            ->pluck('product_code', 'id');

        // Full PI quantity + a clean display name, keyed by product_id and by code
        // (same code-splitting as shipmentPiProducts so the caps line up exactly).
        $piById = [];
        $piByCode = [];
        $nameById = [];
        $nameByCode = [];
        foreach ($piItems as $it) {
            $rawName = (string) $it->product_name;
            $code = $it->product_id ? ($codes[$it->product_id] ?? null) : null;
            $name = $rawName;
            if (preg_match('/^\s*([A-Za-z]{1,5}[-\s]?\d{1,6})\s*[–—:|\-]\s*(.+)$/u', $rawName, $m)) {
                $code = trim($m[1]);
                $name = trim($m[2]);
            }
            $qty = (float) $it->quantity;
            if ($it->product_id) {
                $piById[(int) $it->product_id] = ($piById[(int) $it->product_id] ?? 0) + $qty;
                $nameById[(int) $it->product_id] = $name;
            } elseif ($code) {
                $piByCode[$code] = ($piByCode[$code] ?? 0) + $qty;
                $nameByCode[$code] = $name;
            }
        }

        // Quantity ordered by OTHER POs on this shipment (exclude this PO on update).
        $orderedRows = DB::table('purchase_order_items as poi')
            ->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->where('po.shipment_order_id', $ship->id)
            ->whereNull('po.deleted_at')
            ->when($excludePoId, fn ($q) => $q->where('po.id', '!=', $excludePoId))
            ->selectRaw('poi.product_id, poi.product_code, SUM(poi.quantity) as qty')
            ->groupBy('poi.product_id', 'poi.product_code')
            ->get();
        $ordById = [];
        $ordByCode = [];
        foreach ($orderedRows as $row) {
            if ($row->product_id) {
                $ordById[(int) $row->product_id] = ($ordById[(int) $row->product_id] ?? 0) + (float) $row->qty;
            } elseif ($row->product_code) {
                $ordByCode[$row->product_code] = ($ordByCode[$row->product_code] ?? 0) + (float) $row->qty;
            }
        }

        // Sum THIS PO's requested quantity per product (a product can span rows).
        $reqById = [];
        $reqByCode = [];
        foreach ($items as $it) {
            $qty = (float) ($it['quantity'] ?? 0);
            if ($qty <= 0) continue;
            $pid = isset($it['product_id']) && $it['product_id'] !== '' ? (int) $it['product_id'] : null;
            $code = $it['product_code'] ?? null;
            if ($pid) $reqById[$pid] = ($reqById[$pid] ?? 0) + $qty;
            elseif ($code) $reqByCode[$code] = ($reqByCode[$code] ?? 0) + $qty;
        }

        $eps = 0.0001;

        // NEW PO on this shipment: if every PI product is already fully ordered
        // by existing (non-deleted) POs, there is no quantity left to allocate —
        // block raising another PO for this shipment (QA request). Only for new
        // POs ($excludePoId === null); an edit legitimately re-touches the qty it
        // already consumed.
        if ($excludePoId === null) {
            $hasRemaining = false;
            foreach ($piById as $pid => $piQty) {
                if ($piQty - ($ordById[$pid] ?? 0) > $eps) { $hasRemaining = true; break; }
            }
            if (!$hasRemaining) {
                foreach ($piByCode as $code => $piQty) {
                    if ($piQty - ($ordByCode[$code] ?? 0) > $eps) { $hasRemaining = true; break; }
                }
            }
            if (!$hasRemaining) {
                throw ValidationException::withMessages([
                    'shipment_order_id' => ['This shipment already has purchase order(s) covering the full PI quantity — no quantity remains to raise a new PO for this shipment.'],
                ]);
            }
        }

        $errors = [];
        foreach ($reqById as $pid => $req) {
            if (!array_key_exists($pid, $piById)) continue; // not a PI product → not PI-capped
            $remaining = max(0, $piById[$pid] - ($ordById[$pid] ?? 0));
            if ($req > $remaining + $eps) {
                $label = $nameById[$pid] ?? ('product #' . $pid);
                $errors[] = "\"{$label}\": PO quantity {$this->qtyStr($req)} exceeds the PI quantity still available ({$this->qtyStr($remaining)} remaining).";
            }
        }
        foreach ($reqByCode as $code => $req) {
            if (!array_key_exists($code, $piByCode)) continue;
            $remaining = max(0, $piByCode[$code] - ($ordByCode[$code] ?? 0));
            if ($req > $remaining + $eps) {
                $label = $nameByCode[$code] ?? $code;
                $errors[] = "\"{$label}\": PO quantity {$this->qtyStr($req)} exceeds the PI quantity still available ({$this->qtyStr($remaining)} remaining).";
            }
        }

        if ($errors) {
            throw ValidationException::withMessages(['items' => $errors]);
        }
    }

    /** Format a quantity for a message — drop trailing zeros (5.00 → "5", 2.50 → "2.5"). */
    private function qtyStr(float $n): string
    {
        return rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
    }

    private function buildHeader($user, array $data): array
    {
        $vendor = $data['_vendor'] ?? null;
        $ship = $data['_shipment'] ?? null;
        $lead = $ship ? $ship->lead : null;
        return [
            'po_type' => $data['po_type'] ?? null,
            'document_type' => $data['document_type'] ?? 'Domestics',
            'mode_of_transport' => $data['mode_of_transport'] ?? null,
            'po_date' => $data['po_date'] ?? now()->toDateString(),
            'expected_delivery_date' => $data['expected_delivery_date'] ?? null,
            'warehouse_id' => $data['warehouse_id'] ?? null,
            'delivery_location' => $data['delivery_location'] ?? null,
            'payment_type' => $data['payment_type'] ?? null,
            'physical_inspection' => (bool) ($data['physical_inspection'] ?? false),
            'currency_id' => $data['currency_id'] ?? null,
            'currency_code' => $data['currency_code'] ?? null,
            'exchange_rate' => $data['exchange_rate'] ?? null,
            'inco_term' => $data['inco_term'] ?? null,
            'port_of_loading' => $data['port_of_loading'] ?? null,
            'port_of_discharge' => $data['port_of_discharge'] ?? null,
            'final_destination' => $data['final_destination'] ?? null,
            'country_of_origin' => $data['country_of_origin'] ?? null,
            'vendor_id' => $vendor?->id,
            'supplier_code' => $vendor?->vendor_code,
            'supplier_name' => $vendor ? ($vendor->company_name ?: $vendor->legal_name) : null,
            'shipment_order_id' => $ship?->id,
            'shipment_code' => $ship?->shipment_code,
            'proforma_invoice_id' => $ship?->proforma_invoice_id,
            'pi_number' => $ship ? optional($ship->proformaInvoice)->code : null,
            'opportunity_id' => $ship?->lead_id,
            'opportunity_code' => $lead->opp_code ?? null,
            'customer_name' => $lead && $lead->customer ? $lead->customer->company_name : null,
            'consignee_name' => $lead && $lead->consignee ? $lead->consignee->company_name : null,
            'terms' => $data['terms'] ?? null,
            'shipping_charges' => (float) ($data['shipping_charges'] ?? 0),
            'packaging_charges' => (float) ($data['packaging_charges'] ?? 0),
            'other_charges' => (float) ($data['other_charges'] ?? 0),
        ];
    }

    private function syncItems(PurchaseOrder $po, array $items, bool $intra, array $header): void
    {
        $line = 0;
        foreach ($items as $it) {
            $qty = (float) ($it['quantity'] ?? 0);
            $rate = (float) ($it['rate'] ?? 0);
            $gst = (float) ($it['gst_pct'] ?? 0);
            // GST always splits into equal CGST + SGST halves of the item's own
            // rate (a 12% item → 6% + 6%). Intra- vs inter-state only changes the
            // LABEL (CGST/SGST vs IGST), never the amount — so never hard-code 9%.
            $cgstP = $gst / 2;
            $sgstP = $gst / 2;
            $base = $qty * $rate;
            $cgstA = $base * $cgstP / 100;
            $sgstA = $base * $sgstP / 100;
            PurchaseOrderItem::create([
                'purchase_order_id' => $po->id,
                'product_id' => $it['product_id'] ?? null,
                'product_code' => $it['product_code'] ?? null,
                'pi_product_name' => $it['pi_product_name'] ?? null,
                'pi_quantity' => isset($it['pi_quantity']) && $it['pi_quantity'] !== '' ? (float) $it['pi_quantity'] : null,
                'product_name' => $it['product_name'] ?? null,
                'quantity' => $qty,
                'rate' => $rate,
                'gst_pct' => $gst,
                'cgst_pct' => $cgstP,
                'sgst_pct' => $sgstP,
                'cgst_amount' => round($cgstA, 2),
                'sgst_amount' => round($sgstA, 2),
                'cost' => round($base + $cgstA + $sgstA, 2),
                'line_no' => ++$line,
            ]);
        }
    }

    private function recomputeTotals(PurchaseOrder $po, array $data): void
    {
        $items = $po->items()->get();
        $prod = (float) $items->sum('cost');
        $cgst = (float) $items->sum('cgst_amount');
        $sgst = (float) $items->sum('sgst_amount');
        $addl = (float) ($data['shipping_charges'] ?? 0) + (float) ($data['packaging_charges'] ?? 0) + (float) ($data['other_charges'] ?? 0);
        $po->update([
            'total_product_cost' => round($prod, 2),
            'total_cgst' => round($cgst, 2),
            'total_sgst' => round($sgst, 2),
            'additional_charges' => round($addl, 2),
            'grand_total' => round($prod + $addl, 2),
        ]);
    }

    private function shapeListRow(PurchaseOrder $po): array
    {
        // Payment utilisation: Net Payable = grand_total − TDS; "fully utilised"
        // means the recorded payments cover the whole net-payable balance.
        // `paid_sum` is eager-loaded via withSum() in index() to avoid N+1 (it is
        // null when a row has no payments); single-row callers (show/sync/send)
        // don't eager-load it, so they fall back to a direct sum.
        $paid = array_key_exists('paid_sum', $po->getAttributes())
            ? (float) $po->getAttributes()['paid_sum']
            : (float) $po->payments()->sum('amount');
        $netPayable = round((float) $po->grand_total - (float) $po->tds_amount, 2);
        $balance    = round($netPayable - $paid, 2);
        // Once ANY supplier invoice is mapped to this PO, editing is locked.
        $hasSpi = array_key_exists('spi_count', $po->getAttributes())
            ? (int) $po->getAttributes()['spi_count'] > 0
            : $po->supplierPurchaseInvoices()->exists();

        return [
            'id' => $po->id,
            'vendor_id' => $po->vendor_id,
            'po' => $po->code,
            'date' => optional($po->po_date)->toDateString(),
            'type' => $po->po_type,
            'doc' => $po->document_type,
            'ship' => $po->shipment_code,
            'opp' => $po->opportunity_code,
            'proc' => null,
            'cust' => $po->customer_name,
            'supCode' => $po->supplier_code,
            'supName' => $po->supplier_name,
            'edd' => optional($po->expected_delivery_date)->toDateString(),
            'zoho' => $po->zoho_status,
            'status' => $po->status,
            // Whether the PO is e-signed (completed Zoho-Sign request). The
            // frontend uses this to gate the Zoho Books sync button.
            'is_signed' => $this->isPoSigned($po),
            // Sent for signature → PO can no longer be edited.
            'sent_for_sign' => $po->status === 'Sent for Sign',
            // Any supplier invoice mapped → PO can no longer be edited.
            'has_spi' => $hasSpi,
            // TDS one-time deduction state (drives the wizard read-only lock and
            // gates "Send for Signature").
            'tds_cut' => (bool) $po->tds_cut,
            'tds_amount' => round((float) $po->tds_amount, 2),
            // Payment utilisation (gates Zoho Books sync).
            'amount_paid' => round($paid, 2),
            'net_payable' => $netPayable,
            'balance' => $balance,
            'fully_utilized' => $netPayable > 0.005 && $balance <= 0.005,
        ];
    }

    private function shapeDetail(PurchaseOrder $po): array
    {
        return array_merge($this->shapeListRow($po), [
            'mode_of_transport' => $po->mode_of_transport,
            'warehouse_id' => $po->warehouse_id,
            'delivery_location' => $po->delivery_location,
            'payment_type' => $po->payment_type,
            'physical_inspection' => (bool) $po->physical_inspection,
            'currency_id' => $po->currency_id,
            'currency_code' => $po->currency_code,
            'exchange_rate' => $po->exchange_rate,
            'inco_term' => $po->inco_term,
            'port_of_loading' => $po->port_of_loading,
            'port_of_discharge' => $po->port_of_discharge,
            'final_destination' => $po->final_destination,
            'country_of_origin' => $po->country_of_origin,
            'vendor_id' => $po->vendor_id,
            'shipment_order_id' => $po->shipment_order_id,
            'proforma_invoice_id' => $po->proforma_invoice_id,
            'pi_number' => $po->pi_number,
            'consignee_name' => $po->consignee_name,
            'terms' => $po->terms,
            'shipping_charges' => $po->shipping_charges,
            'packaging_charges' => $po->packaging_charges,
            'other_charges' => $po->other_charges,
            'total_product_cost' => $po->total_product_cost,
            'total_cgst' => $po->total_cgst,
            'total_sgst' => $po->total_sgst,
            'additional_charges' => $po->additional_charges,
            'grand_total' => $po->grand_total,
            'items' => $po->items->map(fn ($it) => [
                'id' => $it->id,
                'product_id' => $it->product_id,
                'code' => $it->product_code,
                'piName' => $it->pi_product_name,
                'piQty' => $it->pi_quantity,
                'name' => $it->product_name,
                'qty' => $it->quantity,
                'rate' => $it->rate,
                'gst' => $it->gst_pct,
                'cgstP' => $it->cgst_pct,
                'sgstP' => $it->sgst_pct,
                'cgstA' => $it->cgst_amount,
                'sgstA' => $it->sgst_amount,
                'cost' => $it->cost,
            ])->all(),
        ]);
    }

    /* ── Sequential PO code (per client + FY, locked) ── */

    private function peekCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        $max = $this->maxSeq($clientId, $fy);
        return "PO/{$fy}/" . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    private function nextCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("po-code:{$clientId}:{$fy}")]);
        }
        $codes = PurchaseOrder::where('client_id', $clientId)->where('code', 'like', "PO/{$fy}/%")->pluck('code')->all();
        $taken = [];
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('#^PO/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do { $n++; $code = "PO/{$fy}/" . str_pad((string) $n, 3, '0', STR_PAD_LEFT); } while (isset($taken[$code]));
        return $code;
    }

    private function maxSeq(int $clientId, string $fy): int
    {
        $max = 0;
        foreach (PurchaseOrder::where('client_id', $clientId)->where('code', 'like', "PO/{$fy}/%")->pluck('code') as $c) {
            if (preg_match('#^PO/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
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

    /* ── Tenant / branch scope (mirrors QuotationController) ── */

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

    /**
     * This tenant's own registered GST state code, used for the intra- vs
     * inter-state (CGST/SGST vs IGST) decision. Sourced from the branch's
     * `gst_state_code`, deriving from its GSTIN if the code is blank; falls back
     * to '27' only when the tenant has captured no GST state at all.
     */
    private function homeStateCode(?int $branchId): string
    {
        $branch = $branchId ? \App\Models\Branch::find($branchId) : null;
        $code = optional($branch)->gst_state_code ?: substr((string) optional($branch)->gst_number, 0, 2);
        return $code !== '' && $code !== null ? (string) $code : '27';
    }

    private function assertScope(PurchaseOrder $row, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;
        abort(404);
    }
}
