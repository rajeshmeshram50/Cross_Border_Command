<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\ExitNoticePayment;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * Notice-period recovery — the money an employee owes when they resign WITHOUT
 * serving their notice period.
 *
 *   GET  /api/employees/{employee}/notice-payment            summary + history
 *   POST /api/employees/{employee}/notice-payment            employee submits
 *   POST /api/notice-payments/{id}/approve                   HR verifies
 *   POST /api/notice-payments/{id}/reject                    HR refuses
 *
 * The employee raises the payment from their own Payroll Details tab (amount,
 * mode, reference, date + a screenshot of the transfer); HR approves it on the
 * exit wizard's Notice Period Payment stage. Approval is the ONLY thing that
 * settles the recovery, and Final Closure stays blocked until it happens.
 */
class ExitNoticePaymentController extends Controller
{
    private const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * What the employee owes, where to pay it, and everything submitted so far.
     * Read-only — safe to call whether or not an exit exists.
     */
    public function summary(Request $request, $employee)
    {
        $employee = $this->scopedEmployee($request, $employee);
        $exit     = $this->activeExit($employee);
        $due      = $this->amountDue($employee, $exit);

        return response()->json(['data' => [
            'applicable'   => $due['applicable'],
            'amount_due'   => $due['amount'],
            'outstanding'  => $this->outstanding($employee, $due['amount']),
            'breakdown'    => $due['breakdown'],
            'exit'         => $exit ? [
                'id'               => $exit->id,
                'exit_type'        => $exit->exit_type,
                'notice_date'      => $exit->notice_date?->toDateString(),
                'last_working_day' => $exit->last_working_day?->toDateString(),
            ] : null,
            // Where to send the money — the company's own bank accounts.
            'company_accounts' => $this->companyAccounts($employee),
            'payments'     => $this->history($employee),
        ]]);
    }

