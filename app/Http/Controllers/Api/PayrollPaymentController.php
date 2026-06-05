<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Payslip;
use App\Models\PayrollPayment;
use App\Models\PayrollRun;
use App\Services\PayrollService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * "Proceed to Pay" disbursement flow: choose mode (cheque / online NEFT),
 * review the payment advice / bank batch, capture a 3-level sign-off
 * (Prepared → Verified → Approved), then initiate (mark payslips Paid + lock).
 *
 *   POST /payroll/payment/prepare            {run_id, mode}
 *   GET  /payroll/payment/{id}               advice/batch detail
 *   POST /payroll/payment/{id}/approve       {prepared_by, verified_by, approved_by}
 *   POST /payroll/payment/{id}/initiate      disburse (Paid + lock)
 *   GET  /payroll/payment/{id}/bank-file      NEFT bank file (CSV)
 *   GET  /payroll/payment/{id}/audit          audit trail
 */
class PayrollPaymentController extends Controller
{
    public function __construct(
        private PayrollService $payroll,
        private \App\Services\PayslipPdfService $pdf,
    ) {}

    /** Create (or fetch the existing) payment draft for an approved run. */
    public function prepare(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to disburse payroll.'], 403);
        }
        $data = $request->validate([
            'run_id' => ['required', 'integer'],
            'mode'   => ['required', 'in:cheque,online'],
        ]);

        $run = PayrollRun::with('period')->find($data['run_id']);
        if (!$run || !$this->ownsRun($request, $run)) {
            return response()->json(['message' => 'Payroll run not found.'], 404);
        }
        if (!in_array($run->status, ['approved', 'paid'], true)) {
            return response()->json(['message' => 'Approve the payroll before disbursing.'], 422);
        }

        $advice = $this->buildAdvice($run);
        $company = $this->companyHeader($run);

        $payment = PayrollPayment::firstOrNew([
            'payroll_run_id' => $run->id,
        ]);
        // A paid payment is immutable; otherwise (re)sync the draft.
        if ($payment->status !== 'paid') {
            $payment->fill([
                'client_id'         => $run->client_id,
                'branch_id'         => $run->branch_id,
                'payroll_period_id' => $run->payroll_period_id,
                'mode'              => $data['mode'],
                'status'            => $payment->status === 'approved' ? 'approved' : 'draft',
                'employee_count'    => $advice['eligible_count'],
                'total_amount'      => $advice['total'],
                'company_name'      => $company['name'],
                'bank_name'         => $company['bank'],
                'created_by'        => $request->user()?->id,
            ])->save();
        }

