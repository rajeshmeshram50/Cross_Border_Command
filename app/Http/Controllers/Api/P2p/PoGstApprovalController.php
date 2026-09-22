<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PoGstApproval;
use App\Models\P2p\PurchaseOrder;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Senior approval for a PO whose supplier's GST return is overdue.
 * The requester raises it to one senior; only that senior approves or rejects,
 * from their Inbox. The approver may sit in another branch, so their reads are
 * scoped to the client, not the request branch.
 */
class PoGstApprovalController extends Controller
{
    use RunsInTransaction;

    public function __construct(private PurchaseOrderService $svc) {}

    private function ok($data, int $code = 200, array $extra = []): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data] + $extra, $code);
    }

    private function fail(string $message, int $code = 422): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message], $code);
    }

    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        return $user;
    }

    /** PO ids of the client, across branches. */
    private function clientPoIds(int $clientId)
    {
        return PurchaseOrder::withoutGlobalScope('tenant')->where('client_id', $clientId)->select('id');
    }

    private function findApproval(int $clientId, int $id): PoGstApproval
    {
        return PoGstApproval::whereIn('purchase_order_id', $this->clientPoIds($clientId))->findOrFail($id);
    }

    /* ══════════════════════════ REQUESTER ══════════════════════════ */

    /**
     * GET /p2p/orders/gst-approvals/approvers — active users of the client, except the caller,
     * with department and designation from their employee record. The request stores the user id:
     * approving needs a login, and that is what the Inbox and bell are keyed on.
     */
    public function approvers(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $rows = DB::table('users as u')
            ->leftJoin('employees as e', fn ($j) => $j->on('e.user_id', '=', 'u.id')->whereNull('e.deleted_at'))
            ->leftJoin('master_departments as d', 'd.id', '=', 'e.department_id')
            ->leftJoin('master_designations as g', 'g.id', '=', 'e.designation_id')
            ->where('u.client_id', $user->client_id)
            ->where('u.status', 'active')
            ->whereNull('u.deleted_at')
            ->where('u.id', '!=', $user->id)
            ->orderByRaw("CASE WHEN u.user_type = 'client_admin' THEN 0 ELSE 1 END")
            ->orderBy('u.name')
            ->get(['u.id', 'u.name', 'u.email', 'u.user_type', 'e.id as employee_id', 'e.emp_code',
                'd.name as department', DB::raw('COALESCE(g.name, u.designation) as designation')]);
        return $this->ok($rows->unique('id')->values());
    }

    /** POST /p2p/orders/{id}/gst-approval/request */
    public function store(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = PurchaseOrder::findOrFail($id);

        // A PO that was rejected goes back to the senior who rejected it — the
        // requester does not get to shop around for a softer approver. Any
        // requested_to sent with it is ignored. Only if that senior is no longer
        // active does the pick open up again.
        $last = $po->gstApprovals()->latest('id')->first();
        $sameApprover = $last && $last->status === PoGstApproval::STATUS_REJECTED
            ? DB::table('users')->where('id', $last->requested_to)->where('client_id', $user->client_id)
                ->where('status', 'active')->whereNull('deleted_at')->first(['id', 'name'])
            : null;

        $data = $request->validate([
            'requested_to' => [$sameApprover ? 'nullable' : 'required', 'integer'],
            'note'         => 'nullable|string|max:1000',
        ], ['requested_to.required' => 'Select the senior to send this request to.']);
        $targetId = $sameApprover->id ?? $data['requested_to'];

        if ($po->isCancelled()) return $this->fail('This PO is cancelled.');
        if (!$po->vendor_id) return $this->fail('Select a supplier on Step 01 first.');

        // The gate is re-read live: only an overdue return can be approved past.
        $gst = $this->svc->gstGate($po->vendor_id, $po->document_type === 'international');
        if ($gst['gate'] === 'blocked') {
            return $this->fail('GST scrutiny is older than ' . PurchaseOrderService::GST_STALE_MONTHS . ' months — a senior cannot approve this. Update the supplier\'s GST scrutiny first.');
        }
        if ($gst['gate'] === 'clear') return $this->fail('The supplier\'s GST is up to date — this PO needs no approval.');

        $open = $po->gstApprovals()->whereIn('status', [PoGstApproval::STATUS_PENDING, PoGstApproval::STATUS_APPROVED])->latest('id')->first();
        if ($open?->status === PoGstApproval::STATUS_APPROVED) return $this->fail('This PO is already approved — you can submit it.');
        if ($open) return $this->fail('A request is already waiting on ' . (DB::table('users')->where('id', $open->requested_to)->value('name') ?? 'the approver') . '.');

        $approver = DB::table('users')->where('id', $targetId)->where('client_id', $user->client_id)
            ->where('status', 'active')->whereNull('deleted_at')->first(['id', 'name']);
        if (!$approver) return $this->fail('Select an active user of your company as the approver.');
        if ((int) $approver->id === (int) $user->id) return $this->fail('You cannot approve your own request — choose a senior.');

        $row = $this->inTransaction('send the approval request', function () use ($po, $user, $data, $gst, $targetId) {
            $row = PoGstApproval::create([
                'purchase_order_id' => $po->id,
                'requested_by'      => $user->id,
                'requested_to'      => $targetId,
                'request_note'      => $data['note'] ?? null,
                'requested_at'      => now(),
                'status'            => PoGstApproval::STATUS_PENDING,
            ]);
            $po->update([
                'gst_gate' => $gst['gate'], 'gst_scrutiny_date' => $gst['scrutiny_date'], 'gst_last_filing_date' => $gst['filing_date'],
                'gst_approval_status' => 'pending', 'updated_by' => $user->id,
            ]);
            return $row;
        });

        $this->notify((int) $approver->id, [
            'kind'       => 'submitted_to_approver',
            'subject'    => "{$po->code} needs your GST approval",
            'message'    => "{$user->name} asked you to approve {$po->code} — the supplier's GST return is overdue.",
            'action_url' => "/inbox/po-approval/{$row->id}",
        ]);

        return $this->ok($this->shapeRow($row->fresh(), $this->names([$row->requested_by, $row->requested_to])), 201);
    }

    /* ══════════════════════════ APPROVER ══════════════════════════ */

    /** GET /p2p/orders/gst-approvals?history=1 — requests sent to the caller, 10 per page. */
    public function index(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $history = $request->boolean('history');
        $perPage = max(1, min(50, (int) $request->integer('per_page', 10)));

        $q = DB::table('p2p_po_gst_approvals as a')
            ->join('p2p_purchase_orders as po', 'po.id', '=', 'a.purchase_order_id')
            ->leftJoin('vendors as v', 'v.id', '=', 'po.vendor_id')
            ->leftJoin('users as rq', 'rq.id', '=', 'a.requested_by')
            ->leftJoin('employees as re', fn ($j) => $j->on('re.user_id', '=', 'rq.id')->whereNull('re.deleted_at'))
            ->leftJoin('master_departments as rd', 'rd.id', '=', 're.department_id')
            ->leftJoin('master_designations as rg', 'rg.id', '=', 're.designation_id')
            ->where('po.client_id', $user->client_id)
            ->whereNull('po.deleted_at')
            ->where('a.requested_to', $user->id);
        if ($history) {
            $q->where('a.status', '!=', PoGstApproval::STATUS_PENDING)->orderByDesc('a.decided_at');
        } else {
            // A cancelled PO no longer needs a decision.
            $q->where('a.status', PoGstApproval::STATUS_PENDING)->where('po.status', '!=', PurchaseOrder::STATUS_CANCELLED)->orderByDesc('a.requested_at');
        }

        $page = $q->select(
            'a.id', 'a.purchase_order_id', 'a.status', 'a.request_note', 'a.reason', 'a.requested_at', 'a.decided_at',
            'po.code as po_code', 'po.po_date', 'po.status as po_status', 'po.currency_code', 'po.grand_total',
            'po.gst_last_filing_date', 'v.vendor_code as supplier_code',
            DB::raw('COALESCE(v.legal_name, v.company_name) as supplier_name'),
            'rq.name as requested_by_name', DB::raw('COALESCE(rg.name, rq.designation) as requested_by_designation'),
            'rd.name as requested_by_department',
        )->paginate($perPage);

        // Raw query rows carry DB timestamps with no zone ("2026-09-21 14:47:36"), which a
        // browser reads as its own local time. Send them as ISO 8601 with the offset, the
        // same as show() does via shapeRow(), so both screens show the same time.
        $iso = fn ($v) => $v ? \Illuminate\Support\Carbon::parse($v)->toIso8601String() : null;
        return $this->ok(collect($page->items())->map(fn ($r) => [
            'grand_total'  => (float) $r->grand_total,
            'requested_at' => $iso($r->requested_at),
            'decided_at'   => $iso($r->decided_at),
        ] + (array) $r)->all(), 200, [
            'meta' => ['total' => $page->total(), 'per_page' => $page->perPage(), 'current_page' => $page->currentPage(), 'last_page' => $page->lastPage()],
        ]);
    }

    /** GET /p2p/orders/gst-approvals/{approval} — the full picture the senior decides on. */
    public function show(Request $request, int $approval): JsonResponse
    {
        $user = $this->tenantUser($request);
        $row = $this->findApproval((int) $user->client_id, $approval);
        if (!in_array((int) $user->id, [(int) $row->requested_to, (int) $row->requested_by], true)) {
            return $this->fail('This request was not sent to you.', 403);
        }
        $po = PurchaseOrder::withoutGlobalScope('tenant')->withTrashed()->with('items')->findOrFail($row->purchase_order_id);

        $vendor = $po->vendor_id ? DB::table('vendors as v')
            ->leftJoin('vendor_addresses as ad', fn ($j) => $j->on('ad.vendor_id', '=', 'v.id')->where('ad.is_primary', true))
            ->leftJoin('master_risk_levels as r', 'r.id', '=', 'v.risk_level_id')
            ->where('v.id', $po->vendor_id)->where('v.client_id', $user->client_id)
            ->first(['v.id', 'v.vendor_code', 'v.company_name', 'v.legal_name', 'v.gst_number', 'v.supplier_category',
                'ad.state_code', 'r.name as risk_level']) : null;

        $refs = $this->refs($po);
        $live = $this->svc->lineDetails($po->items);
        $inter = $po->tax_mode === 'inter';

        return $this->ok([
            'request' => $this->shapeRow($row, $this->names([$row->requested_by, $row->requested_to])),
            'can_decide' => (int) $row->requested_to === (int) $user->id && $row->status === PoGstApproval::STATUS_PENDING
                && !$po->trashed() && !$po->isCancelled(),
            'po' => [
                'id' => $po->id, 'code' => $po->code, 'po_date' => $po->po_date?->toDateString(), 'status' => $po->trashed() ? 'deleted' : $po->status,
                'po_type' => $po->po_type, 'document_type' => $po->document_type, 'link_type' => $po->link_type,
                'currency_code' => $po->currency_code, 'exchange_rate' => (float) $po->exchange_rate,
                'mode_of_transport' => $po->mode_of_transport, 'expected_delivery_date' => $po->expected_delivery_date?->toDateString(),
                'delivery_location' => $po->delivery_location, 'payment_type' => $po->payment_type,
                'inco_term' => $po->inco_term, 'port_of_loading' => $po->port_of_loading, 'port_of_discharge' => $po->port_of_discharge,
                'tax_mode' => $po->tax_mode, 'physical_inspection' => $po->physical_inspection,
                'taxable_total' => (float) $po->taxable_total, 'total_cgst' => (float) $po->total_cgst,
                'total_sgst' => (float) $po->total_sgst, 'total_igst' => (float) $po->total_igst,
                'shipping_charges' => (float) $po->shipping_charges, 'packaging_charges' => (float) $po->packaging_charges,
                'other_charges' => (float) $po->other_charges, 'grand_total' => (float) $po->grand_total,
                'created_by_name' => DB::table('users')->where('id', $po->created_by)->value('name'),
            ] + $refs,
            'supplier' => $vendor ? [
                'code' => $vendor->vendor_code, 'name' => $vendor->legal_name ?: $vendor->company_name,
                'gstin' => $vendor->gst_number, 'state_code' => $vendor->state_code,
                'risk' => $vendor->risk_level, 'category' => $vendor->supplier_category,
            ] : null,
            // Read live, so the senior sees today's position, not the one at request time.
            'gst' => $po->vendor_id ? $this->svc->gstGate($po->vendor_id, $po->document_type === 'international') + ['stale_months' => PurchaseOrderService::GST_STALE_MONTHS] : null,
            'lines' => $po->items->map(fn ($it) => [
                'line_no' => $it->line_no,
                'product_code' => $live[$it->id]['product_code'] ?? null,
                'product_name' => $live[$it->id]['product_name'] ?? null,
                'hsn_code' => $live[$it->id]['hsn_code'] ?? null,
                'uom' => $live[$it->id]['uom'] ?? null,
                'quantity' => (float) $it->quantity, 'rate' => (float) $it->rate, 'gst_pct' => (float) $it->gst_pct,
                'taxable_amount' => (float) $it->taxable_amount,
                'gst_amount' => round((float) $it->cgst_amount + (float) $it->sgst_amount + (float) $it->igst_amount, 2),
                'line_total' => (float) $it->line_total,
            ])->values()->all(),
            'tax_label' => $inter ? 'IGST' : 'CGST + SGST',
            'history' => $po->gstApprovals()->orderByDesc('id')->get()->map(fn ($h) => $this->shapeRow($h, $this->names([$h->requested_by, $h->requested_to])))->all(),
        ]);
    }

    /** PUT /p2p/orders/gst-approvals/{approval} — only the chosen senior; a reason either way. */
    public function decide(Request $request, int $approval): JsonResponse
    {
        $user = $this->tenantUser($request);
        $row = $this->findApproval((int) $user->client_id, $approval);
        $data = $request->validate([
            'decision' => ['required', Rule::in([PoGstApproval::STATUS_APPROVED, PoGstApproval::STATUS_REJECTED])],
            'reason'   => 'required|string|max:1000',
        ], ['reason.required' => 'Give a reason for your decision.']);

        if ((int) $row->requested_to !== (int) $user->id) return $this->fail('Only the senior this was sent to can decide it.', 403);
        if ($row->status !== PoGstApproval::STATUS_PENDING) return $this->fail('This request is already ' . $row->status . '.');
        $po = PurchaseOrder::withoutGlobalScope('tenant')->find($row->purchase_order_id);
        if (!$po || $po->isCancelled()) return $this->fail('This PO was cancelled or deleted — there is nothing to decide.');

        $this->inTransaction('record the decision', function () use ($row, $po, $user, $data) {
            $row->update(['status' => $data['decision'], 'reason' => $data['reason'], 'decided_at' => now()]);
            $po->update(['gst_approval_status' => $data['decision'], 'gst_approval_by' => $user->id,
                'gst_approval_at' => now(), 'updated_by' => $user->id]);
        });

        $ok = $data['decision'] === PoGstApproval::STATUS_APPROVED;
        $this->notify((int) $row->requested_by, [
            'kind'       => $ok ? 'approved' : 'rejected',
            'subject'    => "{$po->code} GST approval " . ($ok ? 'approved' : 'rejected'),
            'message'    => "{$user->name} " . ($ok ? 'approved' : 'rejected') . " {$po->code}: {$data['reason']}",
            'action_url' => '/p2p/order',
        ]);

        return $this->ok($this->shapeRow($row->fresh(), $this->names([$row->requested_by, $row->requested_to])));
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /** @return array<int,string> user id => name */
    private function names(array $ids): array
    {
        return DB::table('users')->whereIn('id', array_filter($ids))->pluck('name', 'id')->all();
    }

    public function shapeRow(PoGstApproval $r, array $names): array
    {
        return [
            'id'                => $r->id,
            'purchase_order_id' => $r->purchase_order_id,
            'status'            => $r->status,
            'requested_by'      => $r->requested_by,
            'requested_by_name' => $names[$r->requested_by] ?? null,
            'requested_to'      => $r->requested_to,
            'requested_to_name' => $names[$r->requested_to] ?? null,
            'request_note'      => $r->request_note,
            'requested_at'      => $r->requested_at?->toIso8601String(),
            'reason'            => $r->reason,
            'decided_at'        => $r->decided_at?->toIso8601String(),
        ];
    }

    private function refs(PurchaseOrder $po): array
    {
        $sh = $po->shipment_order_id ? DB::table('shipment_orders')->where('id', $po->shipment_order_id)->first(['shipment_code']) : null;
        $pi = $po->proforma_invoice_id ? DB::table('proforma_invoices')->where('id', $po->proforma_invoice_id)->first(['code', 'customer_name', 'opp_code']) : null;
        return [
            'shipment_code' => $sh->shipment_code ?? null, 'pi_code' => $pi->code ?? null,
            'customer_name' => $pi->customer_name ?? null, 'opportunity_code' => $pi->opp_code ?? null,
        ];
    }

    /** Bell notification; a failed insert never undoes the request itself. */
    private function notify(int $userId, array $data): void
    {
        try {
            DB::table('notifications')->insert([
                'id' => (string) Str::uuid(), 'type' => 'App\\Notifications\\PoGstApproval',
                'notifiable_type' => \App\Models\User::class, 'notifiable_id' => $userId,
                'data' => json_encode($data), 'read_at' => null, 'created_at' => now(), 'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('P2P PO: approval notification failed', ['user' => $userId, 'err' => $e->getMessage()]);
        }
    }
}