    /** The employee submits a payment they have already made. */
    public function store(Request $request, $employee)
    {
        $employee = $this->scopedEmployee($request, $employee);
        $exit     = $this->activeExit($employee);
        $due      = $this->amountDue($employee, $exit);

        abort_if(!$due['applicable'], 422,
            'No notice-period payment is due for this employee.');

        $data = $request->validate([
            'amount'            => ['required', 'numeric', 'min:1', 'max:99999999.99'],
            'payment_mode'      => ['required', 'string', 'max:40'],
            'bank_name'         => ['required', 'string', 'max:120'],
            'utr_cheque_number' => ['required', 'string', 'max:40'],
            'payment_date'      => ['required', 'date', 'before_or_equal:' . Carbon::now(self::DISPLAY_TZ)->toDateString()],
            'employee_note'     => ['nullable', 'string', 'max:500'],
            'attachment'        => ['required', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:5120'],
        ], [
            'attachment.required' => 'Upload a screenshot or receipt of the payment.',
        ]);

        // A reference can only be claimed once per employee — the same transfer
        // must not be submitted twice to cover two different shortfalls.
        $dupe = ExitNoticePayment::where('employee_id', $employee->id)
            ->whereRaw('LOWER(utr_cheque_number) = ?', [mb_strtolower(trim($data['utr_cheque_number']))])
            ->where('status', '!=', 'Rejected')
            ->exists();
        abort_if($dupe, 422, 'This UTR / cheque number has already been submitted.');

        $file = $request->file('attachment');
        $path = $file->store('exit-notice-payments/' . $employee->id, 'public');

        $row = ExitNoticePayment::create([
            'client_id'         => $employee->client_id,
            'branch_id'         => $employee->branch_id,
            'employee_id'       => $employee->id,
            'employee_exit_id'  => $exit?->id,
            // Snapshot: the live figure moves with the last working day and the
            // salary basis, so approval must be judged against what was owed
            // when the employee paid — not against a number that changed later.
            'amount_due'        => $due['amount'],
            'amount'            => (float) $data['amount'],
            'payment_mode'      => $data['payment_mode'],
            'bank_name'         => trim($data['bank_name']),
            'utr_cheque_number' => trim($data['utr_cheque_number']),
            'payment_date'      => $data['payment_date'],
            'attachment_path'   => $path,
            'attachment_name'   => $file->getClientOriginalName(),
            'employee_note'     => $data['employee_note'] ?? null,
            'status'            => 'Pending',
            'created_by'        => $request->user()?->id,
        ]);

        return response()->json([
            'message' => 'Payment submitted. HR will verify it and confirm.',
            'data'    => $this->serialize($row),
        ], 201);
    }

    /**
     * HR records a payment that arrived some other way (bank advice, cash desk,
     * an adjustment against F&F) AND rules on it in one go.
     *
     * It writes the SAME row shape as an employee submission — that's the point:
     * a manually-recorded payment has to show up in the employee's own Payment
     * Details tab too, otherwise they'd see "no payment submitted" against an
     * exit HR had already settled.
     */
    public function record(Request $request, $employee)
    {
        $user = $request->user();
        abort_if(!$user, 401);
        abort_if(!in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true), 403,
            'Only HR can record a payment on an employee\'s behalf.');

        $employee = $this->scopedEmployee($request, $employee);
        $exit     = $this->activeExit($employee);
        $due      = $this->amountDue($employee, $exit);

        $data = $request->validate([
            'amount'            => ['required', 'numeric', 'min:1', 'max:99999999.99'],
            'payment_mode'      => ['required', 'string', 'max:40'],
            'bank_name'         => ['required', 'string', 'max:120'],
            'utr_cheque_number' => ['required', 'string', 'max:40'],
            'payment_date'      => ['required', 'date'],
            'remarks'           => ['nullable', 'string', 'max:500'],
            'verdict'           => ['required', 'in:Approved,Rejected'],
        ]);

        if ($data['verdict'] === 'Approved' && (float) $data['amount'] + 0.005 < $due['amount']) {
            abort(422, 'The amount received (' . number_format((float) $data['amount'], 2)
                . ') is short of the ' . number_format($due['amount'], 2)
                . ' due — collect the balance, or reject this payment.');
        }

        $row = DB::transaction(function () use ($data, $employee, $exit, $due, $user) {
            $row = ExitNoticePayment::create([
                'client_id'         => $employee->client_id,
                'branch_id'         => $employee->branch_id,
                'employee_id'       => $employee->id,
                'employee_exit_id'  => $exit?->id,
                'amount_due'        => $due['amount'],
                'amount'            => (float) $data['amount'],
                'payment_mode'      => $data['payment_mode'],
                'bank_name'         => trim($data['bank_name']),
                'utr_cheque_number' => trim($data['utr_cheque_number']),
                'payment_date'      => $data['payment_date'],
                'employee_note'     => 'Recorded by HR on the employee\'s behalf.',
                'status'            => $data['verdict'],
                'verified_by'       => $user->id,
                'verified_at'       => now(),
                'verification_remarks' => $data['remarks'] ?? null,
                'created_by'        => $user->id,
            ]);
            $this->syncExit($row, $data['verdict']);
            return $row;
        });

        return response()->json([
            'message' => $data['verdict'] === 'Approved'
                ? 'Payment recorded and approved — the notice-period recovery is settled.'
                : 'Payment recorded as rejected — the recovery stays outstanding.',
            'data'    => $this->serialize($row),
        ], 201);
    }

    public function approve(Request $request, int $id)
    {
        return $this->decide($request, $id, 'Approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->decide($request, $id, 'Rejected');
    }

    /**
     * HR's verdict. Approving settles the notice recovery on the exit row so
     * Final Closure unblocks; rejecting leaves it outstanding for a fresh
     * submission. Approving BELOW the amount that was due is refused — a part
     * payment doesn't settle the exit.
     */
    private function decide(Request $request, int $id, string $verdict)
    {
        $user = $request->user();
        abort_if(!$user, 401);
        abort_if(!in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true), 403,
            'Only HR can verify a notice-period payment.');

        $row = ExitNoticePayment::findOrFail($id);
        if (!$user->isSuperAdmin() && $user->client_id && (int) $row->client_id !== (int) $user->client_id) {
            abort(403, 'This payment belongs to a different organization.');
        }
        abort_if($row->status !== 'Pending', 422, "This payment is already {$row->status}.");

        $data = $request->validate(['remarks' => ['nullable', 'string', 'max:500']]);

        if ($verdict === 'Approved' && $row->amount + 0.005 < $row->amount_due) {
            abort(422, 'The amount received (' . number_format($row->amount, 2)
                . ') is short of the ' . number_format($row->amount_due, 2)
                . ' due — collect the balance, or reject this payment.');
        }

        DB::transaction(function () use ($row, $verdict, $user, $data) {
            $row->status               = $verdict;
            $row->verified_by          = $user->id;
            $row->verified_at          = now();
            $row->verification_remarks = $data['remarks'] ?? null;
            $row->save();
            $this->syncExit($row, $verdict);
        });

        return response()->json([
            'message' => $verdict === 'Approved'
                ? 'Payment approved — the notice-period recovery is settled.'
                : 'Payment rejected — the recovery stays outstanding.',
            'data'    => $this->serialize($row->fresh()),
        ]);
    }

