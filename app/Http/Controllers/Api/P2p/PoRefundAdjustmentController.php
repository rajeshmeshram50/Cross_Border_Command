<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PoPaymentRequest;
use App\Models\P2p\PoRefundAdjustment;
use App\Models\P2p\PoRefundRecovery;
use App\Models\P2p\PurchaseOrder;
use App\Services\P2p\PoZohoService;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * P2P · Advance Receipt Refund Adjustment — /api/p2p/orders/refund-adjustments
 *
 * Raising one cancels a PO that has money released (Cancellation Initiated); the supplier's
 * refunds are logged as recoveries until nothing is outstanding (Cancellation Closed).
 * Zoho Books is synced from the list's Zoho Sync column (zohoSync): the vendor credit, then
 * a vendor-credit refund per recovery. Saving never calls Zoho.
 */
class PoRefundAdjustmentController extends Controller
{
    use RunsInTransaction;

    private const TABS = [
        'all'       => 'TRUE',
        'pending'   => "status <> 'recovered'",
        'recovered' => "status = 'recovered'",
    ];
    private const ATTACH_RULE = 'file|max:2048|mimes:pdf,jpg,jpeg,png,webp';
    private const PROOF_RULE  = 'file|max:10240|mimes:pdf,jpg,jpeg,png,webp';

    public function __construct(private PurchaseOrderService $svc, private PoZohoService $zoho) {}

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

    /* ══════════════════════════ LIST ══════════════════════════ */

    /** GET /refund-adjustments?tab=&search=&page=&per_page= — paged, with every tab's count. */
    public function index(Request $request): JsonResponse
    {
        $this->tenantUser($request);
        $request->validate([
            'tab'      => ['nullable', Rule::in(array_keys(self::TABS))],
            'search'   => 'nullable|string|max:100',
            'per_page' => 'nullable|integer|min:1|max:50',
        ]);

        $base = PoRefundAdjustment::query();
        if ($s = trim((string) $request->query('search'))) {
            $base->where(fn ($w) => $w->where('code', 'ilike', "%{$s}%")
                ->orWhere('supplier_ref_no', 'ilike', "%{$s}%")
                ->orWhereHas('purchaseOrder', fn ($p) => $p->where('code', 'ilike', "%{$s}%"))
                ->orWhereHas('vendor', fn ($v) => $v->where('vendor_code', 'ilike', "%{$s}%")
                    ->orWhere('company_name', 'ilike', "%{$s}%")->orWhere('legal_name', 'ilike', "%{$s}%")));
        }

        $counts = (clone $base)->toBase()->selectRaw(implode(', ', array_map(
            fn ($key, $cond) => "COUNT(*) FILTER (WHERE {$cond}) AS \"{$key}\"", array_keys(self::TABS), self::TABS,
        )))->first();

        $page = $base->whereRaw(self::TABS[$request->query('tab', 'all')])
            ->with(['purchaseOrder' => fn ($q) => $q->withoutGlobalScope('tenant'), 'vendor:id,vendor_code,company_name,legal_name'])
            ->withCount(['recoveries', 'recoveries as zoho_pending_count' => fn ($q) => $q->whereNull('zoho_refund_id')])
            ->orderByDesc('id')
            ->paginate($request->integer('per_page') ?: 10);

        $pos = collect($page->items())->pluck('purchaseOrder')->filter();
        $refs = $this->linkRefs($pos);

        return $this->ok(collect($page->items())->map(fn ($a) => $this->shape($a, $refs))->all(), 200, [
            'meta' => [
                'total' => $page->total(), 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage(),
                'counts' => array_map('intval', (array) $counts),
            ],
        ]);
    }

