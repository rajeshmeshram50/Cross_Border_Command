<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\ExitNoticePayment;
use App\Models\Module;
use App\Models\Permission;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ExitNoticePaymentController extends Controller
{
    private const DISPLAY_TZ = 'Asia/Kolkata';

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
            'company_accounts' => $this->companyAccounts($employee),
            'payments'     => $this->history($employee),
        ]]);
    }

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
            'bank_name'         => ['required', 'string', 'max:120', 'regex:/^[A-Za-z ]+$/'],
            'utr_cheque_number' => ['required', 'string', 'regex:/^[0-9]{1,12}$/'],
            'payment_date'      => ['required', 'date', 'before_or_equal:' . Carbon::now(self::DISPLAY_TZ)->toDateString()],
            'employee_note'     => ['nullable', 'string', 'max:500'],
            'attachment'        => ['required', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:5120'],
        ], [
            'attachment.required' => 'Upload a screenshot or receipt of the payment.',
            'payment_date.before_or_equal' => 'Payment Date cannot be a future date. Please select today or a previous date.',
            'bank_name.regex'         => 'Bank Name can contain letters and spaces only.',
            'utr_cheque_number.regex' => 'UTR / Cheque Number must be digits only, up to 12.',
        ]);

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

    public function record(Request $request, $employee)
    {
        $user = $request->user();
        abort_if(!$user, 401);
        abort_if(!$this->hasExitAccess($user, 'can_edit'), 403,
            'You need edit access to Exit Management to record a payment on an employee\'s behalf.');

        $employee = $this->scopedEmployee($request, $employee);
        $exit     = $this->activeExit($employee);
        $due      = $this->amountDue($employee, $exit);

        $data = $request->validate([
            'amount'            => ['required', 'numeric', 'min:1', 'max:99999999.99'],
            'payment_mode'      => ['required', 'string', 'max:40'],
            'bank_name'         => ['required', 'string', 'max:120', 'regex:/^[A-Za-z ]+$/'],
            'utr_cheque_number' => ['required', 'string', 'regex:/^[0-9]{1,12}$/'],
            'payment_date'      => ['required', 'date', 'before_or_equal:' . Carbon::now(self::DISPLAY_TZ)->toDateString()],
            'remarks'           => ['nullable', 'string', 'max:500'],
            'verdict'           => ['required', 'in:Approved,Rejected'],
        ], [
            'payment_date.before_or_equal' => 'Payment Date cannot be a future date. Please select today or a previous date.',
            'bank_name.regex'         => 'Bank Name can contain letters and spaces only.',
            'utr_cheque_number.regex' => 'UTR / Cheque Number must be digits only, up to 12.',
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

    private function decide(Request $request, int $id, string $verdict)
    {
        $user = $request->user();
        abort_if(!$user, 401);
        abort_if(!$this->hasExitAccess($user, 'can_edit'), 403,
            'You need edit access to Exit Management to verify a notice-period payment.');

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

    private function amountDue(Employee $employee, ?EmployeeExit $exit): array
    {
        $blank = ['applicable' => false, 'amount' => 0.0, 'breakdown' => null];
        if (!$exit || (string) $exit->exit_type !== 'Resignation without notice period') {
            return $blank;
        }
        if (!\App\Support\ProbationGuard::noticePeriodApplies($employee, $exit->notice_date)) {
            return $blank;
        }

        $stored   = (float) ($exit->notice_settlement_amount ?? 0);

        $settled  = in_array((string) ($exit->notice_settlement_status ?? 'NA'), ['Settled', 'Rejected'], true);
        $required = $settled
            ? (int) ($exit->notice_days_required ?? $this->noticeDays($employee))
            : $this->noticeDays($employee);
        $served   = $settled ? (int) ($exit->notice_days_served ?? 0) : 0;
        if (!$served && $exit->notice_date && $exit->last_working_day) {
            $diff = Carbon::parse($exit->notice_date)
                ->diffInDays(Carbon::parse($exit->last_working_day), false);
            $served = $diff < 0 ? 0 : max(0, min($required, $diff + 1));
        }
        $unserved = $settled
            ? (int) ($exit->notice_days_unserved ?? max(0, $required - $served))
            : max(0, $required - $served);

        $perDay = $settled ? (float) ($exit->notice_per_day_rate ?? 0) : 0.0;
        if ($perDay <= 0) {
            $basic = self::monthlyBasic($employee);
            $days  = $exit->last_working_day
                ? (int) Carbon::parse($exit->last_working_day)->daysInMonth
                : 30;
            $perDay = $basic > 0 && $days > 0 ? round($basic / $days, 2) : 0.0;
        }

        $amount = ($settled && $stored > 0) ? $stored : round($unserved * $perDay, 2);
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

    private function noticeDays(Employee $employee): int
    {
        $n = $employee->notice_period_days;
        if ($n !== null && $n !== '' && is_numeric($n)) {
            return (int) $n;
        }
        return preg_match('/(\d+)/', (string) $employee->notice_period, $m) ? (int) $m[1] : 0;
    }

    public static function monthlyBasic(Employee $employee): float
    {
        $annual = (float) ($employee->annual_salary ?? 0);
        if ($annual <= 0) {
            return 0.0;
        }
        return round(($annual / 12) * 0.5, 2);
    }

    private function outstanding(Employee $employee, float $due): float
    {
        $paid = (float) ExitNoticePayment::where('employee_id', $employee->id)
            ->where('status', 'Approved')->sum('amount');
        return round(max(0, $due - $paid), 2);
    }

    private function companyAccounts(Employee $employee): array
    {
        if (!Schema::hasTable('master_bank_accounts')) {
            return [];
        }
        return DB::table('master_bank_accounts')
            ->whereRaw("LOWER(COALESCE(status,'active')) = ?", ['active'])
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

    private function activeExit(Employee $employee): ?EmployeeExit
    {
        return EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->orderByDesc('id')
            ->first();
    }

    private function scopedEmployee(Request $request, $employeeId): Employee
    {
        $user = $request->user();
        abort_if(!$user, 401);

        $employee = Employee::withTrashed()->findOrFail($employeeId);
        if (!$user->isSuperAdmin() && $user->client_id && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Employee belongs to a different organization.');
        }
        $isSelf  = (int) ($employee->user_id ?? 0) === (int) $user->id;
        abort_if(!$isSelf && !$this->hasExitAccess($user, 'can_view'), 403,
            'You can only manage your own notice-period payment.');

        return $employee;
    }

    private function hasExitAccess($user, string $flag): bool
    {
        if (!$user) return false;
        if ($user->isSuperAdmin()) return true;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;

        $moduleId = Module::where('slug', 'hr.exit')->value('id');
        if (!$moduleId) return false;

        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($flag, true)
            ->exists();
    }
}