    /* ── Helpers ───────────────────────────────────────────────────────── */

    /**
     * Mirror a verdict onto the exit case — that's what the wizard's completion
     * gate reads, and what keeps the Notice Period Payment stage in step with
     * the payment rows.
     */
    private function syncExit(ExitNoticePayment $row, string $verdict): void
    {
        $exit = $row->employee_exit_id
            ? EmployeeExit::find($row->employee_exit_id)
            : EmployeeExit::where('employee_id', $row->employee_id)->orderByDesc('id')->first();
        if (!$exit) {
            return;
        }
        $exit->notice_settlement_status = $verdict === 'Approved' ? 'Settled' : 'Rejected';
        $exit->notice_payment = [
            'id'          => $row->id,
            'amount'      => (float) $row->amount,
            'mode'        => $row->payment_mode,
            'bank'        => $row->bank_name,
            'ref'         => $row->utr_cheque_number,
            'date'        => $row->payment_date?->toDateString(),
            'remarks'     => $row->verification_remarks,
            'verdict'     => $verdict === 'Approved' ? 'approved' : 'rejected',
            'verified_at' => now()->toIso8601String(),
        ];
        $exit->save();
    }

    /**
     * What the employee owes. Prefers the figure HR saved on the exit case;
     * falls back to computing it so the employee still sees a number before HR
     * has touched Stage 1.
     */
    private function amountDue(Employee $employee, ?EmployeeExit $exit): array
    {
        $blank = ['applicable' => false, 'amount' => 0.0, 'breakdown' => null];
        if (!$exit || (string) $exit->exit_type !== 'Resignation without notice period') {
            return $blank;
        }
        /* No notice period to serve → nothing is owed. Two cases: still on
           probation, or resigned within 15 days of joining (an early exit is
           exempt even when there was no probation policy at all). */
        if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $exit->notice_date)) {
            return $blank;
        }

        $stored   = (float) ($exit->notice_settlement_amount ?? 0);
        $required = (int) ($exit->notice_days_required ?? $this->noticeDays($employee));
        $served   = (int) ($exit->notice_days_served ?? 0);
        if (!$exit->notice_days_served && $exit->notice_date && $exit->last_working_day) {
            $served = max(0, min($required, Carbon::parse($exit->notice_date)
                ->diffInDays(Carbon::parse($exit->last_working_day), false)));
        }
        $unserved = (int) ($exit->notice_days_unserved ?? max(0, $required - $served));

        // Priced on monthly BASIC ÷ 30 calendar days.
        $perDay = (float) ($exit->notice_per_day_rate ?? 0);
        if ($perDay <= 0) {
            $basic  = self::monthlyBasic($employee);
            $perDay = $basic > 0 ? round($basic / 30, 2) : 0.0;
        }

        $amount = $stored > 0 ? $stored : round($unserved * $perDay, 2);
        if ($amount <= 0) {
            return $blank;
        }

        return [
            'applicable' => true,
            'amount'     => $amount,
            'breakdown'  => [
                'notice_days_required' => $required,
                'notice_days_served'   => $served,
                'notice_days_unserved' => $unserved,
                'per_day_rate'         => $perDay,
                'basis'                => $exit->notice_settlement_basis ?: 'gross',
            ],
        ];
    }

    /**
     * The employee's notice period in days.
     *
     * `notice_period_days` is frequently NULL while the human-readable
     * `notice_period` holds "15 Days" — the wizard has always parsed the label
     * as a fallback, and skipping that here made the recovery read as ₹0 and
     * hid the employee's "Do Payment" button entirely. Same rule as the SPA.
     */
    private function noticeDays(Employee $employee): int
    {
        $n = $employee->notice_period_days;
        if ($n !== null && $n !== '' && is_numeric($n)) {
            return (int) $n;
        }
        return preg_match('/(\d+)/', (string) $employee->notice_period, $m) ? (int) $m[1] : 0;
    }

    /**
     * Monthly BASIC — the basis the notice recovery is priced on. Mirrors
     * PayrollService::resolveCompensation(): the salary structure's basic when
     * one exists, otherwise the standard 50% of monthly gross.
     */
    public static function monthlyBasic(Employee $employee): float
    {
        $annual = (float) ($employee->annual_salary ?? 0);
        if ($annual <= 0) {
            return 0.0;
        }
        return round(($annual / 12) * 0.5, 2);
    }

    /** Amount still to collect after approved payments. */
    private function outstanding(Employee $employee, float $due): float
    {
        $paid = (float) ExitNoticePayment::where('employee_id', $employee->id)
            ->where('status', 'Approved')->sum('amount');
        return round(max(0, $due - $paid), 2);
    }

    /** The company's bank accounts, so the employee knows where to send it. */
    private function companyAccounts(Employee $employee): array
    {
        if (!Schema::hasTable('master_bank_accounts')) {
            return [];
        }
        return DB::table('master_bank_accounts')
            ->whereRaw("LOWER(COALESCE(status,'active')) = ?", ['active'])
            // Tenant scope: the client's own rows plus super-admin globals.
            ->where(fn ($q) => $q->whereNull('client_id')->orWhere('client_id', $employee->client_id))
            ->orderByRaw("CASE WHEN LOWER(COALESCE(is_primary,'no')) = 'yes' THEN 0 ELSE 1 END")
            ->limit(5)
            ->get(['id', 'bank_name', 'account_holder', 'account_number', 'ifsc_code', 'branch_name', 'city', 'is_primary'])
            ->map(fn ($a) => (array) $a)
            ->all();
    }

    private function history(Employee $employee): array
    {
        return ExitNoticePayment::where('employee_id', $employee->id)
            ->orderByDesc('id')
            ->get()
            ->map(fn ($r) => $this->serialize($r))
            ->all();
    }

    private function serialize(ExitNoticePayment $r): array
    {
        return [
            'id'                => $r->id,
            'amount'            => (float) $r->amount,
            'amount_due'        => (float) $r->amount_due,
            'payment_mode'      => $r->payment_mode,
            'bank_name'         => $r->bank_name,
            'utr_cheque_number' => $r->utr_cheque_number,
            'payment_date'      => $r->payment_date?->toDateString(),
            // file_url(), not Storage::url() — see ExitController::uploadFnfAttachment.
            // The raw call throws (→ 500) when the public disk is Azure and
            // AZURE_STORAGE_URL is unset/stale, taking this whole payload with it.
            'attachment_url'    => file_url($r->attachment_path),
            'attachment_name'   => $r->attachment_name,
            'employee_note'     => $r->employee_note,
            'status'            => $r->status,
            'verified_at'       => $r->verified_at?->toIso8601String(),
            'verified_by_name'  => $r->verified_by ? \App\Models\User::find($r->verified_by)?->name : null,
            'verification_remarks' => $r->verification_remarks,
            'submitted_at'      => $r->created_at?->toIso8601String(),
        ];
    }

    /** The most recent exit case that hasn't been rehired away. */
    private function activeExit(Employee $employee): ?EmployeeExit
    {
        return EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Tenant + self-service guard. An employee may act on their OWN record;
     * HR/admin tiers may act on anyone inside their client.
     */
    private function scopedEmployee(Request $request, $employeeId): Employee
    {
        $user = $request->user();
        abort_if(!$user, 401);

        $employee = Employee::withTrashed()->findOrFail($employeeId);
        if (!$user->isSuperAdmin() && $user->client_id && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Employee belongs to a different organization.');
        }
        $isSelf  = (int) ($employee->user_id ?? 0) === (int) $user->id;
        $isAdmin = in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true);
        abort_if(!$isSelf && !$isAdmin, 403, 'You can only manage your own notice-period payment.');

        return $employee;
    }
}
