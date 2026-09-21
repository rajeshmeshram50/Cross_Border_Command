<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\PoItemQtyHistory;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\P2p\PurchaseOrderItem;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * P2P · Create Purchase Order — /api/p2p/orders
 *
 * Stage 01 creates a draft; stages 02 and 03 update it; stage 03 submits.
 * Tenant scoping comes from the global BelongsToTenant scope (set by the
 * `tenant` middleware); client_id / branch_id / created_by are always taken
 * from the authenticated user, never from the request body.
 */
class PurchaseOrderController extends Controller
{
    public function __construct(private PurchaseOrderService $svc) {}

    private function ok($data, int $code = 200): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data], $code);
    }

    private function fail(string $message, int $code = 422, array $extra = []): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message] + $extra, $code);
    }

    /** Writes need a tenant: a super admin has no client to create a PO under. */
    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        return $user;
    }

    /** A PO the caller can see — the global tenant scope does the filtering. */
    private function findPo(int $id): PurchaseOrder
    {
        return PurchaseOrder::findOrFail($id);
    }

    /* ══════════════════════════ LOOKUPS ══════════════════════════ */

    /** GET /p2p/orders/next-code — preview only; the real code is allocated on create. */
    public function nextCode(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $code = DB::transaction(fn () => $this->svc->nextPoCode((int) $user->client_id));
        return $this->ok(['code' => $code, 'financial_year' => $this->svc->financialYear()]);
    }

    /**
     * GET /p2p/orders/shipments/{shipment}/pi-lines?exclude_po=
     * Each PI line with what is already ordered and what is still pending.
     */
    public function piLines(Request $request, int $shipment): JsonResponse
    {
        $user = $this->tenantUser($request);
        $ship = $this->svc->scopeTenant(DB::table('shipment_orders'), 'shipment_orders')->where('id', $shipment)->first();
        if (!$ship) return $this->fail('Shipment not found', 404);

        $piId = $this->svc->piIdForShipment($ship);
        if (!$piId) return $this->ok(['proforma_invoice_id' => null, 'lines' => []]);

        return $this->ok([
            'proforma_invoice_id' => $piId,
            'lines' => $this->piLinesWithPending($piId, (int) $user->client_id, $request->integer('exclude_po') ?: null),
        ]);
    }

    /* ══════════════════════════ LIST / SHOW ══════════════════════════ */

    // The list's tabs, as SQL conditions. No payments exist on the new PO yet, so a
    // cancelled PO has nothing to recover: it is closed at once, never "recovery pending".
    private const TABS = [
        'all'          => 'TRUE',
        'with'         => "link_type = 'with_shipment'",
        'without'      => "COALESCE(link_type, 'standalone') <> 'with_shipment'",
        'cancelinit'   => 'FALSE',
        'cancelclosed' => "status = 'cancelled'",
    ];

    // Only what a list row shows (plus the ids its references are read through).
    private const LIST_COLUMNS = [
        'id', 'code', 'po_date', 'status', 'current_step', 'po_type', 'document_type', 'vendor_id', 'link_type',
        'shipment_order_id', 'proforma_invoice_id', 'procurement_request_id', 'procurement_request_code',
        'expected_delivery_date', 'grand_total', 'physical_inspection', 'inspection_status', 'cancel_reason', 'created_at',
    ];

    /**
     * GET /p2p/orders?tab=&search=&status=&link_type=&shipment_order_id=&procurement_request_id=&vendor_id=&page=&per_page=
     * Server-side paging (10 by default); meta.counts gives every tab's total in one query.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'tab'       => ['nullable', Rule::in(array_keys(self::TABS))],
            'status'    => ['nullable', Rule::in([PurchaseOrder::STATUS_DRAFT, PurchaseOrder::STATUS_SUBMITTED, PurchaseOrder::STATUS_CANCELLED])],
            'link_type' => ['nullable', Rule::in(PurchaseOrder::LINK_TYPES)],
            'per_page'  => 'nullable|integer|min:1|max:50',
            'search'    => 'nullable|string|max:100',
        ]);

        // Filters every tab shares; the tab itself is applied after the counts.
        $base = PurchaseOrder::query();
        if ($s = $request->query('status')) $base->where('status', $s);
        if ($id = $request->integer('shipment_order_id')) $base->where('shipment_order_id', $id);
        if ($id = $request->integer('vendor_id')) $base->where('vendor_id', $id);
        if ($t = $request->query('link_type')) $base->where('link_type', $t);
        if ($id = $request->integer('procurement_request_id')) $base->where('procurement_request_id', $id);
        if ($s = trim((string) $request->query('search'))) {
            $base->where(fn ($w) => $w->where('code', 'ilike', "%{$s}%")
                ->orWhereHas('vendor', fn ($v) => $v->where('vendor_code', 'ilike', "%{$s}%")
                    ->orWhere('company_name', 'ilike', "%{$s}%")
                    ->orWhere('legal_name', 'ilike', "%{$s}%")));
        }

        $counts = (clone $base)->toBase()->selectRaw(implode(', ', array_map(
            fn ($key, $cond) => "COUNT(*) FILTER (WHERE {$cond}) AS \"{$key}\"", array_keys(self::TABS), self::TABS,
        )))->first();

        $tab = $request->query('tab', 'all');
        $page = $base->whereRaw(self::TABS[$tab])
            ->select(self::LIST_COLUMNS)
            ->with(['vendor:id,vendor_code,company_name,legal_name,risk_level_id,supplier_category', 'vendor.riskLevel:id,name'])
            ->orderByDesc('id')
            ->paginate($request->integer('per_page') ?: 10);
        $refs = $this->linkRefs(collect($page->items()));

        return response()->json([
            'status' => true,
            'data'   => collect($page->items())->map(fn ($po) => $this->shapeRow($po) + ($refs[$po->id] ?? []))->all(),
            'meta'   => [
                'total' => $page->total(), 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage(),
                'counts' => array_map('intval', (array) $counts),
            ],
        ]);
    }

    /** GET /p2p/orders/{id} */
    public function show(int $id): JsonResponse
    {
        return $this->ok($this->shapeDetail($this->findPo($id)));
    }

    /** GET /p2p/orders/{id}/qty-history */
    public function qtyHistory(int $id): JsonResponse
    {
        $po = $this->findPo($id);
        $rows = PoItemQtyHistory::where('purchase_order_id', $po->id)->with('changedBy:id,name')
            ->orderBy('created_at')->orderBy('id')->get();
        return $this->ok($rows);
    }

    /* ══════════════════════════ STAGE 01 ══════════════════════════ */

    /** Stage 01 rules (CS-403): all eight basic fields, plus the seven trade fields on an international PO. */
    private function stage1Rules(): array
    {
        $intl = 'required_if:document_type,international|nullable';
        return [
            'po_type'                => ['required', Rule::in(PurchaseOrder::PO_TYPES)],
            'document_type'          => ['required', Rule::in(PurchaseOrder::DOC_TYPES)],
            'mode_of_transport'      => ['required', Rule::in(PurchaseOrder::TRANSPORT_MODES)],
            'expected_delivery_date' => 'required|date|after_or_equal:today',
            'delivery_location'      => 'required|string|max:255',
            'payment_type'           => 'required|string|max:60',
            'physical_inspection'    => ['required', Rule::in(PurchaseOrder::YES_NO)],
            'currency_code'          => "{$intl}|string|max:8",
            'exchange_rate'          => "{$intl}|numeric|gt:0",
            'inco_term'              => [...explode('|', $intl), Rule::in(PurchaseOrder::INCO_TERMS)],
            'port_of_loading'        => "{$intl}|string|max:255",
            'port_of_discharge'      => "{$intl}|string|max:255",
            'final_destination'      => "{$intl}|string|max:128",
            'country_of_origin'      => "{$intl}|string|max:128",
            'link_type'                => ['required', Rule::in(PurchaseOrder::LINK_TYPES)],
            'shipment_order_id'        => 'nullable|required_if:link_type,with_shipment|prohibited_if:link_type,standalone|integer',
            'link_procurement'         => ['nullable', 'required_if:link_type,with_shipment', 'prohibited_if:link_type,standalone', Rule::in(PurchaseOrder::YES_NO)],
            'procurement_request_id'   => 'nullable|required_if:link_procurement,yes|integer',
            'procurement_request_code' => 'nullable|string|max:30',
            'vendor_id'                => 'required|integer',
        ];
    }

    private function stage1Messages(): array
    {
        return [
            'required_if'                           => 'This field is required on an international PO.',
            'expected_delivery_date.after_or_equal' => 'Expected delivery date cannot be earlier than today.',
            'port_of_loading.max'                   => 'Port of loading may not exceed 255 characters.',
            'port_of_discharge.max'                 => 'Port of discharge may not exceed 255 characters.',
            'exchange_rate.gt'                      => 'Exchange rate must be greater than 0.',
            'mode_of_transport.in'                  => 'Mode of transport must be Sea, Road or Air.',
            'inco_term.in'                          => 'INCO term must be CIF, C&F, EXW or FOB.',
        ];
    }

    /** POST /p2p/orders — Stage 01: create the PO as a draft. */
    public function store(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $data = $request->validate($this->stage1Rules(), $this->stage1Messages());
        $resolved = $this->resolveStage1($data, $user);
        if ($resolved instanceof JsonResponse) return $resolved;

        $po = DB::transaction(function () use ($user, $data, $resolved) {
            return PurchaseOrder::create($this->stage1Attributes($data, $resolved) + [
                'client_id'    => $user->client_id,
                'branch_id'    => $user->branch_id,
                'code'         => $this->svc->nextPoCode((int) $user->client_id),
                'po_date'      => now()->toDateString(),
                'status'       => PurchaseOrder::STATUS_DRAFT,
                'current_step' => 1,
                'created_by'   => $user->id,
                'updated_by'   => $user->id,
            ]);
        });

        return $this->ok($this->shapeDetail($po->fresh()), 201);
    }

    /** PUT /p2p/orders/{id}/stage-1 */
    public function updateStage1(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        if ($po->isLocked()) return $this->fail('This PO is cancelled or has a signed document and can no longer be edited.');

        $data = $request->validate($this->stage1Rules(), $this->stage1Messages());
        if (($data['shipment_order_id'] ?? null) != $po->shipment_order_id && $po->items()->exists()) {
            return $this->fail('Remove the product lines before changing the shipment — they are matched to its PI.');
        }
        $resolved = $this->resolveStage1($data, $user);
        if ($resolved instanceof JsonResponse) return $resolved;

        DB::transaction(function () use ($po, $user, $data, $resolved) {
            $vendorChanged = (int) $po->vendor_id !== (int) $data['vendor_id'];
            $attrs = $this->stage1Attributes($data, $resolved) + ['updated_by' => $user->id];
            // A different supplier invalidates any GST approval taken on the old one.
            if ($vendorChanged) {
                $attrs += ['gst_approval_status' => null, 'gst_approval_by' => null, 'gst_approval_at' => null,
                    'gst_approval_requested_by' => null, 'gst_approval_requested_at' => null, 'gst_approval_note' => null];
            }
            if ($attrs['physical_inspection'] === $po->physical_inspection) unset($attrs['inspection_status']);
            $taxChanged = $po->tax_mode !== $attrs['tax_mode'];
            $po->update($attrs);
            if ($taxChanged) $this->retaxItems($po);
        });

        return $this->ok($this->shapeDetail($po->fresh()));
    }

    /** Validates shipment and supplier against the tenant; returns what Stage 01 derives. */
    private function resolveStage1(array $data, $user): array|JsonResponse
    {
        $ship = null;
        if (!empty($data['shipment_order_id'])) {
            $ship = $this->svc->scopeTenant(DB::table('shipment_orders'), 'shipment_orders')
                ->where('id', $data['shipment_order_id'])->first();
            if (!$ship) return $this->fail('Shipment not found', 422, ['errors' => ['shipment_order_id' => ['Shipment not found.']]]);
            // Stage 02 matches lines against this PI, so a shipment without one is unusable.
            if (!$this->svc->piIdForShipment($ship)) return $this->fail('This shipment has no Proforma Invoice', 422, ['errors' => ['shipment_order_id' => ['This shipment has no Proforma Invoice to order against.']]]);
        }
        $vendor = $this->loadVendor((int) $data['vendor_id']);
        if (!$vendor) return $this->fail('Supplier not found', 422, ['errors' => ['vendor_id' => ['Supplier not found.']]]);
        if (str_contains(strtolower((string) $vendor->supplier_category), 'blacklist')) {
            return $this->fail('Blacklisted supplier', 422, ['errors' => ['vendor_id' => ['This supplier is blacklisted — a purchase order cannot be raised on it.']]]);
        }

        $home = $this->svc->homeStateCode($user->branch_id);
        return [
            'ship'      => $ship,
            'pi_id'     => $ship ? $this->svc->piIdForShipment($ship) : null,
            'vendor'    => $vendor,
            'gst'       => $this->svc->gstGate($vendor->id),
            'home'      => $home,
            'tax_mode'  => $this->svc->taxMode($vendor->state_code, $home),
            'mandatory' => $this->inspectionMandatory($vendor),
        ];
    }

    private function stage1Attributes(array $d, array $r): array
    {
        $intl = $d['document_type'] === 'international';
        // A high-risk supplier forces physical inspection on.
        $inspection = $r['mandatory'] ? 'yes' : ($d['physical_inspection'] ?? 'no');
        $v = $r['vendor'];
        $procYes = $d['link_type'] === 'with_shipment' && ($d['link_procurement'] ?? null) === 'yes';
        return [
            'po_type'                => $d['po_type'],
            'document_type'          => $d['document_type'],
            'mode_of_transport'      => $d['mode_of_transport'] ?? null,
            'expected_delivery_date' => $d['expected_delivery_date'] ?? null,
            'delivery_location'      => $d['delivery_location'] ?? null,
            'payment_type'           => $d['payment_type'] ?? null,
            'physical_inspection'    => $inspection,
            'inspection_status'      => $inspection === 'yes' ? 'pending' : 'not_required',
            'currency_code'          => $intl ? ($d['currency_code'] ?? null) : 'INR',
            'exchange_rate'          => $intl ? ($d['exchange_rate'] ?? null) : null,
            'inco_term'              => $intl ? ($d['inco_term'] ?? null) : null,
            'port_of_loading'        => $intl ? ($d['port_of_loading'] ?? null) : null,
            'port_of_discharge'      => $intl ? ($d['port_of_discharge'] ?? null) : null,
            'final_destination'      => $intl ? ($d['final_destination'] ?? null) : null,
            'country_of_origin'      => $intl ? ($d['country_of_origin'] ?? null) : null,
            'link_type'              => $d['link_type'],
            // Procurement link only exists on a shipment PO, and only when toggled yes.
            'link_procurement'       => $d['link_type'] === 'with_shipment' ? $d['link_procurement'] : null,
            'procurement_request_id'   => $procYes ? (int) $d['procurement_request_id'] : null,
            'procurement_request_code' => $procYes ? ($d['procurement_request_code'] ?? null) : null,
            'shipment_order_id'      => $r['ship']->id ?? null,
            'proforma_invoice_id'    => $r['pi_id'],
            'lead_id'                => $r['ship']->lead_id ?? null,
            'vendor_id'              => $v->id,
            'home_state_code'        => $r['home'],
            'tax_mode'               => $r['tax_mode'],
            'gst_gate'               => $r['gst']['gate'],
            'gst_scrutiny_date'      => $r['gst']['scrutiny_date'],
            'gst_last_filing_date'   => $r['gst']['filing_date'],
        ];
    }

    /* ══════════════════════════ STAGE 02 ══════════════════════════ */

    /**
     * PUT /p2p/orders/{id}/items — Stage 02: the 2-way match and the charges.
     * Lines are matched in place (by PI line, or by product for a line with no
     * PI line) so every quantity change lands in the history table.
     */
    public function updateItems(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        if ($po->isLocked()) return $this->fail('This PO is cancelled or has a signed document and can no longer be edited.');

        $data = $request->validate([
            'lines'               => 'required|array|min:1',
            'lines.*.pi_item_id'  => 'nullable|integer|distinct',
            'lines.*.product_id'  => 'nullable|integer|required_without:lines.*.pi_item_id',
            'lines.*.quantity'    => 'required|numeric|gt:0',
            'lines.*.rate'        => 'required|numeric|min:0',
            'lines.*.description' => 'nullable|string',
            'shipping_charges'    => 'nullable|numeric|min:0',
            'packaging_charges'   => 'nullable|numeric|min:0',
            'other_charges'       => 'nullable|numeric|min:0',
        ]);

        $piItemIds = collect($data['lines'])->pluck('pi_item_id')->filter()->map(fn ($v) => (int) $v)->values()->all();
        $piItems = $piItemIds
            ? DB::table('proforma_invoice_items as i')->leftJoin('products as p', 'p.id', '=', 'i.product_id')
                ->whereIn('i.id', $piItemIds)->select('i.*', 'p.product_code')->get()->keyBy('id')
            : collect();

        // Every PI line must belong to this PO's own PI.
        $errors = [];
        foreach ($data['lines'] as $i => $line) {
            if (empty($line['pi_item_id'])) continue;
            $pi = $piItems->get((int) $line['pi_item_id']);
            if (!$pi || (int) $pi->proforma_invoice_id !== (int) $po->proforma_invoice_id) {
                $errors["lines.$i.pi_item_id"] = ['This PI line does not belong to the PO\'s shipment PI.'];
            }
        }

        // Quantity may not exceed what is still pending on the PI line.
        $orderedElsewhere = $this->svc->orderedByPiItem((int) $po->client_id, $piItemIds, $po->id);
        foreach ($data['lines'] as $i => $line) {
            if (empty($line['pi_item_id']) || isset($errors["lines.$i.pi_item_id"])) continue;
            $pi = $piItems->get((int) $line['pi_item_id']);
            $pending = max(0, (float) $pi->quantity - ($orderedElsewhere[(int) $pi->id] ?? 0));
            if ((float) $line['quantity'] > $pending + 0.0005) {
                $errors["lines.$i.quantity"] = ["Only {$pending} is still pending on this PI line."];
            }
        }

        $manual = collect($data['lines'])->filter(fn ($l) => empty($l['pi_item_id']))->pluck('product_id');
        if ($manual->count() !== $manual->unique()->count()) {
            $errors['lines'] = ['The same product appears on two lines without a PI line — merge them into one.'];
        }
        // The ordered product: the replacement if given, else the PI line's own product.
        $effective = [];
        foreach ($data['lines'] as $i => $line) {
            $pi = !empty($line['pi_item_id']) ? $piItems->get((int) $line['pi_item_id']) : null;
            $effective[$i] = !empty($line['product_id']) ? (int) $line['product_id'] : (int) ($pi->product_id ?? 0);
        }
        $products = $this->loadProducts(array_values(array_filter($effective)));
        foreach ($data['lines'] as $i => $line) {
            if (isset($errors["lines.$i.pi_item_id"])) continue;
            $field = !empty($line['product_id']) ? "lines.$i.product_id" : "lines.$i.pi_item_id";
            if (!$effective[$i] || !$products->has($effective[$i])) {
                $errors[$field] = ['Product not found.'];
            } elseif ($products->get($effective[$i])->gst_pct === null) {
                // Purchase GST comes only from the product master, never the sales PI.
                $errors[$field] = ['This product has no GST % in the product master — set it there first.'];
            }
        }
        if ($errors) throw ValidationException::withMessages($errors);

        DB::transaction(function () use ($po, $user, $data, $piItems, $products, $orderedElsewhere) {
            $po->update([
                'shipping_charges'  => $data['shipping_charges'] ?? 0,
                'packaging_charges' => $data['packaging_charges'] ?? 0,
                'other_charges'     => $data['other_charges'] ?? 0,
                'current_step'      => max((int) $po->current_step, 2),
                'updated_by'        => $user->id,
            ]);

            $key = fn ($piItemId, $productId) => $piItemId ? "pi:$piItemId" : "p:$productId";
            $existing = $po->items()->get()->keyBy(fn ($it) => $key($it->pi_item_id, $it->product_id));
            $kept = [];

            foreach (array_values($data['lines']) as $n => $line) {
                $pi = !empty($line['pi_item_id']) ? $piItems->get((int) $line['pi_item_id']) : null;
                $product = $products->get(!empty($line['product_id']) ? (int) $line['product_id'] : (int) ($pi->product_id ?? 0));
                $attrs = $this->lineAttributes($po, $line, $pi, $product, $n + 1);
                $k = $key($attrs['pi_item_id'], $attrs['product_id']);
                $kept[$k] = true;

                $old = $existing->get($k);
                $previous = $old ? (float) $old->quantity : 0.0;
                if ($old) {
                    $old->update($attrs);
                    $item = $old;
                } else {
                    $item = PurchaseOrderItem::create($attrs + ['created_by' => $user->id]);
                }
                if (!$old || abs($previous - (float) $item->quantity) > 0.0005) {
                    $this->logQty($po, $item, $pi, $old ? 'updated' : 'added', $previous, (float) $item->quantity, $orderedElsewhere, $user->id);
                }
            }

            // Lines no longer on the PO release their quantity.
            foreach ($existing as $k => $old) {
                if (isset($kept[$k])) continue;
                $pi = $old->pi_item_id ? DB::table('proforma_invoice_items')->find($old->pi_item_id) : null;
                $this->logQty($po, null, $pi, 'removed', (float) $old->quantity, 0.0, $orderedElsewhere, $user->id, $old);
                $old->delete();
            }

            $this->svc->recomputeTotals($po);
        });

        return $this->ok($this->shapeDetail($po->fresh()));
    }

    private function lineAttributes(PurchaseOrder $po, array $line, ?object $pi, ?object $product, int $lineNo): array
    {
        $gst = (float) $product->gst_pct;   // validated non-null in updateItems
        $amounts = $this->svc->lineAmounts((float) $line['quantity'], (float) $line['rate'], $gst, $po->tax_mode ?: 'intra');
        return [
            'purchase_order_id' => $po->id,
            'line_no'           => $lineNo,
            'pi_item_id'        => $pi->id ?? null,
            // The PO product defaults to the PI's when no replacement is chosen.
            'product_id'        => $product->id ?? ($pi->product_id ?? null),
            'description'       => $line['description'] ?? ($product->description ?? null),
            'quantity'          => $line['quantity'],
            'rate'              => $line['rate'],
            'gst_pct'           => $gst,
        ] + $amounts;
    }

    /** Re-applies tax to every line after the tax mode changed (supplier or branch state). */
    private function retaxItems(PurchaseOrder $po): void
    {
        foreach ($po->items()->get() as $item) {
            $item->update($this->svc->lineAmounts((float) $item->quantity, (float) $item->rate, (float) $item->gst_pct, $po->tax_mode ?: 'intra'));
        }
        $this->svc->recomputeTotals($po);
    }

    /** One append-only history row. pending_after = PI qty − (ordered on other POs + this line now). */
    private function logQty(PurchaseOrder $po, ?PurchaseOrderItem $item, ?object $pi, string $event,
                            float $previous, float $current, array $orderedElsewhere, int $userId, ?PurchaseOrderItem $removed = null): void
    {
        $piQty = $pi ? (float) $pi->quantity : null;
        $pending = $pi ? max(0, $piQty - ($orderedElsewhere[(int) $pi->id] ?? 0) - $current) : null;
        PoItemQtyHistory::create([
            'client_id'              => $po->client_id,
            'branch_id'              => $po->branch_id,
            'purchase_order_id'      => $po->id,
            'purchase_order_item_id' => $item?->id,
            'pi_item_id'             => $pi->id ?? ($removed?->pi_item_id),
            'shipment_order_id'      => $po->shipment_order_id,
            'product_id'             => $item?->product_id ?? $removed?->product_id,
            'event'                  => $event,
            'pi_quantity'            => $piQty,
            'previous_qty'           => $previous,
            'current_qty'            => $current,
            'change_qty'             => round($current - $previous, 3),
            'pending_after'          => $pending,
            'changed_by'             => $userId,
        ]);
    }

    /* ══════════════════════════ STAGE 03 ══════════════════════════ */

    /** PUT /p2p/orders/{id}/terms — Stage 03: terms, and optionally submit the PO. */
    public function updateTerms(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        if ($po->isLocked()) return $this->fail('This PO is cancelled or has a signed document and can no longer be edited.');

        $data = $request->validate([
            'terms'  => 'nullable|string|max:20000',
            'submit' => ['nullable', Rule::in(PurchaseOrder::YES_NO)],
        ]);
        $submit = ($data['submit'] ?? 'no') === 'yes';

        if ($submit) {
            if (!$po->vendor_id) return $this->fail('Select a supplier before submitting.');
            if (!$po->items()->exists()) return $this->fail('Add at least one product line before submitting.');
            // Re-read the supplier's GST position at the moment of submission.
            $gst = $this->svc->gstGate($po->vendor_id);
            $po->forceFill(['gst_gate' => $gst['gate'], 'gst_scrutiny_date' => $gst['scrutiny_date'], 'gst_last_filing_date' => $gst['filing_date']]);
            if ($gst['gate'] === 'blocked') {
                return $this->fail('GST scrutiny is older than ' . PurchaseOrderService::GST_STALE_MONTHS . ' months — refresh it on the supplier record before submitting.', 422, ['gst' => $gst]);
            }
            if ($gst['gate'] === 'approval_required' && $po->gst_approval_status !== 'approved') {
                return $this->fail('The supplier\'s last GST return is overdue — senior approval is required before submitting.', 422, ['gst' => $gst, 'gst_approval_status' => $po->gst_approval_status]);
            }
        }

        DB::transaction(function () use ($po, $user, $data, $submit) {
            $attrs = ['terms' => $data['terms'] ?? null, 'current_step' => max((int) $po->current_step, 3), 'updated_by' => $user->id];
            if ($submit && $po->status === PurchaseOrder::STATUS_DRAFT) {
                $attrs += ['status' => PurchaseOrder::STATUS_SUBMITTED, 'submitted_at' => now(), 'submitted_by' => $user->id, 'current_step' => 4];
            }
            $po->update($attrs);
            if ($submit) $this->ensureDefaultDocuments($po, $user->id);
        });
        // dompdf takes seconds, so the PO PDF renders in the background; Step 04 polls for it.
        if ($submit) \App\Jobs\P2p\GeneratePoDocumentPdf::dispatch($po->id, $user->id)->afterCommit();

        return $this->ok($this->shapeDetail($po->fresh()));
    }

    /** The two documents Stage 04 always carries, created once on submission. */
    private function ensureDefaultDocuments(PurchaseOrder $po, int $userId): void
    {
        foreach ([['purchase_order', 'Purchase Order'], ['agreement', 'Purchase Agreement']] as [$kind, $name]) {
            if ($po->documents()->where('doc_kind', $kind)->exists()) continue;
            PurchaseOrderDocument::create([
                'client_id'         => $po->client_id,
                'branch_id'         => $po->branch_id,
                'purchase_order_id' => $po->id,
                'code'              => $this->svc->nextDocCode((int) $po->client_id),
                'name'              => $name,
                'doc_kind'          => $kind,
                'is_required'       => 'yes',
                'generated_on'      => now()->toDateString(),
                'status'            => PurchaseOrderDocument::STATUS_PENDING,
                'created_by'        => $userId,
                'updated_by'        => $userId,
            ]);
        }
    }

    /* ══════════════════════════ GST APPROVAL ══════════════════════════ */

    /** POST /p2p/orders/{id}/gst-approval/request */
    public function requestGstApproval(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        $data = $request->validate(['note' => 'nullable|string|max:1000']);
        if ($po->gst_gate !== 'approval_required') return $this->fail('This PO does not need GST approval.');
        if ($po->gst_approval_status === 'approved') return $this->fail('GST approval is already granted.');

        $po->update(['gst_approval_status' => 'pending', 'gst_approval_requested_by' => $user->id,
            'gst_approval_requested_at' => now(), 'gst_approval_note' => $data['note'] ?? null, 'updated_by' => $user->id]);
        return $this->ok($this->shapeDetail($po->fresh()));
    }

    /** POST /p2p/orders/{id}/gst-approval/decide — the requester cannot decide their own request. */
    public function decideGstApproval(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        $data = $request->validate([
            'decision' => ['required', Rule::in(['approved', 'rejected'])],
            'note'     => 'nullable|required_if:decision,rejected|string|max:1000',
        ]);
        if ($po->gst_approval_status !== 'pending') return $this->fail('There is no pending GST approval on this PO.');
        if ((int) $po->gst_approval_requested_by === (int) $user->id) {
            return $this->fail('You requested this approval — another person must decide it.', 403);
        }
        $po->update(['gst_approval_status' => $data['decision'], 'gst_approval_by' => $user->id,
            'gst_approval_at' => now(), 'gst_approval_note' => $data['note'] ?? $po->gst_approval_note, 'updated_by' => $user->id]);
        return $this->ok($this->shapeDetail($po->fresh()));
    }

    /* ══════════════════════════ CANCEL / DELETE ══════════════════════════ */

    /** POST /p2p/orders/{id}/cancel — releases every line's quantity back to the PI. */
    public function cancel(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        $data = $request->validate(['reason' => 'required|string|max:1000']);
        if ($po->isCancelled()) return $this->fail('This PO is already cancelled.');

        DB::transaction(function () use ($po, $user, $data) {
            $this->releaseAll($po, 'cancelled', $user->id);
            $po->update(['status' => PurchaseOrder::STATUS_CANCELLED, 'cancelled_at' => now(),
                'cancelled_by' => $user->id, 'cancel_reason' => $data['reason'], 'updated_by' => $user->id]);
        });
        return $this->ok($this->shapeDetail($po->fresh()));
    }

    /** DELETE /p2p/orders/{id} — drafts only; a submitted PO is cancelled instead. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = $this->findPo($id);
        if ($po->status !== PurchaseOrder::STATUS_DRAFT) return $this->fail('Only a draft PO can be deleted — cancel a submitted PO instead.');

        DB::transaction(function () use ($po, $user) {
            $this->releaseAll($po, 'deleted', $user->id);
            $po->update(['updated_by' => $user->id]);
            $po->delete();
        });
        return $this->ok(['id' => $id, 'deleted' => true]);
    }

    /** History rows returning each line's quantity to its PI line. */
    private function releaseAll(PurchaseOrder $po, string $event, int $userId): void
    {
        $items = $po->items()->get();
        $piIds = $items->pluck('pi_item_id')->filter()->map(fn ($v) => (int) $v)->all();
        $orderedElsewhere = $this->svc->orderedByPiItem((int) $po->client_id, $piIds, $po->id);
        $piItems = $piIds ? DB::table('proforma_invoice_items')->whereIn('id', $piIds)->get()->keyBy('id') : collect();
        foreach ($items as $item) {
            $pi = $item->pi_item_id ? $piItems->get((int) $item->pi_item_id) : null;
            $this->logQty($po, $item, $pi, $event, (float) $item->quantity, 0.0, $orderedElsewhere, $userId);
        }
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /** A supplier of this tenant, with its primary address state code. */
    private function loadVendor(int $id): ?object
    {
        $q = DB::table('vendors as v')
            ->leftJoin('vendor_addresses as a', fn ($j) => $j->on('a.vendor_id', '=', 'v.id')->where('a.is_primary', true))
            ->leftJoin('master_risk_levels as r', 'r.id', '=', 'v.risk_level_id')
            ->whereNull('v.deleted_at')
            ->where('v.id', $id)
            ->select('v.id', 'v.vendor_code', 'v.company_name', 'v.legal_name', 'v.gst_number',
                'v.supplier_category', 'a.state_code', 'r.name as risk_level');
        return $this->svc->scopeTenant($q, 'v')->first();
    }

    /** Like loadVendor, but still finds a supplier deleted after the PO was raised. */
    private function loadVendorAnyState(int $id): ?object
    {
        $q = DB::table('vendors as v')
            ->leftJoin('vendor_addresses as a', fn ($j) => $j->on('a.vendor_id', '=', 'v.id')->where('a.is_primary', true))
            ->where('v.id', $id)
            ->select('v.id', 'v.vendor_code', 'v.company_name', 'v.legal_name', 'v.gst_number', 'a.state_code');
        return $this->svc->scopeTenant($q, 'v')->first();
    }

    /** High / medium risk together with a high-risk or blacklisted category forces inspection. */
    private function inspectionMandatory(object $vendor): bool
    {
        $risk = strtolower((string) ($vendor->risk_level ?? ''));
        $cat  = strtolower((string) ($vendor->supplier_category ?? ''));
        return (str_contains($risk, 'high') || str_contains($risk, 'medium'))
            && (str_contains($cat, 'high') || str_contains($cat, 'blacklist'));
    }

    /** Products of this tenant with their GST %, HSN and UOM resolved from the masters. */
    private function loadProducts(array $ids)
    {
        if (!$ids) return collect();
        $q = DB::table('products as p')
            ->leftJoin('master_gst_percentage as g', 'g.id', '=', 'p.gst_id')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->whereNull('p.deleted_at')
            ->whereIn('p.id', array_map('intval', $ids))
            ->select('p.id', 'p.product_code', 'p.name', 'p.description', 'g.percentage as gst_pct',
                'h.hsn_code', DB::raw('COALESCE(u.short_code, u.title) as uom'));
        return $this->svc->scopeTenant($q, 'p')->get()->keyBy('id');
    }

    /** PI lines with ordered and pending quantity (all branches of the client count). */
    private function piLinesWithPending(int $piId, int $clientId, ?int $excludePoId): array
    {
        $lines = DB::table('proforma_invoice_items as i')
            ->leftJoin('products as p', 'p.id', '=', 'i.product_id')
            ->leftJoin('master_gst_percentage as g', 'g.id', '=', 'p.gst_id')
            ->where('i.proforma_invoice_id', $piId)
            ->orderBy('i.line_no')->orderBy('i.id')
            ->get(['i.id', 'i.product_id', 'p.product_code', 'i.product_name', 'i.hsn_code', 'i.unit',
                'i.quantity', 'i.rate', 'i.line_no', 'g.percentage as gst_pct', 'p.description']);
        $ordered = $this->svc->orderedByPiItem($clientId, $lines->pluck('id')->all(), $excludePoId);
        return $lines->map(function ($l) use ($ordered) {
            $done = $ordered[(int) $l->id] ?? 0;
            return [
                'pi_item_id'   => $l->id,
                'product_id'   => $l->product_id,
                'product_code' => $l->product_code,
                'product_name' => $l->product_name,
                'hsn_code'     => $l->hsn_code,
                'uom'          => $l->unit,
                'rate'         => (float) $l->rate,
                // Purchase GST from the product master; null = not set there
                'gst_pct'      => $l->gst_pct !== null ? (float) $l->gst_pct : null,
                'description'  => $l->description,
                'pi_quantity'  => (float) $l->quantity,
                'ordered_qty'  => $done,
                'pending_qty'  => max(0, (float) $l->quantity - $done),
            ];
        })->all();
    }

    /** Shipment, PI, opportunity and customer codes for the header pills and list, read live. */
    private function linkRefs($pos): array
    {
        $shipIds = $pos->pluck('shipment_order_id')->filter()->unique()->values()->all();
        $piIds   = $pos->pluck('proforma_invoice_id')->filter()->unique()->values()->all();
        $ships = $shipIds ? DB::table('shipment_orders')->whereIn('id', $shipIds)->get(['id', 'shipment_code', 'created_at'])->keyBy('id') : collect();
        $pis   = $piIds ? DB::table('proforma_invoices')->whereIn('id', $piIds)->get(['id', 'code', 'customer_name', 'opp_code', 'created_at'])->keyBy('id') : collect();
        $out = [];
        foreach ($pos as $po) {
            $sh = $ships->get($po->shipment_order_id);
            $pi = $pis->get($po->proforma_invoice_id);
            $out[$po->id] = [
                'shipment_code'    => $sh->shipment_code ?? null,
                'shipment_date'    => isset($sh->created_at) ? substr((string) $sh->created_at, 0, 10) : null,
                'pi_code'          => $pi->code ?? null,
                'customer_name'    => $pi->customer_name ?? null,
                'opportunity_code' => $pi->opp_code ?? null,
                'pi_date'          => isset($pi->created_at) ? substr((string) $pi->created_at, 0, 10) : null,
            ];
        }
        return $out;
    }

    private function shapeRow(PurchaseOrder $po): array
    {
        return [
            'id'                  => $po->id,
            'code'                => $po->code,
            'po_date'             => $po->po_date?->toDateString(),
            'status'              => $po->status,
            'current_step'        => $po->current_step,
            'po_type'             => $po->po_type,
            'document_type'       => $po->document_type,
            'vendor_id'           => $po->vendor_id,
            'supplier_code'       => $po->vendor?->vendor_code,
            'supplier_name'       => $po->vendor ? ($po->vendor->legal_name ?: $po->vendor->company_name) : null,
            'link_type'           => $po->link_type,
            'shipment_order_id'   => $po->shipment_order_id,
            'procurement_request_id'   => $po->procurement_request_id,
            'procurement_request_code' => $po->procurement_request_code,
            'supplier_risk'       => $po->vendor?->riskLevel?->name,
            'supplier_category'   => $po->vendor?->supplier_category,
            'expected_delivery_date' => $po->expected_delivery_date?->toDateString(),
            'grand_total'         => (float) $po->grand_total,
            'physical_inspection' => $po->physical_inspection,
            'inspection_status'   => $po->inspection_status,
            'cancel_reason'       => $po->cancel_reason,
            'created_at'          => $po->created_at?->toIso8601String(),
        ];
    }

    private function shapeDetail(PurchaseOrder $po): array
    {
        $po->load(['items.inspection', 'documents', 'creator:id,name']);
        $pending = [];
        if ($po->proforma_invoice_id) {
            foreach ($this->piLinesWithPending((int) $po->proforma_invoice_id, (int) $po->client_id, $po->id) as $l) {
                $pending[$l['pi_item_id']] = $l['pending_qty'];
            }
        }
        $out = $po->toArray() + ($this->linkRefs(collect([$po]))[$po->id] ?? []);
        $out['created_by_name'] = $po->creator?->name;
        // Supplier is read live from vendors (same shape as the Stage 01 supplier lookup).
        $v = $po->vendor_id ? $this->loadVendorAnyState((int) $po->vendor_id) : null;
        $out['supplier'] = $v ? [
            'vendor_id'           => $v->id,
            'supplier_code'       => $v->vendor_code,
            'supplier_name'       => $v->legal_name ?: $v->company_name,
            'supplier_gstin'      => $v->gst_number,
            'supplier_state_code' => $v->state_code,
        ] : null;
        $inter = $po->tax_mode === 'inter';
        $live = $this->svc->lineDetails($po->items);
        $out['items'] = $po->items->map(fn ($it) => $it->toArray() + $live[$it->id] + [
            // Rate split and GST total are derived from the stored amounts, not stored twice.
            'cgst_pct'   => $inter ? 0 : round((float) $it->gst_pct / 2, 2),
            'sgst_pct'   => $inter ? 0 : round((float) $it->gst_pct / 2, 2),
            'igst_pct'   => $inter ? (float) $it->gst_pct : 0,
            'gst_amount' => round((float) $it->cgst_amount + (float) $it->sgst_amount + (float) $it->igst_amount, 2),
            // What this PI line could still take on this PO (excluding this PO's own qty).
            'pending_before_this_po' => $it->pi_item_id ? ($pending[$it->pi_item_id] ?? null) : null,
            'missing_qty'            => $live[$it->id]['pi_quantity'] !== null ? max(0, $live[$it->id]['pi_quantity'] - (float) $it->quantity) : null,
        ])->all();
        return $out;
    }
}
