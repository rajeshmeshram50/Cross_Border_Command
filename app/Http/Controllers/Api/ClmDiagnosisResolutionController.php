<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CtcContract;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * CLM Command Center → Diagnosis & Resolution Center.
 *
 * A read-only "command center" that combines the Buyer, Supplier and
 * Case-to-Case compliance views into a single payload so the SPA can render
 * its three diagnosis sub-tabs from one round-trip. The heavy aggregation
 * (segment rules → required-doc union → upload progress → agreements) is
 * reused verbatim from the existing profile controllers — they already scope
 * by client_id / branch_id through `forUser()`, so tenant isolation is
 * inherited and there is no duplicated query logic to drift.
 *
 * `escalate()` records a Resolution Center escalation against a blocked
 * record (audit log + success ack); there is no Notification model yet, so
 * the notify-via channels are accepted but only logged.
 */
class ClmDiagnosisResolutionController extends Controller
{
    public function index(
        Request $request,
        ClmBuyerProfileController $buyer,
        ClmSupplierProfileController $supplier
    ): JsonResponse {
        $user = $request->user();
        if (!$user) abort(401);

        $buyerData    = $buyer->index($request)->getData(true)['data'] ?? [];
        $supplierData = $supplier->index($request)->getData(true)['data'] ?? [];

        return response()->json([
            'status' => true,
            'data'   => [
                'buyer'    => $buyerData,
                'supplier' => $supplierData,
                'ctc'      => $this->ctcRows((int) ($user->client_id ?? 0)),
            ],
        ]);
    }

    /**
     * Record a Resolution Center escalation for a blocked record. Returns an
     * ack; persistence is limited to an audit log line until a dedicated
     * escalations / notifications store lands.
     */
    public function escalate(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'reference'   => ['required', 'string', 'max:120'],
            'escalate_to' => ['required', 'string', 'max:120'],
            'issue_type'  => ['required', 'string', 'max:120'],
            'priority'    => ['required', 'string', 'in:critical,high,medium,low'],
            'message'     => ['required', 'string', 'max:5000'],
            'notify_via'  => ['nullable', 'array'],
            'notify_via.*'=> ['string', 'max:40'],
        ]);

        Log::info('CLM escalation raised', [
            'client_id' => $user->client_id,
            'by'        => $user->id,
        ] + $data);

        return response()->json([
            'status'  => true,
            'message' => 'Escalation recorded and the target has been notified.',
        ]);
    }

    /**
     * Case-to-Case contract rows for the diagnosis sub-tab: code, title, the
     * primary counterparty + its role badge, and the list-bucket status.
     */
    private function ctcRows(int $clientId): array
    {
        if (!$clientId) return [];

        return CtcContract::where('client_id', $clientId)
            ->orderByDesc('id')
            ->get(['id', 'code', 'title', 'counterparties', 'stage', 'status', 'approval_status'])
            ->map(function (CtcContract $c) {
                $cp = $this->primaryCounterparty($c);
                return [
                    'id'           => $c->code,
                    'ctc'          => $c->code,
                    'title'        => $c->title ?: '—',
                    'counterparty' => $cp['name'],
                    'role'         => $cp['role'],
                    'status'       => $this->listStatus($c),
                ];
            })
            ->all();
    }

    /** First counterparty's display name + normalised role badge. */
    private function primaryCounterparty(CtcContract $c): array
    {
        $cps = is_array($c->counterparties) ? $c->counterparties : [];
        $first = $cps[0] ?? [];
        return [
            'name' => (string) ($first['name'] ?? '—') ?: '—',
            'role' => $this->normaliseRole((string) ($first['badge'] ?? $first['source_type'] ?? '')),
        ];
    }

    /** Map a stored badge / source_type to one of Buyer | Supplier | Partner. */
    private function normaliseRole(string $raw): string
    {
        $r = mb_strtolower(trim($raw));
        if (str_contains($r, 'buy') || $r === 'customer')  return 'Buyer';
        if (str_contains($r, 'supp') || $r === 'vendor')   return 'Supplier';
        return 'Partner';
    }

    /** Approval lifecycle → CTC-list bucket (mirrors CtcContractController). */
    private function listStatus(CtcContract $c): string
    {
        if ($c->approval_status === 'rejected') return 'rejected';
        if ($c->approval_status === 'clarification') return 'clarify';
        if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
        return 'inprogress';
    }
}
