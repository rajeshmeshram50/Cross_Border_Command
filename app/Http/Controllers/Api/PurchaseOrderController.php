<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Vendor;
use App\Models\ShipmentOrder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

        $q = PurchaseOrder::query()->orderByDesc('id');
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

        $data = $this->validatePayload($request);

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
        $po->delete();
        return response()->json(['status' => true]);
    }

    /* ══════════════════════════ ZOHO SYNC ══════════════════════════ */

    public function sync(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = PurchaseOrder::findOrFail($id);
        $this->assertScope($po, $user, 'write');
        $po->update(['zoho_status' => 'Sync', 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'data' => $this->shapeListRow($po->fresh())]);
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
            $cgstP = $intra ? 9 : $gst / 2;
            $sgstP = $intra ? 9 : $gst / 2;
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
        $g = $v->gstScrutiny->first();
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

        return response()->json(['status' => true, 'data' => $data]);
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

        $segIds = DB::table('vendor_segments')->where('vendor_id', $vendor->id)->pluck('segment_id')->map(fn ($x) => (int) $x)->unique()->values()->all();
        if (empty($segIds) && $vendor->segment_id) $segIds = [(int) $vendor->segment_id];
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
            'exchange_rate' => 'nullable|numeric',
            'inco_term' => 'nullable|string|max:32',
            'port_of_loading' => 'nullable|string|max:128',
            'port_of_discharge' => 'nullable|string|max:128',
            'final_destination' => 'nullable|string|max:128',
            'country_of_origin' => 'nullable|string|max:128',
            'vendor_id' => 'nullable|integer',
            'shipment_order_id' => 'nullable|integer',
            'terms' => 'nullable|string',
            'shipping_charges' => 'nullable|numeric',
            'packaging_charges' => 'nullable|numeric',
            'other_charges' => 'nullable|numeric',
            'items' => 'array',
            'items.*.product_id' => 'nullable|integer',
            'items.*.product_code' => 'nullable|string|max:64',
            'items.*.pi_product_name' => 'nullable|string|max:255',
            'items.*.pi_quantity' => 'nullable|numeric',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.quantity' => 'nullable|numeric',
            'items.*.rate' => 'nullable|numeric',
            'items.*.gst_pct' => 'nullable|numeric',
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
        // Intra-state (Maharashtra 27) → CGST/SGST 9/9; else split the product GST.
        $v['_intra'] = (string) $v['_supplierStateCode'] === '27';
        return $v;
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
            $cgstP = $intra ? 9 : $gst / 2;
            $sgstP = $intra ? 9 : $gst / 2;
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

    private function assertScope(PurchaseOrder $row, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;
        abort(404);
    }
}
