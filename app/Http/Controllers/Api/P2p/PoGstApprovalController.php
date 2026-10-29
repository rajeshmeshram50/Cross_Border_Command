<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PoGstApproval;
use App\Models\P2p\SupplierInvoice;
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

    private function clientSpiIds(int $clientId)
    {
        return SupplierInvoice::withoutGlobalScope('tenant')->where('client_id', $clientId)->select('id');
    }

    /* An approval hangs off a PO or off a Direct SPI, never both. Fencing on
       purchase_order_id alone dropped every SPI-raised row: NULL never matches
       an IN (...), so show() and decide() answered 404. */
    private function findApproval(int $clientId, int $id): PoGstApproval
    {
        return PoGstApproval::where(fn ($q) => $q
            ->whereIn('purchase_order_id', $this->clientPoIds($clientId))
            ->orWhereIn('supplier_invoice_id', $this->clientSpiIds($clientId)))
            ->findOrFail($id);
    }

    /** The PO or the Direct SPI an approval was raised against. */
    private function subjectOf(PoGstApproval $row, bool $withItems = false)
    {
        $q = $row->purchase_order_id
            ? PurchaseOrder::withoutGlobalScope('tenant')->withTrashed()
            : SupplierInvoice::withoutGlobalScope('tenant')->withTrashed();
        if ($withItems) $q->with('items');

        return $q->find($row->purchase_order_id ?: $row->supplier_invoice_id);
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
            /* A branch head is the senior of their branch, so they may always pick
               themselves. Everyone else is listed only when the caller asks for it
               (?include_self=1) — a payment request may be sent to yourself, a senior
               GST approval may not. */
            ->when($user->user_type !== 'branch_user' && !$request->boolean('include_self'),
                fn ($q) => $q->where('u.id', '!=', $user->id))
            // This branch's people only — the branch head is the last approver, so the
            // client admin is never sent a PO approval.
            ->where('u.user_type', '!=', 'client_admin')
            ->when($this->approverBranch($request, $user), fn ($q, $b) => $q->where('u.branch_id', $b))
            // The branch head sits at the top of the list.
            ->orderByRaw("CASE WHEN u.user_type = 'branch_user' THEN 0 ELSE 1 END")
            ->orderBy('u.name')
            ->get(['u.id', 'u.name', 'u.email', 'u.user_type', 'e.id as employee_id', 'e.emp_code',
                'd.name as department',
                DB::raw("COALESCE(g.name, NULLIF(u.designation, ''), CASE WHEN u.user_type = 'branch_user' THEN 'Branch User' END) as designation")]);
        return $this->ok($rows->unique('id')->values());
    }

    /** The branch whose people can approve: the active branch switcher, else the user's own. */
    private function approverBranch(Request $request, $user): ?int
    {
        return ($request->integer('branch_id') ?: null) ?? ($user->branch_id ? (int) $user->branch_id : null);
    }

    /** POST /p2p/orders/{id}/gst-approval/request */
    public function store(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $po = PurchaseOrder::findOrFail($id);

        return $this->raiseApproval($request, $user, [
            'code'          => $po->code,
            'vendorId'      => $po->vendor_id,
            'international' => $po->document_type === 'international',
            'branchId'      => $po->branch_id,
            'cancelled'     => $po->isCancelled(),
            'approvals'     => fn () => $po->gstApprovals(),
            'foreignKey'    => 'purchase_order_id',
            'parentId'      => $po->id,
            'subjectWord'   => 'PO',
            'noSupplierMsg' => 'Select a supplier on Step 01 first.',
            /* The PO caches the gate it was approved past. A Direct SPI has
               no such columns — it re-reads the supplier instead. */
            'onRaised'      => function (array $gst) use ($po, $user) {
                $po->update([
                    'gst_gate' => $gst['gate'], 'gst_scrutiny_date' => $gst['scrutiny_date'], 'gst_last_filing_date' => $gst['filing_date'],
                    'gst_approval_status' => 'pending', 'updated_by' => $user->id,
                ]);
            },
        ]);
    }

    /** POST /p2p/spi/{id}/gst-approval/request — the Direct SPI equivalent. */
    public function storeForInvoice(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $spi  = SupplierInvoice::findOrFail($id);

        /* A PO-backed invoice does not raise its own: the order carries the
           supplier, and its approval already covers this invoice. Allowing
           both would leave two approvals for one supplier risk, free to
           disagree. */
        if (!$spi->isStandalone()) {
            return $this->fail("{$spi->code} is raised against a purchase order — send that order for approval instead.");
        }

        return $this->raiseApproval($request, $user, [
            'code'          => $spi->code,
            'vendorId'      => $spi->vendor_id,
            'international' => $spi->document_type === 'international',
            'branchId'      => $spi->branch_id,
            'cancelled'     => $spi->status === SupplierInvoice::STATUS_CANCELLED,
            'approvals'     => fn () => $spi->gstApprovals(),
            'foreignKey'    => 'supplier_invoice_id',
            'parentId'      => $spi->id,
            'subjectWord'   => 'invoice',
            'noSupplierMsg' => 'Select a supplier on Stage 01 first.',
            'onRaised'      => fn (array $gst) => null,
        ]);
    }

    /**
     * The rules both documents are held to. See the class note: this is
     * shared because every test in it is a compliance test, and the copy that
     * drifts is the one that stops refusing.
     */
    private function raiseApproval(Request $request, $user, array $sub): JsonResponse
    {

        // A document that was rejected goes back to the senior who rejected it —
        // the requester does not get to shop around for a softer approver. Any
        // requested_to sent with it is ignored. Only if that senior is no longer
        // active does the pick open up again.
        $last = ($sub['approvals'])()->latest('id')->first();
        $sameApprover = $last && $last->status === PoGstApproval::STATUS_REJECTED
            ? DB::table('users')->where('id', $last->requested_to)->where('client_id', $user->client_id)
                ->where('status', 'active')->whereNull('deleted_at')->first(['id', 'name'])
            : null;

        $data = $request->validate([
            'requested_to' => [$sameApprover ? 'nullable' : 'required', 'integer'],
            'note'         => 'nullable|string|max:1000',
        ], ['requested_to.required' => 'Select the senior to send this request to.']);
        $targetId = $sameApprover->id ?? $data['requested_to'];

        if ($sub['cancelled']) return $this->fail("This {$sub['subjectWord']} is cancelled.");
        if (!$sub['vendorId']) return $this->fail($sub['noSupplierMsg']);

        // The gate is re-read live: only an overdue return can be approved past.
        $gst = $this->svc->gstGate($sub['vendorId'], $sub['international']);
        if ($gst['gate'] === 'blocked') {
            return $this->fail('GST scrutiny is older than ' . PurchaseOrderService::GST_STALE_MONTHS . ' months — a senior cannot approve this. Update the supplier\'s GST scrutiny first.');
        }
        if ($gst['gate'] === 'clear') return $this->fail("The supplier's GST is up to date — this {$sub['subjectWord']} needs no approval.");

        $open = ($sub['approvals'])()->whereIn('status', [PoGstApproval::STATUS_PENDING, PoGstApproval::STATUS_APPROVED])->latest('id')->first();
        if ($open?->status === PoGstApproval::STATUS_APPROVED) return $this->fail("This {$sub['subjectWord']} is already approved — you can submit it.");
        if ($open) return $this->fail('A request is already waiting on ' . (DB::table('users')->where('id', $open->requested_to)->value('name') ?? 'the approver') . '.');

        $approver = DB::table('users')->where('id', $targetId)->where('client_id', $user->client_id)
            ->where('status', 'active')->whereNull('deleted_at')->first(['id', 'name', 'branch_id', 'user_type']);
        if (!$approver) return $this->fail('Select an active user of your company as the approver.');
        $branch = $sub['branchId'] ?: $user->branch_id;
        if ($approver->user_type === 'client_admin') {
            return $this->fail("A {$sub['subjectWord']} approval stops at the branch head — choose a senior from this branch.");
        }
        if ($branch && (int) $approver->branch_id !== (int) $branch) {
            return $this->fail("Choose a senior from this {$sub['subjectWord']}'s branch.");
        }
        if ((int) $approver->id === (int) $user->id && $user->user_type !== 'branch_user') return $this->fail('You cannot approve your own request — choose a senior.');

        $row = $this->inTransaction('send the approval request', function () use ($sub, $user, $data, $gst, $targetId) {
            $row = PoGstApproval::create([
                $sub['foreignKey'] => $sub['parentId'],
                'requested_by'     => $user->id,
                'requested_to'     => $targetId,
                'request_note'     => $data['note'] ?? null,
                'requested_at'     => now(),
                'status'           => PoGstApproval::STATUS_PENDING,
            ]);
            ($sub['onRaised'])($gst);
            return $row;
        });

        $this->notify((int) $approver->id, [
            'kind'       => 'submitted_to_approver',
            'subject'    => "{$sub['code']} needs your GST approval",
            'message'    => "{$user->name} asked you to approve {$sub['code']} — the supplier's GST return is overdue.",
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

        /* LEFT joins to both parents. An approval raised from a Direct SPI has
           no purchase_order_id, and the inner join dropped it from this list. */
        $q = DB::table('p2p_po_gst_approvals as a')
            ->leftJoin('p2p_purchase_orders as po', 'po.id', '=', 'a.purchase_order_id')
            ->leftJoin('p2p_supplier_invoices as spi', 'spi.id', '=', 'a.supplier_invoice_id')
            ->leftJoin('vendors as v', fn ($j) => $j->whereRaw('v.id = COALESCE(po.vendor_id, spi.vendor_id)'))
            ->leftJoin('users as rq', 'rq.id', '=', 'a.requested_by')
            ->leftJoin('employees as re', fn ($j) => $j->on('re.user_id', '=', 'rq.id')->whereNull('re.deleted_at'))
            ->leftJoin('master_departments as rd', 'rd.id', '=', 're.department_id')
            ->leftJoin('master_designations as rg', 'rg.id', '=', 're.designation_id')
            ->whereRaw('COALESCE(po.client_id, spi.client_id) = ?', [$user->client_id])
            ->whereRaw('COALESCE(po.deleted_at, spi.deleted_at) IS NULL')
            ->where('a.requested_to', $user->id);
        if ($history) {
            $q->where('a.status', '!=', PoGstApproval::STATUS_PENDING)->orderByDesc('a.decided_at');
        } else {
            // A cancelled PO no longer needs a decision.
            /* COALESCE, not po.status: NULL <> 'cancelled' evaluates to NULL,
               which is not true, so every SPI-raised row fell out here too. */
            $q->where('a.status', PoGstApproval::STATUS_PENDING)
                ->whereRaw('COALESCE(po.status, spi.status) <> ?', [PurchaseOrder::STATUS_CANCELLED])
                ->orderByDesc('a.requested_at');
        }

        $page = $q->select(
            'a.id', 'a.purchase_order_id', 'a.supplier_invoice_id', 'a.status', 'a.request_note', 'a.reason', 'a.requested_at', 'a.decided_at',
            /* Same keys whichever the subject, so the Inbox keeps one row shape;
               po_code carries the invoice code for a Direct SPI. */
            DB::raw("CASE WHEN a.supplier_invoice_id IS NOT NULL THEN 'supplier_invoice' ELSE 'purchase_order' END as subject_type"),
            DB::raw('COALESCE(po.code, spi.code) as po_code'),
            DB::raw('COALESCE(po.po_date, spi.invoice_date) as po_date'),
            DB::raw('COALESCE(po.status, spi.status) as po_status'),
            DB::raw('COALESCE(po.currency_code, spi.currency_code) as currency_code'),
            DB::raw('COALESCE(po.grand_total, spi.grand_total) as grand_total'),
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
        $sub = $this->subjectOf($row, withItems: true);
        if (!$sub) return $this->fail('The document this approval was raised against no longer exists.', 404);
        $isPo = $sub instanceof PurchaseOrder;

        /* Enough of the supplier to judge it here: who they are, what type of
           supplier they are, where they sit and how to reach them. The senior
           was otherwise deciding on a code and a name. */
        $vendor = $sub->vendor_id ? DB::table('vendors as v')
            ->leftJoin('vendor_addresses as ad', fn ($j) => $j->on('ad.vendor_id', '=', 'v.id')->where('ad.is_primary', true))
            ->leftJoin('master_risk_levels as r', 'r.id', '=', 'v.risk_level_id')
            ->leftJoin('master_vendor_types as vt', 'vt.id', '=', 'v.vendor_type_id')
            ->leftJoin('master_states as st', 'st.id', '=', 'ad.state_id')
            ->where('v.id', $sub->vendor_id)->where('v.client_id', $user->client_id)
            ->first(['v.id', 'v.vendor_code', 'v.company_name', 'v.legal_name', 'v.gst_number', 'v.supplier_category',
                'v.primary_email', 'v.website', 'v.status', 'v.gst_applicable',
                'ad.state_code', 'ad.city', 'ad.address_line', 'ad.contact_name', 'ad.contact_no', 'ad.email as contact_email',
                'st.name as state_name', 'vt.name as vendor_type', 'r.name as risk_level']) : null;

        $refs = $this->subjectRefs($sub);
        /* A PO line stores only product_id, so its labels need a lookup. An SPI
           line already carries its description, HSN and UOM. */
        $live  = $isPo ? $this->svc->lineDetails($sub->items) : [];
        $inter = $isPo ? $sub->tax_mode === 'inter' : (float) $sub->total_igst > 0;

        return $this->ok([
            'request' => $this->shapeRow($row, $this->names([$row->requested_by, $row->requested_to])),
            'can_decide' => (int) $row->requested_to === (int) $user->id && $row->status === PoGstApproval::STATUS_PENDING
                && !$sub->trashed() && !$sub->isCancelled(),
            'po' => $this->subjectBlock($sub) + $refs,
            'supplier' => $vendor ? [
                'id' => $vendor->id,
                'code' => $vendor->vendor_code, 'name' => $vendor->legal_name ?: $vendor->company_name,
                'company_name' => $vendor->company_name,
                'gstin' => $vendor->gst_number, 'gst_applicable' => $vendor->gst_applicable,
                'state_code' => $vendor->state_code, 'state' => $vendor->state_name, 'city' => $vendor->city,
                'address' => $vendor->address_line, 'email' => $vendor->primary_email ?: $vendor->contact_email,
                'contact_name' => $vendor->contact_name, 'contact_no' => $vendor->contact_no,
                'type' => $vendor->vendor_type, 'status' => $vendor->status, 'website' => $vendor->website,
                'risk' => $vendor->risk_level, 'category' => $vendor->supplier_category,
            ] : null,
            // Read live, so the senior sees today's position, not the one at request time.
            'gst' => $sub->vendor_id ? $this->svc->gstGate($sub->vendor_id, $sub->document_type === 'international') + ['stale_months' => PurchaseOrderService::GST_STALE_MONTHS] : null,
            'lines' => $sub->items->map(fn ($it) => [
                'line_no' => $it->line_no,
                'product_code' => $live[$it->id]['product_code'] ?? null,
                'product_name' => $live[$it->id]['product_name'] ?? $it->description,
                'hsn_code' => $live[$it->id]['hsn_code'] ?? $it->hsn_code,
                'uom' => $live[$it->id]['uom'] ?? $it->uom,
                'quantity' => (float) ($it->quantity ?? $it->qty_spi), 'rate' => (float) $it->rate, 'gst_pct' => (float) $it->gst_pct,
                'taxable_amount' => (float) $it->taxable_amount,
                'gst_amount' => round((float) $it->cgst_amount + (float) $it->sgst_amount + (float) $it->igst_amount, 2),
                'line_total' => (float) $it->line_total,
            ])->values()->all(),
            'tax_label' => $inter ? 'IGST' : 'CGST + SGST',
            'history' => $sub->gstApprovals()->orderByDesc('id')->get()->map(fn ($h) => $this->shapeRow($h, $this->names([$h->requested_by, $h->requested_to])))->all(),
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
        $sub = $this->subjectOf($row);
        if (!$sub || $sub->trashed() || $sub->isCancelled()) {
            return $this->fail('This ' . ($row->purchase_order_id ? 'PO' : 'invoice') . ' was cancelled or deleted — there is nothing to decide.');
        }

        $this->inTransaction('record the decision', function () use ($row, $sub, $user, $data) {
            $row->update(['status' => $data['decision'], 'reason' => $data['reason'], 'decided_at' => now()]);
            /* A PO caches the verdict in its own gst_approval_* columns. An SPI
               has none on purpose: the approval row is the record, read back
               through gstApprovals() — one place to keep in step, not two. */
            $sub->update($sub instanceof PurchaseOrder
                ? ['gst_approval_status' => $data['decision'], 'gst_approval_by' => $user->id,
                   'gst_approval_at' => now(), 'updated_by' => $user->id]
                : ['updated_by' => $user->id]);
        });

        $ok = $data['decision'] === PoGstApproval::STATUS_APPROVED;
        $this->notify((int) $row->requested_by, [
            'kind'       => $ok ? 'approved' : 'rejected',
            'subject'    => "{$sub->code} GST approval " . ($ok ? 'approved' : 'rejected'),
            'message'    => "{$user->name} " . ($ok ? 'approved' : 'rejected') . " {$sub->code}: {$data['reason']}",
            'action_url' => $row->purchase_order_id ? '/p2p/order' : '/p2p/spi',
        ]);

        return $this->ok($this->shapeRow($row->fresh(), $this->names([$row->requested_by, $row->requested_to])));
    }

    /**
     * GET /p2p/spi/{id}/gst-approvals — every approval raised against one
     * invoice, newest first. The screen that raised it needs its own history;
     * the Inbox list is the approver's view, keyed on who it was sent to.
     */
    public function indexForInvoice(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $spi = SupplierInvoice::withoutGlobalScope('tenant')
            ->where('client_id', $user->client_id)->findOrFail($id);

        $rows = $spi->gstApprovals()->orderByDesc('id')->get();
        $names = $this->names($rows->flatMap(fn ($r) => [$r->requested_by, $r->requested_to])->all());

        // The gate alongside, read live: the reason the approval exists at all.
        return $this->ok($rows->map(fn ($r) => $this->shapeRow($r, $names))->all(), 200, [
            'gst' => $spi->vendor_id
                ? $this->svc->gstGate((int) $spi->vendor_id, $spi->document_type === 'international')
                    + ['stale_months' => PurchaseOrderService::GST_STALE_MONTHS]
                : null,
        ]);
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
            'supplier_invoice_id' => $r->supplier_invoice_id,
            'subject_type'      => $r->supplier_invoice_id ? 'supplier_invoice' : 'purchase_order',
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

    /** The header the senior decides on — same keys for either subject. */
    private function subjectBlock($sub): array
    {
        if ($sub instanceof PurchaseOrder) {
            return [
                'id' => $sub->id, 'code' => $sub->code, 'po_date' => $sub->po_date?->toDateString(), 'status' => $sub->trashed() ? 'deleted' : $sub->status,
                'po_type' => $sub->po_type, 'document_type' => $sub->document_type, 'link_type' => $sub->link_type,
                'currency_code' => $sub->currency_code, 'exchange_rate' => (float) $sub->exchange_rate,
                'mode_of_transport' => $sub->mode_of_transport, 'expected_delivery_date' => $sub->expected_delivery_date?->toDateString(),
                'delivery_location' => $sub->delivery_location, 'payment_type' => $sub->payment_type,
                'inco_term' => $sub->inco_term, 'port_of_loading' => $sub->port_of_loading, 'port_of_discharge' => $sub->port_of_discharge,
                'tax_mode' => $sub->tax_mode, 'physical_inspection' => $sub->physical_inspection,
                'taxable_total' => (float) $sub->taxable_total, 'total_cgst' => (float) $sub->total_cgst,
                'total_sgst' => (float) $sub->total_sgst, 'total_igst' => (float) $sub->total_igst,
                'shipping_charges' => (float) $sub->shipping_charges, 'packaging_charges' => (float) $sub->packaging_charges,
                'other_charges' => (float) $sub->other_charges, 'grand_total' => (float) $sub->grand_total,
                'created_by_name' => DB::table('users')->where('id', $sub->created_by)->value('name'),
                'subject_type' => 'purchase_order', 'supplier_invoice_id' => null,
            ];
        }

        /* A Direct SPI has no order terms: transport, Incoterm, ports and the
           extra charges all live on the PO. Null rather than absent, so the
           screen keeps one shape and simply prints a dash. */
        return [
            'id' => $sub->id, 'code' => $sub->code, 'po_date' => $sub->invoice_date?->toDateString(), 'status' => $sub->trashed() ? 'deleted' : $sub->status,
            'po_type' => null, 'document_type' => $sub->document_type, 'link_type' => null,
            'currency_code' => $sub->currency_code, 'exchange_rate' => (float) $sub->exchange_rate,
            'mode_of_transport' => null, 'expected_delivery_date' => null,
            'delivery_location' => null, 'payment_type' => null,
            'inco_term' => null, 'port_of_loading' => null, 'port_of_discharge' => null,
            // Derived, not stored: the server never splits GST, the caller does.
            'tax_mode' => (float) $sub->total_igst > 0 ? 'inter' : 'intra', 'physical_inspection' => null,
            'taxable_total' => (float) $sub->taxable_total, 'total_cgst' => (float) $sub->total_cgst,
            'total_sgst' => (float) $sub->total_sgst, 'total_igst' => (float) $sub->total_igst,
            'shipping_charges' => null, 'packaging_charges' => null,
            'other_charges' => null, 'grand_total' => (float) $sub->grand_total,
            'created_by_name' => DB::table('users')->where('id', $sub->created_by)->value('name'),
            'subject_type' => 'supplier_invoice', 'supplier_invoice_id' => $sub->id,
            'invoice_no' => $sub->invoice_no, 'stage_completed' => $sub->stage_completed,
        ];
    }

    /** Shipment / opportunity / procurement references, from either subject. */
    private function subjectRefs($sub): array
    {
        if ($sub instanceof PurchaseOrder) {
            return $this->refs($sub) + ['procurement_code' => $sub->procurement_request_code];
        }

        $sh = $sub->shipment_order_id
            ? DB::table('shipment_orders')->where('id', $sub->shipment_order_id)->first(['shipment_code'])
            : null;

        return ['shipment_code' => $sh->shipment_code ?? null, 'pi_code' => null,
            'customer_name' => null, 'opportunity_code' => null,
            'procurement_code' => $sub->procurement_request_code];
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