    /** GET /refund-adjustments/eligible-pos?search= — POs with money released and no adjustment yet. */
    public function eligiblePos(Request $request): JsonResponse
    {
        $this->tenantUser($request);
        $request->validate(['search' => 'nullable|string|max:100']);
        $q = PurchaseOrder::query()
            ->where('paid_amount', '>', 0)
            ->where('status', '<>', PurchaseOrder::STATUS_CANCELLED)
            ->whereDoesntHave('refundAdjustment')
            ->with('vendor:id,vendor_code,company_name,legal_name');
        if ($s = trim((string) $request->query('search'))) {
            $q->where(fn ($w) => $w->where('code', 'ilike', "%{$s}%")
                ->orWhereHas('vendor', fn ($v) => $v->where('company_name', 'ilike', "%{$s}%")->orWhere('legal_name', 'ilike', "%{$s}%")));
        }
        $rows = $q->orderByDesc('id')->limit(50)->get(['id', 'code', 'po_date', 'vendor_id', 'paid_amount']);
        return $this->ok($rows->map(fn ($po) => [
            'id' => $po->id, 'code' => $po->code, 'po_date' => $po->po_date?->toDateString(),
            'supplier_name' => $po->vendor ? ($po->vendor->legal_name ?: $po->vendor->company_name) : null,
            'supplier_code' => $po->vendor?->vendor_code,
            'paid_amount' => (float) $po->paid_amount,
        ])->all());
    }

    /** GET /refund-adjustments/po/{po} — the PO the new adjustment is for, plus the number it will get. */
    public function forPo(Request $request, int $po): JsonResponse
    {
        $user = $this->tenantUser($request);
        $order = PurchaseOrder::findOrFail($po);
        if ($order->isCancelled()) return $this->fail('This PO is already cancelled.');
        if ((float) $order->paid_amount <= 0) return $this->fail('No money has been released on this PO — cancel it directly instead.');
        if ($order->refundAdjustment()->exists()) return $this->fail('This PO already has a refund adjustment.');
        return $this->ok([
            'next_code' => $this->svc->nextRefundCode((int) $user->client_id, false),
            'po'        => $this->shapePo($order, $this->linkRefs(collect([$order]))),
        ]);
    }

    /** GET /refund-adjustments/{id} — the adjustment with its recoveries. */
    public function show(int $id): JsonResponse
    {
        $adj = PoRefundAdjustment::with(['purchaseOrder' => fn ($q) => $q->withoutGlobalScope('tenant'), 'vendor:id,vendor_code,company_name,legal_name'])
            ->withCount('recoveries')->findOrFail($id);
        return $this->ok($this->detail($adj));
    }

    /* ══════════════════════════ RAISE / EDIT ══════════════════════════ */

    /** POST /refund-adjustments (multipart) — raise it; the PO is cancelled in the same transaction. */
    public function store(Request $request): JsonResponse
    {
        $user = $this->tenantUser($request);
        $data = $this->validateForm($request, true);
        $order = PurchaseOrder::findOrFail((int) $data['purchase_order_id']);

        $file = $request->file('attachment');
        $path = $file?->store("p2p/refund-adjustments/{$order->id}", 'public');

        $adj = $this->inTransaction('raise the refund adjustment', function () use ($order, $user, $data, $file, $path) {
            $po = PurchaseOrder::whereKey($order->id)->lockForUpdate()->first();
            if ($po->isCancelled()) $this->abort('This PO is already cancelled.');
            if (PoRefundAdjustment::withoutGlobalScope('tenant')->where('purchase_order_id', $po->id)->exists()) {
                $this->abort('This PO already has a refund adjustment.');
            }
            $paid = round((float) $po->paid_amount, 2);
            if ($paid <= 0) $this->abort('No money has been released on this PO — cancel it directly instead.');
            $figures = $this->figures($data, $paid, 0.0);

            $adj = PoRefundAdjustment::create([
                'client_id' => $po->client_id, 'branch_id' => $po->branch_id,
                'code' => $this->svc->nextRefundCode((int) $po->client_id),
                'purchase_order_id' => $po->id, 'vendor_id' => $po->vendor_id,
                'refund_date' => now()->toDateString(),
                'supplier_ref_no' => $data['supplier_ref_no'] ?? null,
                'attachment_path' => $path, 'attachment_name' => $file?->getClientOriginalName(),
                'refund_type' => $data['refund_type'], 'reason' => $data['reason'],
                'paid_amount' => $paid,
                'created_by' => $user->id, 'updated_by' => $user->id,
            ] + $figures);
            $this->refreshTotals($adj);

            // Pending requests can no longer be paid, so they are closed with the PO.
            PoPaymentRequest::withoutGlobalScope('tenant')->where('purchase_order_id', $po->id)
                ->where('status', PoPaymentRequest::STATUS_PENDING)
                ->update(['status' => 'rejected', 'decision_note' => 'Closed — PO cancelled (' . $adj->code . ').', 'decided_at' => now()]);

            $this->svc->releaseAll($po, 'cancelled', $user->id);
            $po->update([
                'status' => PurchaseOrder::STATUS_CANCELLED, 'cancelled_at' => now(), 'cancelled_by' => $user->id,
                'cancel_reason' => $data['reason'], 'cancel_stage' => PurchaseOrder::CANCEL_INITIATED, 'updated_by' => $user->id,
            ]);
            return $adj;
        }, [$path]);

        // Zoho Books is synced from the list's Zoho Sync column, not on save.
        return $this->ok($this->detail($adj->fresh()), 201);
    }