        return response()->json(['data' => $this->serialize($payment->fresh(), $advice, $company)]);
    }

    public function show(Request $request, int $id)
    {
        // The advice exposes every employee's net pay + bank details, so it is
        // restricted to payroll managers (not visible to plain employees).
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to view payment details.'], 403);
        }
        $payment = $this->findScoped($request, $id);
        if (!$payment) return response()->json(['message' => 'Payment not found.'], 404);
        $run = PayrollRun::with('period')->find($payment->payroll_run_id);
        return response()->json(['data' => $this->serialize($payment, $this->buildAdvice($run), $this->companyHeader($run))]);
    }

    /** 3-level sign-off (Prepared → Verified → Approved). All mandatory. */
    public function approve(Request $request, int $id)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to approve payment.'], 403);
        }
        $data = $request->validate([
            'prepared_by' => ['required', 'string', 'max:191'],
            'verified_by' => ['required', 'string', 'max:191'],
            'approved_by' => ['required', 'string', 'max:191'],
        ]);
        $payment = $this->findScoped($request, $id);
        if (!$payment) return response()->json(['message' => 'Payment not found.'], 404);
        if ($payment->status === 'paid') {
            return response()->json(['message' => 'Payment is already executed.'], 422);
        }

        $payment->update([
            'prepared_by_name' => $data['prepared_by'],
            'verified_by_name' => $data['verified_by'],
            'approved_by_name' => $data['approved_by'],
            'approved_at'      => now(),
            'status'           => 'approved',
        ]);
        $this->logAudit($request, 'payment_approve', $payment, "Payment sign-off: prepared {$data['prepared_by']}, verified {$data['verified_by']}, approved {$data['approved_by']}");

        return response()->json(['message' => 'Payment approved (3-level sign-off recorded).', 'data' => ['status' => 'approved']]);
    }

    /** Execute the disbursement — mark payslips Paid and lock (Rule 12/14). */
    public function initiate(Request $request, int $id)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to disburse payroll.'], 403);
        }
        $payment = $this->findScoped($request, $id);
        if (!$payment) return response()->json(['message' => 'Payment not found.'], 404);
        if ($payment->status !== 'approved') {
            return response()->json(['message' => 'Complete the 3-level approval before initiating payment.'], 422);
        }
        $run = PayrollRun::with('period')->find($payment->payroll_run_id);
        if (!$run) return response()->json(['message' => 'Payroll run not found.'], 404);
        // The run may have been reopened after this payment was approved.
        // Refuse to disburse a stale payment against a draft/non-approved run.
        if (!in_array($run->status, ['approved', 'paid'], true)) {
            $payment->update(['status' => 'cancelled']);
            return response()->json(['message' => 'This payroll was reopened after approval — re-run and re-prepare the payment.'], 422);
        }

        $result = $this->payroll->disburseRun($run, $request->user()?->id);

        $batchRef = strtoupper(($payment->mode === 'online' ? 'NEFT' : 'CHQ')) . '-' . $run->id . '-' . now()->format('YmdHis');
        $payment->update([
            'status'    => $result['held'] === 0 ? 'paid' : 'approved',
            'paid_at'   => $result['held'] === 0 ? now() : null,
            'batch_ref' => $batchRef,
            'total_amount' => $this->buildAdvice($run)['total'],
        ]);
        $this->logAudit($request, 'payment_initiate', $payment, "Payment initiated ({$payment->mode}) — {$result['paid']} paid, {$result['held']} held. Batch {$batchRef}");

        return response()->json([
            'message' => $result['held'] === 0
                ? "Payment initiated for {$result['paid']} employees. Batch {$batchRef}."
                : "Paid {$result['paid']}; {$result['held']} held — resolve and retry.",
            'data' => ['paid' => $result['paid'], 'held' => $result['held'], 'batch_ref' => $batchRef, 'status' => $payment->fresh()->status],
        ]);
    }

    /** NEFT bank file (CSV) — one row per payable employee. */
    public function bankFile(Request $request, int $id)
    {
        if (!$this->canManage($request) && !$this->canExport($request)) {
            return response()->json(['message' => 'You are not allowed to download the bank file.'], 403);
        }
        $payment = $this->findScoped($request, $id);
        if (!$payment) return response()->json(['message' => 'Payment not found.'], 404);
        $run = PayrollRun::find($payment->payroll_run_id);
        $advice = $this->buildAdvice($run);

        $filename = 'BankFile_' . ($payment->batch_ref ?: $run->id) . '.csv';
        return response()->stream(function () use ($advice) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Narration']);
            foreach ($advice['rows'] as $r) {
                if ($r['status'] !== 'Ready') continue; // only payable rows go to the bank
                fputcsv($out, [$r['name'], $r['account_full'] ?? $r['account'], $r['ifsc'], $r['amount'], 'Salary ' . $r['period']]);
            }
            fclose($out);
        }, 200, ['Content-Type' => 'text/csv', 'Content-Disposition' => "attachment; filename=\"$filename\""]);
    }

    /** GET endpoint — the audit trail for this payment. */
    public function auditTrail(Request $request, int $id)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to view this audit trail.'], 403);
        }
        $payment = $this->findScoped($request, $id);
        if (!$payment) return response()->json(['message' => 'Payment not found.'], 404);
        $logs = class_exists(\App\Models\ActivityLog::class)
            ? \App\Models\ActivityLog::where('module', 'hr.payroll')
                ->where('target_type', PayrollPayment::class)->where('target_id', $payment->id)
                ->orderByDesc('id')->limit(100)->get()
                ->map(fn ($l) => ['action' => $l->action, 'description' => $l->description, 'by' => $l->user_id, 'at' => optional($l->created_at)->toIso8601String()])
            : [];
        return response()->json(['data' => $logs]);
    }

    private function logAudit(Request $request, string $action, $target, string $description): void
    {
        if (!class_exists(\App\Models\ActivityLog::class)) return;
        try {
            \App\Models\ActivityLog::create([
                'user_id' => $request->user()?->id, 'client_id' => $request->user()?->client_id,
                'branch_id' => $target->branch_id ?? null, 'action' => $action, 'module' => 'hr.payroll',
                'target_type' => is_object($target) ? get_class($target) : null,
                'target_id' => is_object($target) ? ($target->id ?? null) : null,
                'description' => $description, 'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 255),
                'url' => $request->fullUrl(), 'method' => $request->method(),
            ]);
        } catch (\Throwable $e) { /* best-effort */ }
    }

    /* ───────────────────────── helpers ───────────────────────── */

    /** Build the payment advice / bank batch rows for a run. */
    private function buildAdvice(PayrollRun $run): array
    {
        $periodLabel = optional($run->period)->label ?? '';
        $slips = Payslip::where('payroll_run_id', $run->id)->orderBy('employee_name')->get();
        // Live bank status per employee — same source disburseRun() uses, so the
        // advice "Ready" set exactly matches what gets paid.
        $bankMap = \App\Models\Employee::whereIn('id', $slips->pluck('employee_id'))
            ->get(['id', 'bank_account_number', 'ifsc_code'])->keyBy('id');
        $rows = [];
        $total = 0; $eligible = 0; $held = 0;
        foreach ($slips as $s) {
            $emp = $bankMap->get($s->employee_id);
            $bankOk = (bool) ($emp && $emp->bank_account_number && $emp->ifsc_code);
            $hasOtherBlock = collect((array) $s->exceptions)
                ->contains(fn ($e) => ($e['type'] ?? null) === 'blocking'
                    && stripos((string) ($e['reason'] ?? ''), 'bank') === false);
            $acct = $emp->bank_account_number ?? $s->bank_account_number;
            $ifsc = $emp->ifsc_code ?? $s->ifsc_code;
            $payable = $bankOk && !$hasOtherBlock && (float) $s->net_pay > 0;
            if ($payable) { $eligible++; $total += (float) $s->net_pay; } else { $held++; }
            $rows[] = [
                'payslip_id' => $s->id,
                'name'       => $s->employee_name,
                'emp_code'   => $s->employee_code,
                'department' => $s->department,
                'bank'       => $acct ? ($ifsc ? substr($ifsc, 0, 4) . ' Bank' : 'Bank') : null,
                'account'    => $acct ? ('XXXX-XXXX-' . substr($acct, -4)) : null,
                'account_full' => $acct,
                'ifsc'       => $ifsc,
                'amount'     => (float) $s->net_pay,
                'status'     => $payable ? 'Ready' : 'Held',
                'period'     => $periodLabel,
            ];
        }
        return ['rows' => $rows, 'total' => round($total, 2), 'eligible_count' => $eligible, 'held_count' => $held, 'total_count' => count($rows)];
    }

    private function companyHeader(PayrollRun $run): array
    {
        $slip = Payslip::where('payroll_run_id', $run->id)->first();
        $head = $slip ? $this->pdf->letterhead($slip) : ['name' => 'Company'];
        return ['name' => $head['name'] ?? 'Company', 'bank' => null, 'period' => optional($run->period)->label];
    }

    private function serialize(PayrollPayment $p, array $advice, array $company): array
    {
        return [
            'id'             => $p->id,
            'run_id'         => $p->payroll_run_id,
            'mode'           => $p->mode,
            'status'         => $p->status,
            'company_name'   => $p->company_name ?: ($company['name'] ?? null),
            'bank_name'      => $p->bank_name,
            'period'         => $company['period'] ?? null,
            'employee_count' => $advice['eligible_count'],
            'total'          => $advice['total'],
            'eligible_count' => $advice['eligible_count'],
            'held_count'     => $advice['held_count'],
            'total_count'    => $advice['total_count'],
            'rows'           => $advice['rows'],
            'prepared_by'    => $p->prepared_by_name,
            'verified_by'    => $p->verified_by_name,
            'approved_by'    => $p->approved_by_name,
            'batch_ref'      => $p->batch_ref,
        ];
    }

    private function ownsRun(Request $request, PayrollRun $run): bool
    {
        $user = $request->user();
        if (!$user || $user->user_type === 'super_admin') return true;
        return !$run->client_id || (int) $run->client_id === (int) $user->client_id;
    }

    private function findScoped(Request $request, int $id): ?PayrollPayment
    {
        $user = $request->user();
        $p = PayrollPayment::find($id);
        if (!$p) return null;
        if ($user && $user->client_id && $p->client_id && (int) $p->client_id !== (int) $user->client_id) return null;
        return $p;
    }

    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;
        $perm = $user->permissions['hr.payroll'] ?? null;
        return is_array($perm) && (($perm['can_edit'] ?? false) || ($perm['can_approve'] ?? false));
    }

    private function canExport(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;
        $perm = $user->permissions['hr.payroll'] ?? null;
        return is_array($perm) && (bool) ($perm['can_export'] ?? false);
    }
}
