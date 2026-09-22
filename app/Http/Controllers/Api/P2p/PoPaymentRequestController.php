<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PoPayment;
use App\Models\P2p\PoPaymentRequest;
use App\Models\P2p\PurchaseOrder;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * PO payments: TDS, payment requests, their approval, and the payments released against them.
 *
 *  - Manage Payment Requests (one PO): summary cards + requests, TDS, raise, payments.
 *  - Payment Request Management (all POs): paged list, request detail, approve / decline.
 *
 * The PO's paid_amount / balance_amount and each request's paid_amount are stored, and
 * rebuilt from the payment rows inside the same transaction as every change.
 */
class PoPaymentRequestController extends Controller
{
    use RunsInTransaction;

    private const PROOF_RULE = 'file|max:10240|mimes:pdf,doc,docx,xls,xlsx,jpg,jpeg,png,webp';
    // Cheque (6 digits) through RTGS UTR (22), letters and digits only — as in the old PO payments.
    private const UTR_RULE = ['nullable', 'string', 'regex:/^[A-Za-z0-9]{6,22}$/'];

    /** Tabs of Payment Request Management: condition on the request row. */
    private const TABS = [
        'all'      => 'TRUE',
        'awaiting' => "r.status = 'pending'",
        'approved' => "r.status = 'approved'",
        'declined' => "r.status = 'rejected'",
    ];

    public function __construct(private PurchaseOrderService $svc) {}