    /** POST /refund-adjustments/{id} (multipart) — edit; amounts are fixed once the vendor credit is in Zoho. */
    public function update(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $adj = PoRefundAdjustment::findOrFail($id);
        $data = $this->validateForm($request, false);

        $file = $request->file('attachment');
        $path = $file?->store("p2p/refund-adjustments/{$adj->purchase_order_id}", 'public');
        $old = $adj->attachment_path;

        $this->inTransaction('update the refund adjustment', function () use ($adj, $user, $data, $file, $path) {
            $row = PoRefundAdjustment::whereKey($adj->id)->lockForUpdate()->first();
            /* Recoveries are booked against these figures, so the adjustment is
               closed to edits from the first one onwards (CS-588). */
            if ($row->status === PoRefundAdjustment::STATUS_RECOVERED) {
                $this->abort('Every rupee of this refund has been recovered — it can no longer be changed.');
            }
            if ((float) $row->recovered_amount > 0.001 || $row->recoveries()->exists()) {
                $this->abort('A recovery has already been recorded against this refund — its figures can no longer be changed.');
            }
            $figures = $this->figures($data, (float) $row->paid_amount, (float) $row->recovered_amount);
            $amountsChanged = abs($figures['refund_amount'] - (float) $row->refund_amount) > 0.001
                || ($figures['retained_type'] ?? null) !== $row->retained_type;
            if ($amountsChanged && $row->zoho_vendorcredit_id) {
                $this->abort('The vendor credit is already in Zoho Books — the refund amount can no longer be changed.', ['refund_amount' => ['Locked after the Zoho sync.']]);
            }
            $attrs = [
                'supplier_ref_no' => $data['supplier_ref_no'] ?? null,
                'refund_type' => $data['refund_type'], 'reason' => $data['reason'], 'updated_by' => $user->id,
            ] + $figures;
            if ($path) $attrs += ['attachment_path' => $path, 'attachment_name' => $file->getClientOriginalName()];
            $row->update($attrs);
            $this->refreshTotals($row);
            PurchaseOrder::withoutGlobalScope('tenant')->whereKey($row->purchase_order_id)->update(['cancel_reason' => $data['reason']]);
        }, [$path]);

        if ($path && $old) Storage::disk('public')->delete($old);
        return $this->ok($this->detail($adj->fresh()));
    }

    /**
     * POST /refund-adjustments/{id}/zoho-sync — from the list's Zoho Sync column: the vendor credit
     * (created and applied to the bill once), then every recovery not yet refunded in Zoho.
     */
    public function zohoSync(Request $request, int $id): JsonResponse
    {
        $user = $this->tenantUser($request);
        $adj = PoRefundAdjustment::findOrFail($id);
        try {
            $r = $this->zoho->syncAll($this->poOf($adj), $user->id);
        } catch (\RuntimeException $e) {
            return $this->fail($e->getMessage());
        }
        return $this->ok($this->detail($adj->fresh()), 200, ['message' => 'Synced to Zoho Books — ' . $this->zoho->summary($r) . '.']);
    }

    /* ══════════════════════════ RECOVERIES ══════════════════════════ */

    /** POST /refund-adjustments/{id}/recoveries (multipart) — money received back. */
    public function storeRecovery(Request $request, int $id): JsonResponse
    {
        return $this->saveRecovery($request, $id, null);
    }

