<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DebitNote;
use App\Models\DebitNoteCharge;
use App\Models\DebitNoteItem;
use App\Models\DebitNoteType;
use App\Models\PurchaseOrder;
use App\Models\SupplierPurchaseInvoice;
use App\Models\Vendor;
use App\Services\ZohoBooksService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class DebitNoteController extends Controller
{
    /* ══════════════════════════ LIST ══════════════════════════ */

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = DebitNote::query()->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        if ($status = $request->query('status')) $q->where('status', $status);

        if ($term = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($term) {
                $w->where('code', 'like', "%{$term}%")
                    ->orWhere('debit_note_type', 'like', "%{$term}%")
                    ->orWhere('spi_code', 'like', "%{$term}%")
                    ->orWhere('po_code', 'like', "%{$term}%")
                    ->orWhere('supplier_name', 'like', "%{$term}%")
                    ->orWhere('status', 'like', "%{$term}%");
            });
        }

        $perPage = min(max((int) $request->query('per_page', 10), 1), 200);
        $paginator = $q->paginate($perPage, ['*'], 'page', max(1, (int) $request->query('page', 1)));

        return response()->json([
            'status' => true,
            'data' => collect($paginator->items())->map(fn ($dn) => $this->shapeListRow($dn))->all(),
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
        $dn = DebitNote::with(['items', 'charges'])->findOrFail($id);
        $this->assertScope($dn, $user);
        return response()->json(['status' => true, 'data' => $this->shapeDetail($dn)]);
    }

    /* ══════════════════════════ CREATE ══════════════════════════ */

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);

        $dn = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode($user->client_id);

            $header = $this->buildHeader($user, $data);
            $header['client_id'] = $user->client_id;
            $header['branch_id'] = $user->branch_id;
            $header['code'] = $code;
            $header['created_by'] = $user->id;
            $header['updated_by'] = $user->id;

            $dn = DebitNote::create($header);
            $this->syncItems($dn, $data['items'] ?? []);
            $this->syncCharges($dn, $data['additions'] ?? [], $data['deductions'] ?? []);
            $this->recomputeTotals($dn);
            return $dn;
        });

        return response()->json(['status' => true, 'data' => $this->shapeDetail($dn->fresh(['items', 'charges']))], 201);
    }

    /* ══════════════════════════ UPDATE ══════════════════════════ */

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $dn = DebitNote::findOrFail($id);
        $this->assertScope($dn, $user, 'write');

        // Once any amount has been recovered against this debit note it is locked
        // for editing — the figures back a recorded payment, so it's view-only.
        if ($dn->payments()->exists()) {
            return response()->json([
                'status' => false,
                'message' => 'This debit note has a recorded payment recovery and can no longer be edited — it is view-only now.',
            ], 422);
        }
        // Same once it's pushed to Zoho Books as a vendor credit — the Zoho doc is
        // the source of truth; block edits so the two can't diverge.
        if (!empty($dn->zoho_vendorcredit_id)) {
            return response()->json([
                'status' => false,
                'message' => 'This debit note is synced to Zoho Books (vendor credit ' . ($dn->zoho_vendorcredit_number ?: $dn->zoho_vendorcredit_id) . ') and can no longer be edited.',
            ], 422);
        }

        $data = $this->validatePayload($request);

        DB::transaction(function () use ($dn, $user, $data) {
            $header = $this->buildHeader($user, $data);
            $header['updated_by'] = $user->id;
            $dn->update($header);
            $dn->items()->delete();
            $dn->charges()->delete();
            $this->syncItems($dn, $data['items'] ?? []);
            $this->syncCharges($dn, $data['additions'] ?? [], $data['deductions'] ?? []);
            $this->recomputeTotals($dn);
        });

        return response()->json(['status' => true, 'data' => $this->shapeDetail($dn->fresh(['items', 'charges']))]);
    }

    /* ══════════════════════════ DELETE ══════════════════════════ */

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $dn = DebitNote::findOrFail($id);
        $this->assertScope($dn, $user, 'write');
        if (!empty($dn->zoho_vendorcredit_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'This debit note is synced to Zoho Books and cannot be deleted here — remove the vendor credit in Zoho Books first.',
            ], 422);
        }
        $dn->delete();
        return response()->json(['status' => true]);
    }

    /* ══════════════════════════ ZOHO SYNC ══════════════════════════ */

    public function sync(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $dn = DebitNote::with(['items', 'charges'])->findOrFail($id);
        $this->assertScope($dn, $user, 'write');

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) {
            return response()->json([
                'status'  => false,
                'message' => 'Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again.',
            ], 503);
        }

        // Serialize concurrent syncs of the SAME debit note — a double-submit must
        // not create two vendor credits.
        $lock = \Illuminate\Support\Facades\Cache::lock('zoho:sync:dn:' . $dn->id, 120);
        if (!$lock->get()) {
            return response()->json(['status' => false, 'message' => 'A Zoho sync for this debit note is already in progress — try again in a moment.'], 409);
        }
        try {

        // Idempotent on the CREDIT — never push a second vendor credit. But
        // re-sync RETRIES the apply-to-bill if it didn't land last time (the
        // credit was created, but the apply failed or the linked bill was synced
        // afterwards), so the payable reduction is realised without a duplicate.
        if (!empty($dn->zoho_vendorcredit_id)) {
            $msg = 'This debit note is already synced to Zoho Books (vendor credit ' . ($dn->zoho_vendorcredit_number ?: $dn->zoho_vendorcredit_id) . ').';
            try {
                $vc = $books->getVendorCredit((string) $dn->zoho_vendorcredit_id);
                $extra = $this->applyCreditToLinkedBill($dn, $books, (string) $dn->zoho_vendorcredit_id, (float) ($vc['balance'] ?? 0));
                if ($extra > 0.005) {
                    $dn->update(['zoho_applied_amount' => round((float) $dn->zoho_applied_amount + $extra, 2), 'updated_by' => $user->id]);
                    $msg = 'Applied ₹' . number_format($extra, 2) . ' of the vendor credit to the linked bill.';
                }
            } catch (\Throwable $e) {
                Log::warning('Zoho vendor-credit re-apply failed', ['dn' => $dn->id, 'err' => $e->getMessage()]);
            }
            return response()->json(['status' => true, 'message' => $msg, 'data' => $this->shapeListRow($dn->fresh())]);
        }
        if (!$dn->vendor_id) {
            return response()->json(['status' => false, 'message' => 'Attach a supplier to this debit note before syncing to Zoho Books.'], 422);
        }
        if ($dn->items->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'Add at least one product line before syncing to Zoho Books.'], 422);
        }
        // The full debit amount must be recovered (fully paid) before the debit
        // note can be pushed to Zoho Books as a vendor credit. Computed from
        // grand_total − total_paid so a stale `balance` column can't slip through.
        $outstanding = round((float) $dn->grand_total - (float) $dn->total_paid, 2);
        if ((float) $dn->grand_total > 0.005 && $outstanding > 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Recover the full debit amount first — the debit note must be fully paid before syncing to Zoho Books.',
                'errors'  => ['amount' => ['₹' . number_format($outstanding, 2) . ' is still outstanding. Fully pay the debit note before syncing.']],
            ], 422);
        }

        try {
            $vendor    = Vendor::with('primaryAddress')->findOrFail($dn->vendor_id);
            $gstin     = $dn->gst_number ?: (DB::table('vendor_gst_scrutiny')->where('vendor_id', $vendor->id)->latest('id')->value('gst_number') ?: null);
            $stateCode = $dn->state_code ?: optional($vendor->primaryAddress)->state_code;

            // Intra- vs inter-state → GST(CGST+SGST) vs IGST, same rule as the bill.
            $orgState   = $books->orgStateCode() ?: $this->homeStateCode($dn->branch_id);
            $interState = $stateCode && (string) $stateCode !== (string) $orgState;

            $zohoVendorId = $books->findOrCreateVendorId($vendor, $gstin, $stateCode);

            // A vendor credit must be raised AGAINST a bill (this org's GST rule —
            // Zoho rejects a standalone credit with "Select the associated bill
            // number or bill type"). So the debit note's linked SPI must already
            // be synced as a Zoho bill; its id is sent as bill_id at creation.
            $linkedBillId = $dn->supplier_purchase_invoice_id
                ? (string) (SupplierPurchaseInvoice::where('id', $dn->supplier_purchase_invoice_id)->value('zoho_bill_id') ?: '')
                : '';
            if ($linkedBillId === '') {
                return response()->json([
                    'status'  => false,
                    'message' => 'Sync the linked supplier invoice (SPI) to Zoho Books first — a vendor credit must be raised against its bill.',
                    'errors'  => ['bill' => ['The linked SPI is not yet synced to Zoho Books.']],
                ], 422);
            }

            $vc   = $books->createVendorCredit($this->buildZohoVendorCreditPayload($dn, $books, $zohoVendorId, (bool) $gstin, $interState, $linkedBillId));
            $vcId = (string) ($vc['vendor_credit_id'] ?? $vc['vendorcredit_id']);

            // Apply the credit against the linked SPI's Zoho bill (if that bill is
            // synced and still has an open balance) — realises the payable
            // reduction. Best-effort: an apply hiccup must not undo the credit.
            $applied = 0.0;
            try {
                $applied = $this->applyCreditToLinkedBill($dn, $books, $vcId, (float) ($vc['balance'] ?? $vc['total'] ?? 0));
            } catch (\Throwable $e) {
                Log::warning('Zoho vendor-credit apply-to-bill failed', ['dn' => $dn->id, 'err' => $e->getMessage()]);
            }

            // Cache Zoho's own rendered vendor-credit PDF — best-effort.
            $pdfPath = null;
            try {
                $rel = 'zoho/vendorcredit/' . $dn->client_id . '/VC-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($dn->code ?: $dn->id)) . '.pdf';
                Storage::disk('public')->put($rel, $books->getVendorCreditPdf($vcId));
                $pdfPath = '/storage/' . $rel;
            } catch (\Throwable $e) {
                Log::warning('Zoho vendor-credit PDF cache failed', ['dn' => $dn->id, 'err' => $e->getMessage()]);
            }

            $dn->update([
                'zoho_status'              => 'Sync',
                'zoho_vendorcredit_id'     => $vcId,
                'zoho_vendorcredit_number' => $vc['vendor_credit_number'] ?? null,
                'zoho_applied_amount'      => round($applied, 2),
                'zoho_synced_at'           => now(),
                'zoho_error'               => null,
                'zoho_pdf_path'            => $pdfPath,
                'updated_by'               => $user->id,
            ]);

            $note = $applied > 0.005
                ? ' ₹' . number_format($applied, 2) . ' applied to the linked bill.'
                : ' It sits as an open vendor credit (no synced bill with an open balance to apply against).';

            return response()->json([
                'status'  => true,
                'message' => 'Synced to Zoho Books as vendor credit ' . ($vc['vendor_credit_number'] ?? $vcId) . '.' . $note,
                'data'    => $this->shapeListRow($dn->fresh()),
            ]);
        } catch (RuntimeException $e) {
            $dn->update(['zoho_status' => 'Not Sync', 'zoho_error' => $e->getMessage(), 'updated_by' => $user->id]);
            return response()->json(['status' => false, 'message' => $e->getMessage()], 422);
        }

        } finally {
            $lock->release();
        }
    }

    /**
     * Build the Zoho Books vendor-credit payload from a local debit note + its
     * items. Mirrors the SPI-bill builder: forward GST only for a GST-registered
     * supplier, and the effective applied tax (cgst+sgst halves, or full igst) is
     * sent so Zoho's recomputed total reconciles with ours. Line qty = debit_qty.
     */
    private function buildZohoVendorCreditPayload(DebitNote $dn, ZohoBooksService $books, string $zohoVendorId, bool $registered, bool $interState, ?string $billId = null): array
    {
        $lineItems = $dn->items->map(function ($it) use ($books, $registered, $interState) {
            $name = (string) ($it->product_name ?: $it->product_code ?: 'Item');
            $rate = (float) $it->rate;
            $effRate = $interState ? (float) $it->igst_pct : ((float) $it->cgst_pct + (float) $it->sgst_pct);
            $taxId = $registered ? $books->resolveTaxId($effRate, $interState) : null;
            $line = [
                'item_id'     => $books->findOrCreateItemId($name, $rate, $taxId, $it->product_id),
                'name'        => $name,
                'description' => (string) $it->product_code,
                'rate'        => $rate,
                'quantity'    => (float) $it->debit_qty,
            ];
            if (!empty($it->hsn_code)) $line['hsn_or_sac'] = (string) $it->hsn_code;
            if ($taxId) $line['tax_id'] = $taxId;
            return $line;
        })->values()->all();

        $payload = [
            'vendor_id'        => $zohoVendorId,
            // Required when the org has vendor-credit auto-numbering OFF (Zoho
            // rejects with "Please enter the vendor credit number" otherwise).
            // Our DN code is the credit's number; it's unique per client.
            'vendor_credit_number' => (string) $dn->code,
            'date'             => optional($dn->debit_note_date)->toDateString() ?: now()->toDateString(),
            'reference_number' => (string) $dn->code,
            'line_items'       => $lineItems,
        ];

        // Associate with the linked bill at creation — required by this org.
        if (!empty($billId)) $payload['bill_id'] = $billId;

        // Net of the additions/deductions charge rows → single adjustment line.
        $adjustment = round((float) $dn->additions_total - (float) $dn->deductions_total, 2);
        if ($adjustment != 0.0) {
            $payload['adjustment']             = $adjustment;
            $payload['adjustment_description'] = 'Additions less deductions';
        }
        if (trim((string) $dn->reason) !== '') {
            $payload['notes'] = mb_substr((string) $dn->reason, 0, 500);
        }

        return $payload;
    }

    /**
     * Apply the new vendor credit against the linked SPI's Zoho bill, capped at
     * the bill's CURRENT open balance (Zoho rejects applying more than a bill
     * owes; a fully-paid bill has nothing open). Returns the amount applied — 0
     * when the SPI isn't synced or the bill is already settled, in which case the
     * credit stays open in Zoho for a later bill or refund.
     */
    private function applyCreditToLinkedBill(DebitNote $dn, ZohoBooksService $books, string $vendorCreditId, float $creditBalance): float
    {
        if (!$dn->supplier_purchase_invoice_id) return 0.0;
        $spi = SupplierPurchaseInvoice::find($dn->supplier_purchase_invoice_id);
        if (!$spi || empty($spi->zoho_bill_id)) return 0.0;

        $bill = $books->getBill((string) $spi->zoho_bill_id);
        $billBalance = round((float) ($bill['balance'] ?? 0), 2);
        // Cap at the debit note's UN-recovered portion too: any amount already
        // recovered as cash locally (DebitNotePayment) must NOT also reduce the
        // bill, or the payable would be cut twice across the two systems. That
        // recovered slice stays as an open vendor credit (refund it in Zoho).
        $unrecovered = round((float) $dn->grand_total - (float) $dn->total_paid, 2);
        $apply = round(min($creditBalance, $billBalance, max(0, $unrecovered)), 2);
        if ($apply <= 0.005) return 0.0;

        $books->applyVendorCreditToBills($vendorCreditId, [[
            'bill_id'        => (string) $spi->zoho_bill_id,
            'amount_applied' => $apply,
        ]]);
        return $apply;
    }

    /** Stream the cached Zoho Books vendor-credit PDF for a synced debit note. */
    public function zohoPdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $dn = DebitNote::findOrFail($id);
        $this->assertScope($dn, $user);

        if (!$dn->zoho_pdf_path) abort(404, 'No Zoho vendor-credit PDF cached for this debit note.');
        $rel = ltrim(str_replace('/storage/', '', $dn->zoho_pdf_path), '/');
        if (!Storage::disk('public')->exists($rel)) abort(404, 'Zoho vendor-credit PDF file missing.');

        return response(Storage::disk('public')->get($rel), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ZOHO-VC-' . ($dn->code ?: $dn->id) . '.pdf"',
        ]);
    }

    /**
     * This tenant's own registered GST state code for the intra- vs inter-state
     * decision (mirrors SupplierPurchaseInvoiceController::homeStateCode).
     */
    private function homeStateCode(?int $branchId): string
    {
        $branch = $branchId ? \App\Models\Branch::find($branchId) : null;
        $code = optional($branch)->gst_state_code ?: substr((string) optional($branch)->gst_number, 0, 2);
        return $code !== '' && $code !== null ? (string) $code : '27';
    }

    /* ══════════════════════════ NEXT CODE ══════════════════════════ */

    public function previewCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $code = ($user && $user->client_id) ? $this->peekCode($user->client_id) : null;
        return response()->json(['status' => true, 'data' => ['code' => $code]]);
    }

    /* ══════════════════════════ SPI DROPDOWN ══════════════════════════ */

    /** Supplier purchase invoices available to raise a debit note against. */
    public function supplierPurchaseInvoices(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = SupplierPurchaseInvoice::query()->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        $rows = $q->get(['id', 'code', 'invoice_date', 'po_code', 'supplier_name'])
            ->map(fn ($s) => [
                'id' => $s->id,
                'code' => $s->code,
                'spiDate' => optional($s->invoice_date)->toDateString(),
                'poCode' => $s->po_code,
                'supplier' => $s->supplier_name,
            ]);
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /**
     * Full detail of a linked SPI — pre-fills the Debit Note form: SPI date, PO
     * number/date, supplier address & contact, GST scrutiny, and the product
     * lines (which seed the returned/adjusted-items table on later stages).
     */
    public function supplierPurchaseInvoice(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $spi = SupplierPurchaseInvoice::with('items')->findOrFail($id);
        $this->assertScope($spi, $user);

        // PO date is not stored on the SPI — read it live from the linked PO.
        $poDate = null;
        if ($spi->purchase_order_id) {
            $poDate = optional(PurchaseOrder::where('id', $spi->purchase_order_id)->value('po_date'));
            $poDate = $poDate ? $poDate->toDateString() : null;
        }

        return response()->json(['status' => true, 'data' => [
            'id' => $spi->id,
            'code' => $spi->code,
            'spi_date' => optional($spi->invoice_date)->toDateString(),
            'purchase_order_id' => $spi->purchase_order_id,
            'po_code' => $spi->po_code,
            'po_date' => $poDate,
            'shipment_order_id' => $spi->shipment_order_id,
            'shipment_code' => $spi->shipment_code,
            'procurement_id' => $spi->procurement_id,
            'procurement_code' => $spi->procurement_code,
            'vendor_id' => $spi->vendor_id,
            'supplier_code' => $spi->supplier_code,
            'supplier_name' => $spi->supplier_name,
            'supplier_type' => $spi->supplier_type,
            // Payment context for the Step-2 SPI Details recap.
            'payment_term' => $spi->payment_type,
            'total_invoice' => (float) $spi->net_payable,
            'paid_amount' => (float) $spi->total_paid,
            'balance' => (float) $spi->balance,
            'supplier' => $this->supplierDetail($user, $spi->vendor_id),
            'items' => $spi->items->map(fn ($it) => [
                'product_id' => $it->product_id,
                'code' => $it->product_code,
                'name' => $it->product_name ?: $it->po_product_name ?: $it->pi_product_name,
                'hsn' => $it->hsn_code,
                'qtyPo' => $it->po_quantity !== null ? (float) $it->po_quantity : 0,
                'qtySpi' => (float) $it->quantity,
                'rate' => (float) $it->rate,
                'gst' => (float) $it->gst_pct,
                'cgstPct' => (float) $it->cgst_pct,
                'sgstPct' => (float) $it->sgst_pct,
                'igstPct' => (float) ($it->igst_pct ?? 0),
            ])->all(),
        ]]);
    }

    /* ══════════════════════════ DEBIT NOTE TYPE HELPER ══════════════════════════ */

    /**
     * Resolve the chosen debit-note-type id → its cached label, scoped to the
     * tenant so a spoofed id from another client can't leak a name.
     */
    private function resolveType($user, ?int $typeId): ?string
    {
        if (!$typeId) return null;
        $q = DebitNoteType::query();
        $this->applyScope($q, $user, null);
        return optional($q->find($typeId))->name;
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

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

    private function validatePayload(Request $request): array
    {
        $v = $request->validate([
            'debit_note_date' => 'nullable|date',
            // Mandatory: debit note type, expected debit date, SPI number and
            // reason (mirrors the frontend form validation).
            'expected_debit_date' => 'required|date',
            'debit_note_type_id' => 'required|integer',
            'debit_note_type' => 'nullable|string|max:128',
            'supplier_purchase_invoice_id' => 'required|integer',
            'reason' => 'required|string|max:2000',
            'terms' => 'nullable|string|max:5000',
            'attachment_path' => 'nullable|string|max:255',

            'items' => 'array',
            'items.*.product_id' => 'nullable|integer',
            'items.*.product_code' => 'nullable|string|max:64',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.hsn_code' => 'nullable|string|max:32',
            'items.*.qty_po' => 'nullable|numeric|min:0',
            'items.*.qty_spi' => 'nullable|numeric|min:0',
            'items.*.debit_qty' => 'nullable|numeric|min:0',
            'items.*.rate' => 'nullable|numeric|min:0',
            'items.*.cgst_pct' => 'nullable|numeric|min:0|max:100',
            'items.*.sgst_pct' => 'nullable|numeric|min:0|max:100',
            'items.*.igst_pct' => 'nullable|numeric|min:0|max:100',

            'additions' => 'array',
            'additions.*.amount' => 'nullable|numeric',
            'additions.*.note' => 'nullable|string|max:255',
            'deductions' => 'array',
            'deductions.*.amount' => 'nullable|numeric',
            'deductions.*.note' => 'nullable|string|max:255',
        ]);

        $user = $request->user();

        // Resolve the linked SPI — carries supplier + PO + shipment/procurement context.
        $v['_spi'] = null;
        if (!empty($v['supplier_purchase_invoice_id'])) {
            $q = SupplierPurchaseInvoice::query();
            $this->applyScope($q, $user, null);
            $spi = $q->find($v['supplier_purchase_invoice_id']);
            if ($spi) {
                $v['_spi'] = $spi;
            } else {
                $v['supplier_purchase_invoice_id'] = null;
            }
        }

        // Resolve the type name from the id; fall back to (and back-fill the id
        // from) the posted name so a debit note always carries its type label
        // even if the id is missing or scoped out.
        $v['_typeName'] = $this->resolveType($user, $v['debit_note_type_id'] ?? null);
        if (empty($v['_typeName']) && !empty($v['debit_note_type'])) {
            $v['_typeName'] = trim($v['debit_note_type']);
        }
        if (empty($v['debit_note_type_id']) && !empty($v['debit_note_type'])) {
            $q = DebitNoteType::query();
            $this->applyScope($q, $user, null);
            $v['debit_note_type_id'] = optional($q->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($v['debit_note_type']))])->first())->id;
        }
        return $v;
    }

    private function buildHeader($user, array $data): array
    {
        $spi = $data['_spi'] ?? null;

        // PO date — read live from the linked PO (not stored on the SPI).
        $poDate = null;
        if ($spi && $spi->purchase_order_id) {
            $poDate = PurchaseOrder::where('id', $spi->purchase_order_id)->value('po_date');
        }

        $sup = $spi ? $this->supplierDetail($user, $spi->vendor_id) : null;

        return [
            'debit_note_date' => $data['debit_note_date'] ?? now()->toDateString(),
            'expected_debit_date' => $data['expected_debit_date'] ?? null,
            'debit_note_type_id' => $data['debit_note_type_id'] ?? null,
            'debit_note_type' => $data['_typeName'] ?? null,

            'supplier_purchase_invoice_id' => $spi?->id,
            'spi_code' => $spi?->code,
            'spi_date' => optional($spi?->invoice_date)->toDateString(),

            'purchase_order_id' => $spi?->purchase_order_id,
            'po_code' => $spi?->po_code,
            'po_date' => $poDate,

            'shipment_order_id' => $spi?->shipment_order_id,
            'shipment_code' => $spi?->shipment_code,
            'procurement_id' => $spi?->procurement_id,
            'procurement_code' => $spi?->procurement_code,

            'vendor_id' => $spi?->vendor_id,
            'supplier_code' => $spi?->supplier_code,
            'supplier_name' => $spi?->supplier_name,
            'supplier_type' => $spi?->supplier_type ?? ($sup['type'] ?? null),

            'address' => $sup['addr'] ?? null,
            'country' => $sup['country'] ?? null,
            'state' => $sup['state'] ?? null,
            'state_code' => $sup['stateCode'] ?? null,
            'city' => $sup['city'] ?? null,
            'contact_name' => $sup['contact'] ?? null,
            'designation' => $sup['desig'] ?? null,
            'contact_no' => $sup['phone'] ?? null,
            'email' => $sup['email'] ?? null,

            'gst_number' => $sup['gstNo'] ?? null,
            'gst_status' => $sup['gstStatus'] ?? null,
            'scrutiny_date' => $sup['scrutiny'] ?? null,
            'last_filing_date' => $sup['filing'] ?? null,
            'gst_remarks' => $sup['remarks'] ?? null,

            'reason' => $data['reason'] ?? null,
            'terms' => $data['terms'] ?? null,
            'attachment_path' => $data['attachment_path'] ?? null,
        ];
    }

    private function syncItems(DebitNote $dn, array $items): void
    {
        $line = 0;
        foreach ($items as $it) {
            $qtySpi = (float) ($it['qty_spi'] ?? 0);
            $qty = (float) ($it['debit_qty'] ?? 0);
            // Debit Qty can never exceed the SPI (invoiced) quantity — mirrors the
            // client-side cap so a crafted payload can't over-return an item.
            if ($qtySpi > 0 && $qty > $qtySpi) $qty = $qtySpi;
            $rate = (float) ($it['rate'] ?? 0);
            $cgstP = (float) ($it['cgst_pct'] ?? 0);
            $sgstP = (float) ($it['sgst_pct'] ?? 0);
            $igstP = (float) ($it['igst_pct'] ?? 0);
            $base = $qty * $rate;
            $cgstA = $base * $cgstP / 100;
            $sgstA = $base * $sgstP / 100;
            $igstA = $base * $igstP / 100;

            DebitNoteItem::create([
                'debit_note_id' => $dn->id,
                'product_id' => $it['product_id'] ?? null,
                'product_code' => $it['product_code'] ?? null,
                'product_name' => $it['product_name'] ?? null,
                'hsn_code' => $it['hsn_code'] ?? null,
                'qty_po' => (float) ($it['qty_po'] ?? 0),
                'qty_spi' => (float) ($it['qty_spi'] ?? 0),
                'debit_qty' => $qty,
                'rate' => $rate,
                'gst_pct' => $cgstP + $sgstP + $igstP,
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

    private function syncCharges(DebitNote $dn, array $additions, array $deductions): void
    {
        foreach ([['addition', $additions], ['deduction', $deductions]] as [$type, $rows]) {
            $line = 0;
            foreach ($rows as $r) {
                $amt = (float) ($r['amount'] ?? 0);
                if ($amt == 0 && empty($r['note'])) continue; // skip blank rows
                DebitNoteCharge::create([
                    'debit_note_id' => $dn->id,
                    'type' => $type,
                    'amount' => round($amt, 2),
                    'note' => $r['note'] ?? null,
                    'line_no' => ++$line,
                ]);
            }
        }
    }

    private function recomputeTotals(DebitNote $dn): void
    {
        $items = $dn->items()->get();
        $prod = (float) $items->sum('cost');
        $cgst = (float) $items->sum('cgst_amount');
        $sgst = (float) $items->sum('sgst_amount');
        $igst = (float) $items->sum('igst_amount');

        $charges = $dn->charges()->get();
        $add = (float) $charges->where('type', 'addition')->sum('amount');
        $ded = (float) $charges->where('type', 'deduction')->sum('amount');

        $grand = round($prod + $add - $ded, 2);
        $paid = (float) $dn->total_paid;
        $dn->update([
            'total_product_cost' => round($prod, 2),
            'total_cgst' => round($cgst, 2),
            'total_sgst' => round($sgst, 2),
            'total_igst' => round($igst, 2),
            'additions_total' => round($add, 2),
            'deductions_total' => round($ded, 2),
            'grand_total' => $grand,
            'balance' => round($grand - $paid, 2),
        ]);
    }

    private function shapeListRow(DebitNote $dn): array
    {
        return [
            'id' => $dn->id,
            'no' => $dn->code,
            'dnDate' => optional($dn->debit_note_date)->toDateString(),
            'type' => $dn->debit_note_type,
            'ship' => $dn->shipment_code,
            'proc' => $dn->procurement_code,
            'spi' => $dn->spi_code,
            'spiDate' => optional($dn->spi_date)->toDateString(),
            'po' => $dn->po_code,
            'poDate' => optional($dn->po_date)->toDateString(),
            'supplier' => $dn->supplier_name,
            'exp' => optional($dn->expected_debit_date)->toDateString(),
            'total' => (float) $dn->grand_total,
            'paid' => (float) $dn->total_paid,
            'balance' => (float) $dn->balance,
            // Locked once any recovery is recorded — the form becomes view-only.
            'locked' => (float) $dn->total_paid > 0,
            'status' => $dn->status,
            'zoho' => $dn->zoho_status === 'Sync' ? 'sync' : 'not',
            'zohoVc' => $dn->zoho_vendorcredit_number,        // Zoho vendor-credit no. once synced
            'zohoApplied' => (float) $dn->zoho_applied_amount,  // amount applied to the linked bill
            'zohoPdf' => $dn->zoho_pdf_path ? true : false,
        ];
    }

    private function shapeDetail(DebitNote $dn): array
    {
        return array_merge($this->shapeListRow($dn), [
            'debit_note_type_id' => $dn->debit_note_type_id,
            'supplier_purchase_invoice_id' => $dn->supplier_purchase_invoice_id,
            'purchase_order_id' => $dn->purchase_order_id,
            'expected_debit_date' => optional($dn->expected_debit_date)->toDateString(),
            'vendor_id' => $dn->vendor_id,
            'supplier_code' => $dn->supplier_code,
            'supplier_type' => $dn->supplier_type,
            'address' => $dn->address,
            'country' => $dn->country,
            'state' => $dn->state,
            'state_code' => $dn->state_code,
            'city' => $dn->city,
            'contact_name' => $dn->contact_name,
            'designation' => $dn->designation,
            'contact_no' => $dn->contact_no,
            'email' => $dn->email,
            'gst_number' => $dn->gst_number,
            'gst_status' => $dn->gst_status,
            'scrutiny_date' => optional($dn->scrutiny_date)->toDateString(),
            'last_filing_date' => optional($dn->last_filing_date)->toDateString(),
            'gst_remarks' => $dn->gst_remarks,
            'reason' => $dn->reason,
            'terms' => $dn->terms,
            'attachment_path' => $dn->attachment_path,
            'total_product_cost' => (float) $dn->total_product_cost,
            'total_cgst' => (float) $dn->total_cgst,
            'total_sgst' => (float) $dn->total_sgst,
            'total_igst' => (float) $dn->total_igst,
            'additions_total' => (float) $dn->additions_total,
            'deductions_total' => (float) $dn->deductions_total,
            'items' => $dn->items->map(fn ($it) => [
                'id' => $it->id,
                'product_id' => $it->product_id,
                'code' => $it->product_code,
                'name' => $it->product_name, 
                'hsn' => $it->hsn_code,
                'qtyPo' => (float) $it->qty_po,
                'qtySpi' => (float) $it->qty_spi,
                'debitQty' => (float) $it->debit_qty,
                'rate' => (float) $it->rate,
                'cgstPct' => (float) $it->cgst_pct,
                'sgstPct' => (float) $it->sgst_pct,
                'igstPct' => (float) $it->igst_pct,
                'cgstAmt' => (float) $it->cgst_amount,
                'sgstAmt' => (float) $it->sgst_amount,
                'igstAmt' => (float) $it->igst_amount,
                'cost' => (float) $it->cost,
            ])->all(),
            'additions' => $dn->charges->where('type', 'addition')->map(fn ($c) => ['amount' => (float) $c->amount, 'note' => $c->note])->values()->all(),
            'deductions' => $dn->charges->where('type', 'deduction')->map(fn ($c) => ['amount' => (float) $c->amount, 'note' => $c->note])->values()->all(),
        ]);
    }

    /* ── Sequential DN code (per client + FY, locked) ── */

    private function peekCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        return "DN/{$fy}/" . str_pad((string) ($this->maxSeq($clientId, $fy) + 1), 3, '0', STR_PAD_LEFT);
    }

    private function nextCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("dn-code:{$clientId}:{$fy}")]);
        }
        $codes = DebitNote::withTrashed()->where('client_id', $clientId)->where('code', 'like', "DN/{$fy}/%")->pluck('code')->all();
        $taken = [];
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('#^DN/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do { $n++; $code = "DN/{$fy}/" . str_pad((string) $n, 3, '0', STR_PAD_LEFT); } while (isset($taken[$code]));
        return $code;
    }

    private function maxSeq(int $clientId, string $fy): int
    {
        $max = 0;
        foreach (DebitNote::withTrashed()->where('client_id', $clientId)->where('code', 'like', "DN/{$fy}/%")->pluck('code') as $c) {
            if (preg_match('#^DN/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
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

    /* ── Tenant / branch scope (mirrors SupplierPurchaseInvoiceController) ── */

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