    private function ok($data, int $code = 200, array $extra = []): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data] + $extra, $code);
    }

    private function fail(string $message, int $code = 422, array $errors = []): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message] + ($errors ? ['errors' => $errors] : []), $code);
    }

    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        return $user;
    }

    /** A PO the caller can see (tenant scope applies). */
    private function findPo(int $id): PurchaseOrder
    {
        return PurchaseOrder::findOrFail($id);
    }

    /** Payments run on a submitted PO only. */
    private function payable(PurchaseOrder $po): ?JsonResponse
    {
        if ($po->isCancelled()) return $this->fail('This PO is cancelled — no payment requests or payments can be made on it.');
        if ($po->status !== PurchaseOrder::STATUS_SUBMITTED) return $this->fail('Submit the PO before managing its payments.');
        return null;
    }

    /* ══════════════════════════ ONE PO — Manage Payment Requests ══════════════════════════ */

    /** GET /p2p/orders/{po}/payment-requests — the two summaries and the request table. */
    public function forPo(int $po): JsonResponse
    {
        return $this->ok($this->poPayload($this->findPo($po)));
    }

    /**
     * PUT /p2p/orders/{po}/tds — one TDS per PO, on the base amount (without GST or charges).
     * Editable until the first payment is recorded; not on an international PO.
     */
    public function saveTds(Request $request, int $po): JsonResponse
    {
        $user = $this->tenantUser($request);
        $order = $this->findPo($po);
        if ($blocked = $this->payable($order)) return $blocked;
        if ($order->document_type === 'international') return $this->fail('TDS does not apply to an international PO.');

        $data = $request->validate([
            'tds_percentage' => 'required_without:tds_amount|nullable|numeric|min:0|max:100',
            'tds_amount'     => 'required_without:tds_percentage|nullable|numeric|min:0',
        ], [
            'tds_percentage.max' => 'TDS cannot be more than 100%.',
        ]);

        $base = round((float) $order->taxable_total, 2);
        // The amount is what was typed when given; otherwise it follows from the percentage.
        $amount = isset($data['tds_amount']) ? round((float) $data['tds_amount'], 2) : round($base * (float) $data['tds_percentage'] / 100, 2);
        if ($amount > $base + 0.001) {
            return $this->fail('TDS cannot be more than the PO base amount of ' . number_format($base, 2) . '.', 422,
                ['tds_amount' => ['TDS cannot be more than the PO base amount.']]);
        }
        $pct = $base > 0 ? round($amount / $base * 100, 2) : 0;

        $this->inTransaction('save the TDS', function () use ($order, $user, $amount, $pct) {
            // Row lock: a payment saved at the same moment can't slip in under the old TDS.
            $locked = PurchaseOrder::whereKey($order->id)->lockForUpdate()->first();
            if ($this->paymentRows($locked->id)->exists()) {
                abort(response()->json(['status' => false, 'message' => 'TDS cannot be changed — a payment has already been recorded against this PO.'], 422));
            }
            $locked->forceFill(['tds_percentage' => $pct, 'tds_amount' => $amount,
                'tds_updated_by' => $user->id, 'tds_updated_at' => now(), 'updated_by' => $user->id])->save();
            $this->svc->refreshPaymentTotals($locked);
        });

        return $this->ok($this->poPayload($order->fresh()));
    }

    /** POST /p2p/orders/{po}/payment-requests — raise a request to an approver. */
    public function store(Request $request, int $po): JsonResponse
    {
        $user = $this->tenantUser($request);
        $order = $this->findPo($po);
        if ($blocked = $this->payable($order)) return $blocked;
        // TDS decides the net payable, so it is settled before any request is raised.
        if ($order->document_type !== 'international' && !$order->tds_updated_at) {
            return $this->fail('Deduct the TDS on this PO first — save it (even as 0) before raising a payment request.', 422, ['tds' => ['Deduct TDS first.']]);
        }

        $data = $request->validate([
            'payment_type'     => ['required', Rule::in(PoPaymentRequest::PAYMENT_TYPES)],
            'percentage'       => 'nullable|numeric|min:0|max:100',
            'requested_amount' => 'required|numeric|min:0.01|max:9999999999999.99',
            'reason'           => 'required|string|max:300',
            'requested_to'     => 'required|integer',
        ], [
            'payment_type.required'     => 'Select a payment type.',
            'percentage.max'            => 'Payment percentage cannot be more than 100%.',
            'requested_amount.required' => 'Enter the payment request amount.',
            'requested_amount.min'      => 'Enter the payment request amount.',
            'reason.required'           => 'Enter the reason for this payment.',
            'requested_to.required'     => 'Select who this request goes to.',
        ]);

        $approver = DB::table('users')->where('id', $data['requested_to'])->where('client_id', $user->client_id)
            ->where('status', 'active')->whereNull('deleted_at')->first(['id']);
        if (!$approver) return $this->fail('Select an active user of your company as the approver.', 422, ['requested_to' => ['Select an active user.']]);
        if ((int) $approver->id === (int) $user->id) return $this->fail('You cannot approve your own request — choose someone else.', 422, ['requested_to' => ['Choose someone else.']]);

        $amount = round((float) $data['requested_amount'], 2);
        $row = $this->inTransaction('raise the payment request', function () use ($order, $user, $data, $amount) {
            $locked = PurchaseOrder::whereKey($order->id)->lockForUpdate()->first();
            // Pending and approved requests together may not exceed the net payable.
            $open = $this->openToRequest($locked);
            if ($amount > $open + 0.001) {
                abort(response()->json(['status' => false,
                    'message' => $open <= 0
                        ? 'The balance is already covered by open requests — wait for a decision on those before raising another.'
                        : 'The requested amount exceeds the ' . number_format($open, 2) . ' still open to request on this PO.',
                    'errors' => ['requested_amount' => ['Amount exceeds the balance open to request.']]], 422));
            }
            return PoPaymentRequest::create([
                'client_id'         => $locked->client_id,
                'branch_id'         => $locked->branch_id,
                'purchase_order_id' => $locked->id,
                'code'              => $this->svc->nextPaymentRequestCode((int) $locked->client_id),
                'payment_type'      => $data['payment_type'],
                'percentage'        => $data['percentage'] ?? ((float) $locked->grand_total > 0 ? round($amount / (float) $locked->grand_total * 100, 2) : null),
                'requested_amount'  => $amount,
                'reason'            => trim($data['reason']),
                'requested_by'      => $user->id,
                'requested_to'      => $data['requested_to'],
                'requested_at'      => now(),
                'status'            => PoPaymentRequest::STATUS_PENDING,
            ]);
        });

        $this->notify((int) $data['requested_to'], [
            'kind'       => 'submitted_to_approver',
            'subject'    => "{$row->code} — payment request on {$order->code}",
            'message'    => "{$user->name} requested " . number_format($amount, 2) . " ({$row->payment_type}) on {$order->code}.",
            'action_url' => '/p2p/payment-request',
        ]);

        return $this->ok($this->poPayload($order->fresh()), 201);
    }

    /** GET /p2p/orders/{po}/payment-requests/{req}/payments — the Payment History of one request. */
    public function payments(int $po, int $req): JsonResponse
    {
        $order = $this->findPo($po);
        $row = $order->paymentRequests()->findOrFail($req);
        return $this->ok([
            'request'  => $this->shapeRequest($row, $this->names([$row->requested_by, $row->requested_to])),
            'payments' => $this->paymentRows(null, $row->id)->orderBy('id')->get()->map(fn ($p) => $this->shapePayment($p))->all(),
        ]);
    }

    /** POST /p2p/orders/{po}/payment-requests/{req}/payments (multipart) — record a payment. */
    public function storePayment(Request $request, int $po, int $req): JsonResponse
    {
        return $this->savePayment($request, $po, $req, null);
    }

    /** POST /p2p/orders/{po}/payment-requests/{req}/payments/{payment} (multipart) — edit a payment. */
    public function updatePayment(Request $request, int $po, int $req, int $payment): JsonResponse
    {
        return $this->savePayment($request, $po, $req, $payment);
    }

    private function savePayment(Request $request, int $po, int $req, ?int $paymentId): JsonResponse
    {
        $user = $this->tenantUser($request);
        $order = $this->findPo($po);
        if ($blocked = $this->payable($order)) return $blocked;
        $row = $order->paymentRequests()->findOrFail($req);
        $existing = $paymentId ? $row->payments()->findOrFail($paymentId) : null;
        if ($blocked = $this->zohoLocked($existing)) return $blocked;

        if ($row->status !== PoPaymentRequest::STATUS_APPROVED) {
            return $this->fail($row->status === PoPaymentRequest::STATUS_PENDING
                ? 'This request is still awaiting approval — pay once it is approved.'
                : 'This request was declined — nothing can be paid against it.');
        }
        // TDS is fixed at the first payment, so a domestic PO must have it saved before paying.
        if ($order->document_type !== 'international' && !$order->tds_updated_at) {
            return $this->fail('Deduct the TDS on this PO first — save it (even as 0) before recording a payment.', 422, ['tds' => ['Deduct TDS first.']]);
        }

        $data = $request->validate([
            'amount'            => 'required|numeric|min:0.01|max:9999999999999.99',
            'bank_name'         => 'nullable|string|max:128',
            'utr_cheque_number' => self::UTR_RULE,
            'utr_cheque_date'   => 'nullable|date|before_or_equal:today',
            'proof'             => 'nullable|' . self::PROOF_RULE,
        ], [
            'amount.required'                 => 'Enter the amount paid.',
            'amount.min'                      => 'Enter the amount paid.',
            'utr_cheque_number.regex'         => 'UTR / cheque number must be 6–22 letters or digits.',
            'utr_cheque_date.before_or_equal' => 'UTR / cheque date cannot be in the future.',
            'proof.max'                       => 'Proof of payment must be 10 MB or smaller.',
            'proof.mimes'                     => 'Proof of payment must be a PDF, Word, Excel or image file.',
        ]);

        $utr = !empty($data['utr_cheque_number']) ? strtoupper($data['utr_cheque_number']) : null;
        if ($utr) {
            // A bank reference backs one payment only, across the company (deleted payments free it).
            $dup = PoPayment::withoutGlobalScope('tenant')->where('client_id', $order->client_id)
                ->whereRaw('UPPER(utr_cheque_number) = ?', [$utr])
                ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))
                ->exists();
            if ($dup) return $this->fail('This UTR / cheque number is already used on another payment.', 422, ['utr_cheque_number' => ['Already used on another payment.']]);
        }

        $amount = round((float) $data['amount'], 2);
        $file = $request->file('proof');
        $path = $file?->store("p2p/po-payments/{$order->id}", 'public');

        $saved = $this->inTransaction($existing ? 'update the payment' : 'record the payment', function () use ($order, $row, $existing, $user, $data, $amount, $utr, $file, $path) {
            // Serialise payments on the PO so two people can't both pass the balance check.
            $locked = PurchaseOrder::whereKey($order->id)->lockForUpdate()->first();
            $req = PoPaymentRequest::whereKey($row->id)->first();
            $others = (float) $this->paymentRows(null, $req->id)->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))->sum('amount');
            $room = round((float) $req->approved_amount - $others, 2);
            $poOthers = (float) $this->paymentRows($locked->id)->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))->sum('amount');
            $poRoom = round((float) $locked->grand_total - (float) $locked->tds_amount - $poOthers, 2);
            if ($amount > $room + 0.001) {
                abort(response()->json(['status' => false, 'message' => 'Only ' . number_format(max(0, $room), 2) . ' is still approved and unpaid on this request.',
                    'errors' => ['amount' => ['Amount exceeds what is still approved on this request.']]], 422));
            }
            if ($amount > $poRoom + 0.001) {
                abort(response()->json(['status' => false, 'message' => 'Amount exceeds the PO balance of ' . number_format(max(0, $poRoom), 2) . '.',
                    'errors' => ['amount' => ['Amount exceeds the PO balance.']]], 422));
            }

            $attrs = [
                'amount'            => $amount,
                'bank_name'         => $data['bank_name'] ?? null,
                'utr_cheque_number' => $utr,
                'utr_cheque_date'   => $data['utr_cheque_date'] ?? null,
                'updated_by'        => $user->id,
            ];
            if ($path) $attrs += ['proof_path' => $path, 'proof_name' => $file->getClientOriginalName()];

            $payment = $existing
                ? tap($existing)->update($attrs)
                : PoPayment::create($attrs + [
                    'client_id' => $locked->client_id, 'branch_id' => $locked->branch_id,
                    'purchase_order_id' => $locked->id, 'payment_request_id' => $req->id, 'created_by' => $user->id,
                ]);
            $this->svc->refreshPaymentTotals($locked);
            return $payment;
        }, [$path]);
        $this->postToZoho($order->fresh(), $saved);

        return $this->ok([
            'payment' => $this->shapePayment($saved->fresh()),
            'summary' => $this->poPayload($order->fresh()),
        ], $existing ? 200 : 201);
    }

    /** DELETE /p2p/orders/{po}/payment-requests/{req}/payments/{payment} — kept as a soft-deleted record. */
    public function destroyPayment(Request $request, int $po, int $req, int $payment): JsonResponse
    {
        $user = $this->tenantUser($request);
        $order = $this->findPo($po);
        if ($order->isCancelled()) return $this->fail('This PO is cancelled — its payments can no longer be changed.');
        $row = $order->paymentRequests()->findOrFail($req)->payments()->findOrFail($payment);
        if ($blocked = $this->zohoLocked($row)) return $blocked;

        $this->inTransaction('delete the payment', function () use ($order, $row, $user) {
            $locked = PurchaseOrder::whereKey($order->id)->lockForUpdate()->first();
            $row->update(['updated_by' => $user->id]);
            $row->delete();
            $this->svc->refreshPaymentTotals($locked);
        });

        return $this->ok(['summary' => $this->poPayload($order->fresh())]);
    }

    /* ══════════════════════════ ALL POs — Payment Request Management ══════════════════════════ */

    /** GET /p2p/orders/payment-requests?tab=&search=&mine=&page=&per_page= — paged, with every tab's count. */
    public function index(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $request->validate([
            'tab'      => ['nullable', Rule::in(array_keys(self::TABS))],
            'search'   => 'nullable|string|max:100',
            'per_page' => 'nullable|integer|min:1|max:50',
        ]);

        $base = $this->scopedRequests($user);
        if ($request->boolean('mine')) $base->where('r.requested_to', $user->id);
        if ($s = trim((string) $request->query('search'))) {
            $base->where(fn ($w) => $w->where('r.code', 'ilike', "%{$s}%")->orWhere('po.code', 'ilike', "%{$s}%")
                ->orWhere('v.vendor_code', 'ilike', "%{$s}%")->orWhere('v.company_name', 'ilike', "%{$s}%")
                ->orWhere('v.legal_name', 'ilike', "%{$s}%"));
        }

        $counts = (clone $base)->selectRaw(implode(', ', array_map(
            fn ($key, $cond) => "COUNT(*) FILTER (WHERE {$cond}) AS \"{$key}\"", array_keys(self::TABS), self::TABS,
        )))->first();

        $tab = $request->query('tab', 'all');
        $page = $base->whereRaw(self::TABS[$tab])
            ->select($this->listColumns())
            ->orderByDesc('r.id')
            ->paginate($request->integer('per_page') ?: 10);

        return $this->ok(collect($page->items())->map(fn ($r) => $this->shapeListRow($r, $user))->all(), 200, [
            'meta' => [
                'total' => $page->total(), 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage(),
                'counts' => array_map('intval', (array) $counts),
            ],
        ]);
    }

    /** GET /p2p/orders/payment-requests/{req} — one request with its PO position and payments. */
    public function show(Request $request, int $req): JsonResponse
    {
        $user = $this->tenantUser($request);
        $r = $this->scopedRequests($user)->where('r.id', $req)->select($this->listColumns())->first();
        if (!$r) return $this->fail('Payment request not found.', 404);

        $po = PurchaseOrder::withoutGlobalScope('tenant')->findOrFail($r->purchase_order_id);
        $row = PoPaymentRequest::withoutGlobalScope('tenant')->findOrFail($req);
        return $this->ok([
            'request'  => $this->shapeListRow($r, $user) + ['reason' => $row->reason],
            'po'       => $this->poPayload($po),
            // Every payment on the PO, tagged with the request it was paid against.
            'payments' => $this->paymentRows($po->id)->orderBy('id')->get()->map(fn ($p) => $this->shapePayment($p) + [
                'payment_request_id' => $p->payment_request_id,
            ])->all(),
        ]);
    }

    /** PUT /p2p/orders/payment-requests/{req}/decision — the approver approves (full or part) or declines. */
    public function decide(Request $request, int $req): JsonResponse
    {
        $user = $this->tenantUser($request);
        $r = $this->scopedRequests($user)->where('r.id', $req)->select('r.id')->first();
        if (!$r) return $this->fail('Payment request not found.', 404);
        $row = PoPaymentRequest::withoutGlobalScope('tenant')->findOrFail($req);

        $data = $request->validate([
            'decision'        => ['required', Rule::in([PoPaymentRequest::STATUS_APPROVED, PoPaymentRequest::STATUS_REJECTED])],
            'approved_amount' => 'required_if:decision,approved|nullable|numeric|min:0.01',
            // A decline reason is capped at 300 characters, an approval remark at 400 (as on the popup).
            'note'            => ['required_if:decision,rejected', 'nullable', 'string', $request->input('decision') === PoPaymentRequest::STATUS_REJECTED ? 'max:300' : 'max:400'],
        ], [
            'approved_amount.required_if' => 'Enter the amount to approve.',
            'approved_amount.min'         => 'Enter the amount to approve.',
            'note.required_if'            => 'Give a reason for declining.',
        ]);

        if ((int) $row->requested_to !== (int) $user->id) return $this->fail('Only the person this request was sent to can decide it.', 403);
        if ($row->status !== PoPaymentRequest::STATUS_PENDING) return $this->fail('This request is already ' . ($row->status === 'rejected' ? 'declined' : 'approved') . '.');
        $po = PurchaseOrder::withoutGlobalScope('tenant')->find($row->purchase_order_id);
        if (!$po || $po->isCancelled()) return $this->fail('This PO was cancelled — there is nothing to decide.');

        $approve = $data['decision'] === PoPaymentRequest::STATUS_APPROVED;
        $approved = $approve ? round((float) $data['approved_amount'], 2) : null;
        if ($approve && $approved > (float) $row->requested_amount + 0.001) {
            return $this->fail('You can approve at most the requested ' . number_format((float) $row->requested_amount, 2) . '.', 422,
                ['approved_amount' => ['Cannot be more than the requested amount.']]);
        }
        // Headroom: net payable less what other approved requests on the PO already hold (or have paid).
        if ($approve) {
            $held = (float) PoPaymentRequest::withoutGlobalScope('tenant')->where('purchase_order_id', $po->id)
                ->where('id', '!=', $row->id)->where('status', PoPaymentRequest::STATUS_APPROVED)
                ->selectRaw('COALESCE(SUM(GREATEST(approved_amount, paid_amount)), 0) AS s')->value('s');
            $open = round((float) $po->grand_total - (float) $po->tds_amount - $held, 2);
            if ($approved > $open + 0.001) {
                return $this->fail('Only ' . number_format(max(0, $open), 2) . ' is still open to approve on this PO.', 422,
                    ['approved_amount' => ['Cannot be more than the amount open to request.']]);
            }
        }

        $this->inTransaction('record the decision', fn () => $row->update([
            'status'          => $data['decision'],
            'approved_amount' => $approved,
            'decision_note'   => isset($data['note']) ? trim($data['note']) : null,
            'decided_at'      => now(),
        ]));

        $this->notify((int) $row->requested_by, [
            'kind'       => $approve ? 'approved' : 'rejected',
            'subject'    => "{$row->code} " . ($approve ? 'approved' : 'declined'),
            'message'    => $approve
                ? "{$user->name} approved " . number_format($approved, 2) . " on {$po->code} — ready to pay."
                : "{$user->name} declined {$row->code} on {$po->code}: " . trim($data['note']),
            'action_url' => '/p2p/order',
        ]);

        return $this->show($request, $req);
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /** Requests of the client (all branches), joined to the PO, supplier and people. */
    private function scopedRequests($user)
    {
        return DB::table('p2p_po_payment_requests as r')
            ->join('p2p_purchase_orders as po', 'po.id', '=', 'r.purchase_order_id')
            ->leftJoin('vendors as v', 'v.id', '=', 'po.vendor_id')
            ->leftJoin('users as rb', 'rb.id', '=', 'r.requested_by')
            ->leftJoin('users as rt', 'rt.id', '=', 'r.requested_to')
            ->leftJoin('shipment_orders as sh', 'sh.id', '=', 'po.shipment_order_id')
            ->leftJoin('proforma_invoices as pi', 'pi.id', '=', 'po.proforma_invoice_id')
            ->where('r.client_id', $user->client_id)
            ->whereNull('po.deleted_at');
    }

    private function listColumns(): array
    {
        return [
            'r.id', 'r.code', 'r.purchase_order_id', 'r.payment_type', 'r.percentage', 'r.requested_amount',
            'r.status', 'r.approved_amount', 'r.paid_amount', 'r.requested_at', 'r.decided_at',
            'r.requested_by', 'r.requested_to', 'r.decision_note',
            'po.vendor_id', 'po.physical_inspection', 'po.inspection_status', 'po.procurement_request_code',
            'sh.shipment_code', 'sh.created_at as shipment_date', 'pi.opp_code', 'pi.created_at as pi_date',
            'po.code as po_code', 'po.po_date', 'po.status as po_status', 'po.grand_total', 'po.tds_amount',
            'po.paid_amount as po_paid', 'po.balance_amount as po_balance', 'po.link_type',
            'v.vendor_code as supplier_code', 'v.supplier_category',
            DB::raw('COALESCE(v.legal_name, v.company_name) as supplier_name'),
            'rb.name as requested_by_name', 'rb.designation as requested_by_role',
            'rt.name as requested_to_name', 'rt.designation as requested_to_role',
        ];
    }

    private function shapeListRow(object $r, $user): array
    {
        $approved = $r->approved_amount !== null ? (float) $r->approved_amount : null;
        return [
            'id' => $r->id, 'code' => $r->code, 'purchase_order_id' => $r->purchase_order_id,
            'payment_type' => $r->payment_type, 'percentage' => $r->percentage !== null ? (float) $r->percentage : null,
            'requested_amount' => (float) $r->requested_amount, 'status' => $r->status,
            'approved_amount' => $approved, 'paid_amount' => (float) $r->paid_amount,
            'due' => $approved !== null ? max(0, round($approved - (float) $r->paid_amount, 2)) : null,
            'requested_at' => $r->requested_at ? substr((string) $r->requested_at, 0, 10) : null,
            'decided_at' => $r->decided_at ? substr((string) $r->decided_at, 0, 10) : null,
            'decision_note' => $r->decision_note, 'vendor_id' => $r->vendor_id,
            'physical_inspection' => $r->physical_inspection, 'inspection_status' => $r->inspection_status,
            'shipment_code' => $r->shipment_code, 'shipment_date' => $r->shipment_date ? substr((string) $r->shipment_date, 0, 10) : null,
            'opportunity_code' => $r->opp_code, 'opportunity_date' => $r->pi_date ? substr((string) $r->pi_date, 0, 10) : null,
            'procurement_code' => $r->procurement_request_code,
            'po_code' => $r->po_code, 'po_date' => $r->po_date, 'po_status' => $r->po_status, 'link_type' => $r->link_type,
            'po_total' => (float) $r->grand_total, 'po_net' => round((float) $r->grand_total - (float) $r->tds_amount, 2),
            'po_paid' => (float) $r->po_paid, 'po_balance' => (float) $r->po_balance,
            'supplier_code' => $r->supplier_code, 'supplier_name' => $r->supplier_name, 'supplier_category' => $r->supplier_category,
            'requested_by' => ['id' => $r->requested_by, 'name' => $r->requested_by_name, 'role' => $r->requested_by_role],
            'requested_to' => ['id' => $r->requested_to, 'name' => $r->requested_to_name, 'role' => $r->requested_to_role],
            'can_decide' => $r->status === PoPaymentRequest::STATUS_PENDING && (int) $r->requested_to === (int) $user->id,
        ];
    }

    /** Live payments of a PO or a request, across branches (the approver may sit in another). */
    private function paymentRows(?int $poId, ?int $requestId = null)
    {
        return PoPayment::withoutGlobalScope('tenant')
            ->when($poId, fn ($q) => $q->where('purchase_order_id', $poId))
            ->when($requestId, fn ($q) => $q->where('payment_request_id', $requestId));
    }

    /** Net payable less every pending and approved request. */
    private function openToRequest(PurchaseOrder $po): float
    {
        $open = (float) PoPaymentRequest::withoutGlobalScope('tenant')->where('purchase_order_id', $po->id)
            ->whereIn('status', [PoPaymentRequest::STATUS_PENDING, PoPaymentRequest::STATUS_APPROVED])
            ->selectRaw("COALESCE(SUM(CASE WHEN status = 'approved' THEN approved_amount ELSE requested_amount END), 0) AS s")
            ->value('s');
        return round((float) $po->grand_total - (float) $po->tds_amount - $open, 2);
    }

    /** Everything the Manage Payment Requests modal shows. */
    private function poPayload(PurchaseOrder $po): array
    {
        $base  = round((float) $po->taxable_total, 2);
        $gst   = round((float) $po->total_cgst + (float) $po->total_sgst + (float) $po->total_igst, 2);
        $extra = round((float) $po->shipping_charges + (float) $po->packaging_charges + (float) $po->other_charges, 2);
        $total = round((float) $po->grand_total, 2);
        $tds   = round((float) $po->tds_amount, 2);
        $net   = round($total - $tds, 2);
        $paid  = round((float) $po->paid_amount, 2);

        $requests = PoPaymentRequest::withoutGlobalScope('tenant')->where('purchase_order_id', $po->id)->orderBy('id')->get();
        $names = $this->names($requests->pluck('requested_to')->merge($requests->pluck('requested_by'))->all());
        $pending  = $requests->where('status', PoPaymentRequest::STATUS_PENDING);
        $approved = $requests->where('status', PoPaymentRequest::STATUS_APPROVED);
        $approvedUnpaid = round($approved->sum(fn ($r) => max(0, (float) $r->approved_amount - (float) $r->paid_amount)), 2);

        return [
            'po' => [
                'id' => $po->id, 'code' => $po->code, 'status' => $po->status, 'document_type' => $po->document_type,
                'base_amount' => $base, 'gst_amount' => $gst, 'gst_pct' => $base > 0 ? round($gst / $base * 100, 2) : 0,
                'extra_charges' => $extra, 'grand_total' => $total,
                'tds_percentage' => (float) $po->tds_percentage, 'tds_amount' => $tds, 'tds_saved' => (bool) $po->tds_updated_at,
                'tds_locked' => $paid > 0 || $this->paymentRows($po->id)->exists(),
                'tds_applies' => $po->document_type !== 'international',
                'net_payable' => $net, 'paid' => $paid, 'balance' => round((float) $po->balance_amount, 2),
                'paid_pct' => $net > 0 ? (int) round($paid / $net * 100) : 0,
                'complete' => $net > 0 && $paid >= $net - 0.001,
            ],
            'requests_summary' => [
                'total_requests'   => $requests->count(),
                'approved_count'   => $approved->count(),
                'pending_count'    => $pending->count(),
                'rejected_count'   => $requests->where('status', PoPaymentRequest::STATUS_REJECTED)->count(),
                'requested_amount' => round((float) $requests->sum('requested_amount'), 2),
                'awaiting_amount'  => round((float) $pending->sum('requested_amount'), 2),
                'approved_amount'  => round((float) $approved->sum('approved_amount'), 2),
                'approved_unpaid'  => $approvedUnpaid,
                'ready_count'      => $approved->filter(fn ($r) => (float) $r->approved_amount - (float) $r->paid_amount > 0.001)->count(),
                'paid'             => $paid,
                'open_to_request'  => max(0, $this->openToRequest($po)),
            ],
            'requests' => $requests->map(fn ($r) => $this->shapeRequest($r, $names))->values()->all(),
        ];
    }

    private function shapeRequest(PoPaymentRequest $r, array $names): array
    {
        $approved = $r->approved_amount !== null ? (float) $r->approved_amount : null;
        return [
            'id' => $r->id, 'code' => $r->code, 'payment_type' => $r->payment_type,
            'percentage' => $r->percentage !== null ? (float) $r->percentage : null,
            'requested_amount' => (float) $r->requested_amount, 'reason' => $r->reason,
            'requested_by' => ['id' => $r->requested_by, 'name' => $names[$r->requested_by]['name'] ?? null, 'role' => $names[$r->requested_by]['role'] ?? null],
            'requested_to' => ['id' => $r->requested_to, 'name' => $names[$r->requested_to]['name'] ?? null, 'role' => $names[$r->requested_to]['role'] ?? null],
            'requested_at' => $r->requested_at?->toDateString(),
            'status' => $r->status, 'approved_amount' => $approved, 'decision_note' => $r->decision_note,
            'decided_at' => $r->decided_at?->toDateString(),
            'paid_amount' => (float) $r->paid_amount,
            'due' => $approved !== null ? max(0, round($approved - (float) $r->paid_amount, 2)) : null,
        ];
    }

    private function shapePayment(PoPayment $p): array
    {
        return [
            'id' => $p->id, 'amount' => (float) $p->amount, 'bank_name' => $p->bank_name,
            'utr_cheque_number' => $p->utr_cheque_number, 'utr_cheque_date' => $p->utr_cheque_date?->toDateString(),
            'proof_name' => $p->proof_name, 'proof_url' => $p->proof_path ? file_url($p->proof_path) : null,
            'created_at' => $p->created_at?->toIso8601String(),
            'zoho_synced' => (float) $p->zoho_applied_amount > 0, 'zoho_sync_status' => $p->zoho_sync_status, 'zoho_error' => $p->zoho_error,
        ];
    }

    /** Posted to the Zoho bill already: changing it here would leave the books wrong. */
    private function zohoLocked(?PoPayment $p): ?JsonResponse
    {
        return $p && (float) $p->zoho_applied_amount > 0
            ? $this->fail('This payment is already posted to Zoho Books — it can no longer be changed or deleted.')
            : null;
    }

    /** A PO already in Zoho gets each new payment posted at once; a failure stays on the row for a retry. */
    private function postToZoho(PurchaseOrder $po, PoPayment $p): void
    {
        if (empty($po->zoho_bill_id)) return;
        try {
            app(\App\Services\P2p\PoZohoService::class)->postPayments($po, $p->id);
        } catch (\Throwable $e) {
            Log::warning('P2P Zoho: posting a new payment failed', ['payment' => $p->id, 'err' => $e->getMessage()]);
        }
    }

    /** @return array<int, array{name: ?string, role: ?string}> — name and role (department · designation). */
    private function names(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if (!$ids) return [];
        return DB::table('users as u')
            ->leftJoin('employees as e', fn ($j) => $j->on('e.user_id', '=', 'u.id')->whereNull('e.deleted_at'))
            ->leftJoin('master_departments as d', 'd.id', '=', 'e.department_id')
            ->leftJoin('master_designations as g', 'g.id', '=', 'e.designation_id')
            ->whereIn('u.id', $ids)
            ->get(['u.id', 'u.name', 'd.name as department', DB::raw('COALESCE(g.name, u.designation) as designation')])
            ->mapWithKeys(fn ($u) => [$u->id => ['name' => $u->name, 'role' => implode(' · ', array_filter([$u->department, $u->designation])) ?: null]])
            ->all();
    }

    /** Bell notification; a failed insert never undoes the change itself. */
    private function notify(int $userId, array $data): void
    {
        try {
            DB::table('notifications')->insert([
                'id' => (string) Str::uuid(), 'type' => 'App\\Notifications\\PoPaymentRequest',
                'notifiable_type' => \App\Models\User::class, 'notifiable_id' => $userId,
                'data' => json_encode($data), 'read_at' => null, 'created_at' => now(), 'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('P2P PO: payment notification failed', ['user' => $userId, 'err' => $e->getMessage()]);
        }
    }
}
