<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\PayrollAdjustment;
use App\Services\PayrollService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Overtime / Bonus / Incentive / one-off deduction adjustments (Rule 4 + 10).
 * Only APPROVED rows are picked up by the payroll engine. Approving / rejecting
 * a row recomputes the employee's non-locked payslips so the change flows into
 * payroll immediately.
 *
 *   GET    /payroll-adjustments?employee_id=&month=&year=
 *   POST   /payroll-adjustments
 *   POST   /payroll-adjustments/{id}/approve
 *   POST   /payroll-adjustments/{id}/reject
 *   DELETE /payroll-adjustments/{id}
 */
class PayrollAdjustmentController extends Controller
{
    public function __construct(private PayrollService $payroll) {}

    public function index(Request $request)
    {
        $user = $request->user();
        $q = PayrollAdjustment::query()->orderByDesc('id');
        if ($user && $user->client_id) $q->where('client_id', $user->client_id);
        if ($b = $request->integer('branch_id')) $q->where('branch_id', $b);
        if ($e = $request->integer('employee_id')) $q->where('employee_id', $e);
        if ($m = $request->integer('month')) $q->where('month', $m);
        if ($y = $request->integer('year')) $q->where('year', $y);
        if ($s = $request->query('status')) $q->where('status', $s);

        return response()->json(['data' => $q->get()->map(fn ($a) => $this->serialize($a))]);
    }

    public function store(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to manage payroll adjustments.'], 403);
        }
        $data = $request->validate([
            'employee_id' => ['required', 'integer'],
            'month'       => ['required', 'integer', 'between:1,12'],
            'year'        => ['required', 'integer', 'between:2000,2100'],
            'type'        => ['required', Rule::in(PayrollAdjustment::TYPES)],
            'label'       => ['nullable', 'string', 'max:120'],
            'amount'      => ['required', 'numeric', 'min:0', 'max:99999999.99'],
            'hours'       => ['nullable', 'numeric', 'min:0', 'max:999999.99'],
            'rate'        => ['nullable', 'numeric', 'min:0', 'max:99999999.99'],
            'reason'      => ['nullable', 'string', 'max:500'],
            'auto_approve' => ['nullable', 'boolean'],
        ]);

        $user = $request->user();
        $employee = Employee::find($data['employee_id']);
        abort_unless($employee, 422, 'Employee not found.');
        if ($user && $user->client_id && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Employee belongs to another tenant.');
        }

        // Overtime: derive amount from hours × rate when both are given.
        $amount = (float) $data['amount'];
        if ($data['type'] === 'overtime' && !empty($data['hours']) && !empty($data['rate'])) {
            $amount = round((float) $data['hours'] * (float) $data['rate'], 2);
        }

        $approve = (bool) ($data['auto_approve'] ?? false);
        $adj = PayrollAdjustment::create([
            'client_id'   => $employee->client_id,
            'branch_id'   => $employee->branch_id,
            'employee_id' => $employee->id,
            'month'       => $data['month'],
            'year'        => $data['year'],
            'type'        => $data['type'],
            'label'       => $data['label'] ?? ucfirst($data['type']),
            'amount'      => $amount,
            'hours'       => $data['hours'] ?? null,
            'rate'        => $data['rate'] ?? null,
            'status'      => $approve ? 'approved' : 'pending',
            'approved_by' => $approve ? $user?->id : null,
            'approved_at' => $approve ? now() : null,
            'reason'      => $data['reason'] ?? null,
            'created_by'  => $user?->id,
        ]);

        if ($approve) {
            $this->payroll->recomputeEmployeePayslips($employee->id);
        }

        return response()->json([
            'message' => 'Adjustment ' . ($approve ? 'added & approved' : 'recorded (pending approval)') . '.',
            'data'    => $this->serialize($adj),
        ], 201);
    }

    public function approve(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'rejected');
    }

    private function setStatus(Request $request, int $id, string $status)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to approve payroll adjustments.'], 403);
        }
        $adj = $this->findScoped($request, $id);
        abort_unless($adj, 404, 'Adjustment not found.');

        $adj->update([
            'status'      => $status,
            'approved_by' => $request->user()?->id,
            'approved_at' => now(),
        ]);
        // Approving or rejecting changes payroll inputs — propagate to drafts.
        $this->payroll->recomputeEmployeePayslips($adj->employee_id);

        return response()->json(['message' => "Adjustment {$status}.", 'data' => $this->serialize($adj)]);
    }

    public function destroy(Request $request, int $id)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to manage payroll adjustments.'], 403);
        }
        $adj = $this->findScoped($request, $id);
        abort_unless($adj, 404, 'Adjustment not found.');
        $empId = $adj->employee_id;
        $wasApproved = $adj->status === 'approved';
        $adj->delete();
        if ($wasApproved) {
            $this->payroll->recomputeEmployeePayslips($empId);
        }
        return response()->json(['message' => 'Adjustment removed.']);
    }

    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;
        $perm = $user->permissions['hr.payroll'] ?? null;
        return is_array($perm) && (($perm['can_edit'] ?? false) || ($perm['can_approve'] ?? false));
    }

    private function findScoped(Request $request, int $id): ?PayrollAdjustment
    {
        $user = $request->user();
        $adj = PayrollAdjustment::find($id);
        if (!$adj) return null;
        if ($user && $user->client_id && $adj->client_id && (int) $adj->client_id !== (int) $user->client_id) {
            return null;
        }
        return $adj;
    }

    private function serialize(PayrollAdjustment $a): array
    {
        return [
            'id'          => $a->id,
            'employee_id' => $a->employee_id,
            'month'       => $a->month,
            'year'        => $a->year,
            'type'        => $a->type,
            'label'       => $a->label,
            'amount'      => (float) $a->amount,
            'hours'       => $a->hours !== null ? (float) $a->hours : null,
            'rate'        => $a->rate !== null ? (float) $a->rate : null,
            'status'      => $a->status,
            'reason'      => $a->reason,
            'created_at'  => optional($a->created_at)->toIso8601String(),
        ];
    }
}
