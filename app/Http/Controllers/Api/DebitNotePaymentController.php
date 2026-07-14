<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DebitNote;
use App\Models\DebitNotePayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Debit-Note payment recovery ("Payment Recovery" popup).
 *
 * Each recorded amount is recovered from the supplier against a debit note and
 * subtracts from its balance. total_paid = SUM(amount); balance = grand_total −
 * total_paid; and the recovery progress drives the debit note's status
 * (Unpaid → Partially Paid → Fully Paid, or Payment Overdue past the expected
 * debit date). Everything is scoped to the debit note's tenant + branch.
 */
class DebitNotePaymentController extends Controller
{
    /* GET /p2p/debit-notes/{dn}/payment-summary
     * Everything the "Payment Recovery" popup renders, for THIS debit note. */
    public function summary(Request $request, int $dn): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $note = $this->findScoped($dn, $user);

        return response()->json(['status' => true, 'data' => $this->buildSummary($note)]);
    }

    /* POST /p2p/debit-notes/{dn}/payments  (multipart: proof attachment)
     * Record ONE recovered amount against the debit note. */
    public function store(Request $request, int $dn): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $note = $this->findScoped($dn, $user, 'write');

        $data = $request->validate([
            'amount'       => 'required|numeric|min:0.01',
            'bank_name'    => 'nullable|string|max:128',
            'reference_no' => 'nullable|string|max:64',
            'paid_date'    => 'nullable|date',
            'status'       => 'nullable|in:Cleared,Pending',
            'attachment'   => 'nullable|file|mimes:pdf,doc,docx,xls,xlsx,jpg,jpeg,png,webp|max:10240',
        ]);

        // Guard against recovering beyond the debit note's outstanding balance.
        $amount = round((float) $data['amount'], 2);
        $grand = round((float) $note->grand_total, 2);
        $paidBefore = round((float) $note->payments()->sum('amount'), 2);
        $balanceBefore = round($grand - $paidBefore, 2);
        if ($amount > $balanceBefore + 0.001) {
            return response()->json([
                'status'  => false,
                'message' => 'Amount exceeds the outstanding balance of ' . number_format($balanceBefore, 2) . '.',
                'errors'  => ['amount' => ['Amount cannot exceed the outstanding balance.']],
            ], 422);
        }

        $path = null;
        if ($request->hasFile('attachment')) {
            $path = $request->file('attachment')->store('debit-note-payments/attachments', 'public');
        }

        $payment = DB::transaction(function () use ($note, $user, $data, $amount, $balanceBefore, $path) {
            $payment = DebitNotePayment::create([
                'client_id'       => $note->client_id,
                'branch_id'       => $note->branch_id,
                'debit_note_id'   => $note->id,
                'amount'          => $amount,
                'bank_name'       => $data['bank_name'] ?? null,
                'reference_no'    => $data['reference_no'] ?? null,
                'paid_date'       => $data['paid_date'] ?? now()->toDateString(),
                'attachment_path' => $path,
                'balance_after'   => round($balanceBefore - $amount, 2),
                'status'          => $data['status'] ?? 'Cleared',
                'created_by'      => $user->id,
            ]);
            $this->recomputeStatus($note, $user);
            return $payment;
        });

        return response()->json(['status' => true, 'data' => $this->buildSummary($note->fresh()), 'payment_id' => $payment->id], 201);
    }

    /* DELETE /p2p/debit-notes/{dn}/payments/{payment} — remove a recovery. */
    public function destroy(Request $request, int $dn, int $payment): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $note = $this->findScoped($dn, $user, 'write');

        $row = DebitNotePayment::where('debit_note_id', $note->id)->findOrFail($payment);
        DB::transaction(function () use ($note, $row, $user) {
            if ($row->attachment_path) {
                Storage::disk('public')->delete($row->attachment_path);
            }
            $row->delete();
            $this->recomputeStatus($note, $user);
        });

        return response()->json(['status' => true, 'data' => $this->buildSummary($note->fresh())]);
    }

    /* ────────────────────────── internals ────────────────────────── */

    /**
     * Recompute total_paid / balance and the derived status from the debit
     * note's recovered amounts. Status precedence:
     *   Fully Paid   — recovered >= grand total
     *   Payment Overdue — balance outstanding AND past the expected debit date
     *   Partially Paid — some (but not all) recovered
     *   Unpaid       — nothing recovered
     */
    private function recomputeStatus(DebitNote $note, $user): void
    {
        $grand = round((float) $note->grand_total, 2);
        $paid = round((float) $note->payments()->sum('amount'), 2);
        $balance = round($grand - $paid, 2);

        if ($grand > 0 && $paid + 0.001 >= $grand) {
            $status = 'Fully Paid';
        } else {
            $overdue = $note->expected_debit_date
                && \Illuminate\Support\Carbon::parse($note->expected_debit_date)->startOfDay()->isPast();
            if ($overdue) {
                $status = 'Payment Overdue';
            } elseif ($paid > 0) {
                $status = 'Partially Paid';
            } else {
                $status = 'Unpaid';
            }
        }

        $note->forceFill([
            'total_paid' => $paid,
            'balance'    => $balance,
            'status'     => $status,
            'updated_by' => $user->id,
        ])->save();
    }

    /** Assemble the full payment-recovery payload for the popup. */
    private function buildSummary(DebitNote $note): array
    {
        $grand = round((float) $note->grand_total, 2);
        $payments = $note->payments()->get();
        $paid = round((float) $payments->sum('amount'), 2);
        $balance = round($grand - $paid, 2);
        $progress = $grand > 0 ? min(100, round($paid / $grand * 100)) : 0;

        return [
            'debit_note' => [
                'id'       => $note->id,
                'code'     => $note->code,
                'supplier' => $note->supplier_name,
                'status'   => $note->status,
                'expected_debit_date' => optional($note->expected_debit_date)->toDateString(),
            ],
            'amounts' => [
                'totalDebit' => $grand,
                'amountPaid' => $paid,
                'balance'    => $balance,
                'paidCount'  => $payments->count(),
                'progressPct' => $progress,
            ],
            'payments' => $payments->values()->map(fn ($p, $i) => [
                'id'              => $p->id,
                'sr'              => $i + 1,
                'amount'          => (float) $p->amount,
                'bank_name'       => $p->bank_name,
                'reference_no'    => $p->reference_no,
                'paid_date'       => optional($p->paid_date)->toDateString(),
                'attachment_url'  => $p->attachment_url,
                'attachment_name' => $p->attachment_path ? basename($p->attachment_path) : null,
                'balance_after'   => (float) $p->balance_after,
                'status'          => $p->status,
            ]),
        ];
    }

    /** Resolve a debit note scoped to the caller (tenant + branch), mirroring
     *  DebitNoteController::assertScope. `write` blocks cross-branch edits. */
    private function findScoped(int $id, $user, string $action = 'read'): DebitNote
    {
        $note = DebitNote::findOrFail($id);
        if ($user->user_type === 'super_admin') return $note;
        if (!$user->client_id || (int) $note->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type === 'branch_user' && $user->branch_id
            && (int) $note->branch_id !== (int) $user->branch_id) {
            abort(404);
        }
        return $note;
    }
}
