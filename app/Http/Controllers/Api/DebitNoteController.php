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
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        $dn->delete();
        return response()->json(['status' => true]);
    }

    /* ══════════════════════════ ZOHO SYNC ══════════════════════════ */

    public function sync(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $dn = DebitNote::findOrFail($id);
        $this->assertScope($dn, $user, 'write');
        $dn->update(['zoho_status' => 'Sync', 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'data' => $this->shapeListRow($dn->fresh())]);
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
        $g = $v->gstScrutiny->first();
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
            'expected_debit_date' => 'nullable|date',
            'debit_note_type_id' => 'nullable|integer',
            'debit_note_type' => 'nullable|string|max:128',
            'supplier_purchase_invoice_id' => 'nullable|integer',
            'reason' => 'nullable|string|max:2000',
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