    /** POST /refund-adjustments/{id}/recoveries/{rec} (multipart) — edit a recovery. */
    public function updateRecovery(Request $request, int $id, int $rec): JsonResponse
    {
        return $this->saveRecovery($request, $id, $rec);
    }

    private function saveRecovery(Request $request, int $id, ?int $recId): JsonResponse
    {
        $user = $this->tenantUser($request);
        $adj = PoRefundAdjustment::findOrFail($id);
        $existing = $recId ? $adj->recoveries()->findOrFail($recId) : null;
        if ($blocked = $this->zohoLockedRecovery($existing)) return $blocked;

        $data = $request->validate([
            'amount'         => 'required|numeric|min:1|max:9999999999999.99',
            'recovered_date' => 'required|date|before_or_equal:today|after_or_equal:' . $adj->refund_date->toDateString(),
            'reference_no'   => 'nullable|string|max:64',
            'proof'          => 'nullable|' . self::PROOF_RULE,
        ], [
            'amount.required'                => 'Enter the recovered amount.',
            'amount.min'                     => 'The recovered amount must be at least ₹1.',
            'recovered_date.before_or_equal' => 'Refunded date cannot be in the future.',
            'recovered_date.after_or_equal'  => 'Refunded date cannot be before the refund adjustment date.',
            'proof.max'                      => 'Proof of payment must be 10 MB or smaller.',
            'proof.mimes'                    => 'Proof of payment must be a PDF or image file.',
        ]);

        $ref = !empty($data['reference_no']) ? mb_strtoupper(trim($data['reference_no'])) : null;
        if ($ref !== null && $ref !== '') {
            $dup = PoRefundRecovery::withoutGlobalScope('tenant')
                ->where('client_id', $adj->client_id)
                ->whereRaw('UPPER(TRIM(reference_no)) = ?', [$ref])
                ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))
                ->exists();
            if ($dup) {
                return $this->fail('This cheque / UTR number is already used on another recovered payment.', 422,
                    ['reference_no' => ['Already used on another recovered payment.']]);
            }
        }

        $file = $request->file('proof');
        $path = $file?->store("p2p/refund-recoveries/{$adj->id}", 'public');
        $amount = round((float) $data['amount'], 2);

        $saved = $this->inTransaction($existing ? 'update the recovery' : 'record the recovery', function () use ($adj, $existing, $user, $data, $amount, $ref, $file, $path) {
            $row = PoRefundAdjustment::whereKey($adj->id)->lockForUpdate()->first();
            $others = (float) $row->recoveries()->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))->sum('amount');
            $room = round((float) $row->refund_amount - $others, 2);
            if ($amount > $room + 0.001) {
                $this->abort('Only ' . number_format(max(0, $room), 2) . ' is still to be recovered on this refund.', ['amount' => ['Amount exceeds the balance to recover.']]);
            }
            $attrs = [
                'amount' => $amount, 'recovered_date' => $data['recovered_date'],
                'reference_no' => $ref,
                'updated_by' => $user->id,
            ];
            if ($path) $attrs += ['proof_path' => $path, 'proof_name' => $file->getClientOriginalName()];
            $rec = $existing
                ? tap($existing)->update($attrs)
                : PoRefundRecovery::create($attrs + [
                    'client_id' => $row->client_id, 'branch_id' => $row->branch_id,
                    'refund_adjustment_id' => $row->id, 'purchase_order_id' => $row->purchase_order_id, 'created_by' => $user->id,
                ]);
            $this->refreshTotals($row);
            return $rec;
        }, [$path]);

        return $this->ok($this->detail($adj->fresh()), $existing ? 200 : 201);
    }

    /** DELETE /refund-adjustments/{id}/recoveries/{rec} — removed from Zoho first, then soft-deleted. */
    public function destroyRecovery(Request $request, int $id, int $rec): JsonResponse
    {
        $user = $this->tenantUser($request);
        $adj = PoRefundAdjustment::findOrFail($id);
        $row = $adj->recoveries()->findOrFail($rec);
        if ($blocked = $this->zohoLockedRecovery($row)) return $blocked;

        $this->inTransaction('delete the recovery', function () use ($adj, $row, $user) {
            $locked = PoRefundAdjustment::whereKey($adj->id)->lockForUpdate()->first();
            $row->update(['updated_by' => $user->id]);
            $row->delete();
            $this->refreshTotals($locked);
        });
        return $this->ok($this->detail($adj->fresh()));
    }

    /** A refund already in Zoho Books cannot be pulled back, so the row is frozen here. */
    private function zohoLockedRecovery(?PoRefundRecovery $r): ?JsonResponse
    {
        return $r && ($r->zoho_sync_status === 'synced' || !empty($r->zoho_refund_id))
            ? $this->fail('This refund is already posted to Zoho Books — it can no longer be changed or deleted.')
            : null;
    }

    /** POST /refund-adjustments/{id}/recoveries/{rec}/zoho-sync — post the refund to Zoho again. */
    public function zohoSyncRecovery(Request $request, int $id, int $rec): JsonResponse
    {
        $user = $this->tenantUser($request);
        $adj = PoRefundAdjustment::findOrFail($id);
        $row = $adj->recoveries()->findOrFail($rec);
        // Same chain as every other Zoho Sync button, so this refund can never land
        // before the PO, its bill, its payments and the vendor credit are there.
        try {
            $r = $this->zoho->syncAll($this->poOf($adj), $user->id);
        } catch (\RuntimeException $e) {
            return $this->fail($e->getMessage());
        }
        if (empty($row->fresh()->zoho_refund_id)) return $this->fail('This refund was not posted to Zoho Books — try again.');

        return $this->ok($this->detail($adj->fresh()), 200, ['message' => 'Synced to Zoho Books — ' . $this->zoho->summary($r) . '.']);
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    private function validateForm(Request $request, bool $creating): array
    {
        return $request->validate([
            'purchase_order_id' => $creating ? 'required|integer' : 'prohibited',
            'supplier_ref_no'   => 'nullable|string|max:64',
            'attachment'        => 'nullable|' . self::ATTACH_RULE,
            'refund_type'       => ['required', Rule::in(PoRefundAdjustment::REFUND_TYPES)],
            'reason'            => 'required|string|min:3|max:500',
            'refund_amount'     => 'required|numeric|min:0.01|max:9999999999999.99',
            'retained_type'     => ['nullable', Rule::in(PoRefundAdjustment::RETAIN_REASONS)],
            'retained_remark'   => 'nullable|string|max:300',
        ], [
            'refund_type.required'   => 'Select the advance refund type.',
            'reason.required'        => 'Enter the advance refund adjustment reason.',
            'reason.min'             => 'The reason must be at least 3 characters.',
            'refund_amount.required' => 'Enter the amount to be refunded.',
            'refund_amount.min'      => 'The amount to be refunded must be more than 0.',
            'attachment.max'         => 'The refund reference attachment must be 2 MB or smaller.',
            'attachment.mimes'       => 'The refund reference attachment must be a PDF or image file.',
        ]);
    }

    /** Refund, retained and balance from the form — the same rules the form shows. */
    private function figures(array $data, float $paid, float $recovered): array
    {
        $refund = round((float) $data['refund_amount'], 2);
        if ($refund > $paid + 0.001) {
            $this->abort('The amount to be refunded cannot be more than the ' . number_format($paid, 2) . ' paid.', ['refund_amount' => ['More than the amount paid.']]);
        }
        if ($refund + 0.001 < $recovered) {
            $this->abort(number_format($recovered, 2) . ' has already been recovered — the refund cannot be less than that.', ['refund_amount' => ['Less than already recovered.']]);
        }
        $retained = round($paid - $refund, 2);
        $full = $data['refund_type'] === 'Full Refund';
        if ($full && $retained > 0.001) {
            $this->abort('A full refund must return the whole ' . number_format($paid, 2) . ' paid — choose Partial Refund to keep part of it back.', ['refund_type' => ['Full refund must equal the amount paid.']]);
        }
        if (!$full && $retained <= 0.001) {
            $this->abort('A partial refund must be less than the amount paid — choose Full Refund to return all of it.', ['refund_type' => ['Partial refund must be less than paid.']]);
        }
        if ($retained > 0.001 && (empty($data['retained_type']) || trim((string) ($data['retained_remark'] ?? '')) === '')) {
            $this->abort('Give the reason and a remark for the ' . number_format($retained, 2) . ' not being refunded.', [
                'retained_type' => empty($data['retained_type']) ? ['Select the reason.'] : [],
                'retained_remark' => trim((string) ($data['retained_remark'] ?? '')) === '' ? ['Enter a remark.'] : [],
            ]);
        }
        return [
            'refund_amount'   => $refund,
            'retained_amount' => max(0, $retained),
            'retained_type'   => $retained > 0.001 ? $data['retained_type'] : null,
            'retained_remark' => $retained > 0.001 ? trim((string) $data['retained_remark']) : null,
        ];
    }

    /** Recovered / balance / status rebuilt from the rows; the PO closes when nothing is left. */
    private function refreshTotals(PoRefundAdjustment $adj): void
    {
        $recovered = round((float) PoRefundRecovery::withoutGlobalScope('tenant')->where('refund_adjustment_id', $adj->id)->sum('amount'), 2);
        $balance = round(max(0, (float) $adj->refund_amount - $recovered), 2);
        $status = $balance <= 0.005 ? PoRefundAdjustment::STATUS_RECOVERED
            : ($recovered > 0 ? PoRefundAdjustment::STATUS_PARTIAL : PoRefundAdjustment::STATUS_PENDING);
        $adj->forceFill(['recovered_amount' => $recovered, 'balance_amount' => $balance, 'status' => $status])->save();

        $closed = $status === PoRefundAdjustment::STATUS_RECOVERED;
        PurchaseOrder::withoutGlobalScope('tenant')->whereKey($adj->purchase_order_id)->update([
            'cancel_stage'     => $closed ? PurchaseOrder::CANCEL_CLOSED : PurchaseOrder::CANCEL_INITIATED,
            'cancel_closed_at' => $closed ? now() : null,
        ]);
    }

    /** Zoho after the save: a failure is stored on the row and reported, never undoes the save. */
    private function tryZoho(callable $fn): array
    {
        if (!$this->zoho->configured()) return ['status' => 'skipped', 'message' => 'Zoho Books is not connected — sync it later.'];
        try {
            $fn();
            return ['status' => 'synced', 'message' => null];
        } catch (\RuntimeException $e) {
            return ['status' => 'failed', 'message' => $e->getMessage()];
        }
    }

    private function abort(string $message, array $errors = []): never
    {
        abort(response()->json(['status' => false, 'message' => $message] + ($errors ? ['errors' => array_filter($errors)] : []), 422));
    }

    /** Shipment, PI and opportunity codes for a set of POs, in two queries. */
    private function linkRefs($pos): array
    {
        $ships = DB::table('shipment_orders')->whereIn('id', $pos->pluck('shipment_order_id')->filter()->unique()->all())
            ->get(['id', 'shipment_code', 'created_at'])->keyBy('id');
        $pis = DB::table('proforma_invoices')->whereIn('id', $pos->pluck('proforma_invoice_id')->filter()->unique()->all())
            ->get(['id', 'code', 'opp_code', 'created_at'])->keyBy('id');
        $out = [];
        foreach ($pos as $po) {
            $sh = $ships->get($po->shipment_order_id);
            $pi = $pis->get($po->proforma_invoice_id);
            $out[$po->id] = [
                'shipment_code'    => $sh->shipment_code ?? null,
                'shipment_date'    => isset($sh->created_at) ? substr((string) $sh->created_at, 0, 10) : null,
                'opportunity_code' => $pi->opp_code ?? null,
                'opportunity_date' => isset($pi->created_at) ? substr((string) $pi->created_at, 0, 10) : null,
            ];
        }
        return $out;
    }

    private function shapePo(PurchaseOrder $po, array $refs): array
    {
        $po->loadMissing('vendor:id,vendor_code,company_name,legal_name');
        return [
            'id' => $po->id, 'code' => $po->code, 'po_date' => $po->po_date?->toDateString(),
            'po_type' => $po->po_type, 'document_type' => $po->document_type,
            'expected_delivery_date' => $po->expected_delivery_date?->toDateString(),
            'mode_of_transport' => $po->mode_of_transport, 'payment_type' => $po->payment_type,
            'physical_inspection' => $po->physical_inspection === 'yes',
            'grand_total' => (float) $po->grand_total, 'tds_amount' => (float) $po->tds_amount,
            'net_payable' => round((float) $po->grand_total - (float) $po->tds_amount, 2),
            'paid_amount' => (float) $po->paid_amount, 'balance_amount' => (float) $po->balance_amount,
            'status' => $po->status, 'cancel_stage' => $po->cancel_stage, 'cancel_reason' => $po->cancel_reason,
            'procurement_code' => $po->procurement_request_code,
            'vendor_id' => $po->vendor_id,
            'supplier_code' => $po->vendor?->vendor_code,
            'supplier_name' => $po->vendor ? ($po->vendor->legal_name ?: $po->vendor->company_name) : null,
            'zoho_bill_number' => $po->zoho_bill_number,
        ] + ($refs[$po->id] ?? []);
    }

    private function shape(PoRefundAdjustment $a, array $refs): array
    {
        return [
            'id' => $a->id, 'code' => $a->code, 'refund_date' => $a->refund_date?->toDateString(),
            'supplier_ref_no' => $a->supplier_ref_no,
            'attachment_name' => $a->attachment_name, 'attachment_url' => $a->attachment_path ? file_url($a->attachment_path) : null,
            'refund_type' => $a->refund_type, 'reason' => $a->reason,
            'paid_amount' => (float) $a->paid_amount, 'refund_amount' => (float) $a->refund_amount,
            'retained_amount' => (float) $a->retained_amount, 'retained_type' => $a->retained_type, 'retained_remark' => $a->retained_remark,
            'recovered_amount' => (float) $a->recovered_amount, 'balance_amount' => (float) $a->balance_amount,
            'status' => $a->status, 'recoveries_count' => (int) ($a->recoveries_count ?? 0),
            'zoho_pending_recoveries' => (int) ($a->zoho_pending_count ?? 0),
            'zoho_vendorcredit_number' => $a->zoho_vendorcredit_number, 'zoho_sync_status' => $a->zoho_sync_status,
            'zoho_error' => $a->zoho_error, 'zoho_synced_at' => $a->zoho_synced_at?->toIso8601String(),
            'amounts_locked' => (bool) $a->zoho_vendorcredit_id,
            'po' => $a->purchaseOrder ? $this->shapePo($a->purchaseOrder, $refs) : null,
        ];
    }

    /** The adjustment's PO, tenant-scoped like every other read here. */
    private function poOf(PoRefundAdjustment $a): PurchaseOrder
    {
        return PurchaseOrder::findOrFail($a->purchase_order_id);
    }

    /**
     * GET /refund-adjustments/{id}/pdf[?download=1] — the Advance Receipt Refund Adjustment
     * document, on our own letterhead. It prints what we raise the vendor credit with,
     * worked out from our data; Zoho is never called to build it.
     */
    public function pdf(Request $request, int $id)
    {
        $adj = PoRefundAdjustment::findOrFail($id);
        $name = preg_replace('/[^A-Za-z0-9_-]/', '_', (string) $adj->code) . '.pdf';

        return response($this->renderPdf($adj), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => ($request->boolean('download') ? 'attachment' : 'inline') . '; filename="' . $name . '"',
        ]);
    }

    private function renderPdf(PoRefundAdjustment $adj): string
    {
        @set_time_limit(180);
        return \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.vendor-credit', $this->creditViewData($adj))
            ->setPaper('A4', 'portrait')->setOption('isPhpEnabled', true)->output();
    }

    /** Everything pdf/vendor-credit.blade.php prints. */
    private function creditViewData(PoRefundAdjustment $adj): array
    {
        $p = $this->zoho->creditPreview($adj);
        $po = $p['po'];
        $sales = app(\App\Http\Controllers\Api\SalesPdfController::class);
        $vendor = $po->vendor_id ? \App\Models\Vendor::withTrashed()->with('primaryAddress')->find($po->vendor_id) : null;
        $branch = \App\Models\Branch::find($po->branch_id);
        // Same barcode strip as the PO: the branch website, else its name.
        $barcodeValue = trim((string) ($branch?->website ?? '')) ?: trim((string) ($branch?->name ?? ''));

        $view = [
            'companyDetails' => $sales->letterheadFrom($branch, \App\Models\Client::find($po->client_id)),
            'barcodeData'    => $barcodeValue !== '' ? $sales->barcodeFor($barcodeValue) : null,
            'barcodeText'    => $barcodeValue,
            'vendor'         => $sales->vendorBlockFor($vendor),
            'adr' => (object) [
                'code'            => $adj->code,
                'date'            => optional($adj->refund_date)->format('d/m/Y') ?: '',
                'po_code'         => $po->code,
                'po_date'         => optional($po->po_date)->format('d/m/Y') ?: '',
                'refund_type'     => ucwords(str_replace('_', ' ', (string) $adj->refund_type)),
                'reason'          => (string) $adj->reason,
                'retained_type'   => (string) $adj->retained_type,
                'retained_remark' => (string) $adj->retained_remark,
                'supplier_ref'    => (string) $adj->supplier_ref_no,
                'currency'        => $po->currency_code ?: 'INR',
                'document_type'   => ucfirst((string) ($po->document_type ?: 'domestic')),
                'shipment'        => (string) ($po->shipment_code ?? ''),
                'opportunity'     => (string) ($po->opportunity_code ?? ''),
            ],
            'lines'  => $p['lines'],
            'totals' => (object) [
                'sub_total'    => $p['sub_total'],
                'tax_total'    => $p['tax_total'],
                'charges'      => $p['charges'],
                'tds'          => $p['tds'],
                'retained'     => $p['retained'],
                'credit_total' => $p['total'],
                'tax_mode'     => $p['tax_mode'],
                'po_total'     => $p['po_total'],
                'net'          => $p['net'],
                'paid'         => $p['paid'],
                'refund'       => (float) $adj->refund_amount,
                'recovered'    => (float) $adj->recovered_amount,
                'balance'      => (float) $adj->balance_amount,
            ],
        ];

        return $view;
    }

    private function detail(PoRefundAdjustment $a): array
    {
        $a->loadMissing(['purchaseOrder' => fn ($q) => $q->withoutGlobalScope('tenant'), 'vendor:id,vendor_code,company_name,legal_name']);
        $a->loadCount(['recoveries', 'recoveries as zoho_pending_count' => fn ($q) => $q->whereNull('zoho_refund_id')]);
        $refs = $a->purchaseOrder ? $this->linkRefs(collect([$a->purchaseOrder])) : [];
        return $this->shape($a, $refs) + [
            'recoveries' => $a->recoveries()->get()->map(fn (PoRefundRecovery $r) => [
                'id' => $r->id, 'amount' => (float) $r->amount, 'recovered_date' => $r->recovered_date?->toDateString(),
                'reference_no' => $r->reference_no,
                'proof_name' => $r->proof_name, 'proof_url' => $r->proof_path ? file_url($r->proof_path) : null,
                'zoho_sync_status' => $r->zoho_sync_status, 'zoho_error' => $r->zoho_error,
                'zoho_synced_at' => $r->zoho_synced_at?->toIso8601String(),
            ])->all(),
            // Evidence Vault: money released on the PO, and its documents that carry a file.
            'payments' => DB::table('p2p_po_payments')->where('purchase_order_id', $a->purchase_order_id)->whereNull('deleted_at')
                ->orderBy('id')->get(['id', 'amount', 'utr_cheque_number', 'utr_cheque_date', 'proof_name', 'proof_path', 'created_at'])
                ->map(fn ($p) => [
                    'id' => $p->id, 'amount' => (float) $p->amount, 'utr' => $p->utr_cheque_number,
                    'date' => $p->utr_cheque_date ?: substr((string) $p->created_at, 0, 10),
                    'proof_name' => $p->proof_name, 'proof_url' => $p->proof_path ? file_url($p->proof_path) : null,
                ])->all(),
            'documents' => DB::table('p2p_purchase_order_documents')->where('purchase_order_id', $a->purchase_order_id)->whereNull('deleted_at')
                ->whereNotNull('file_path')->orderBy('id')->get(['id', 'code', 'name', 'original_name', 'file_path', 'status', 'generated_on'])
                ->map(fn ($d) => [
                    'id' => $d->id, 'name' => $d->name ?: $d->original_name ?: $d->code, 'status' => $d->status,
                    'date' => $d->generated_on, 'url' => file_url($d->file_path),
                ])->all(),
        ];
    }
}
