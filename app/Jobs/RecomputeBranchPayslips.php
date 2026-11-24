<?php

namespace App\Jobs;

use App\Models\Employee;
use App\Models\Payslip;
use App\Services\PayrollService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class RecomputeBranchPayslips implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600;
    public int $tries = 2;

    public function __construct(public int $branchId) {}

    public function handle(PayrollService $payroll): void
    {
        $employeeIds = Payslip::query()
            ->whereHas('run', fn($q) => $q->whereIn('status', ['draft', 'generated']))
            ->whereIn('employee_id', Employee::where('branch_id', $this->branchId)->pluck('id'))
            ->distinct()
            ->pluck('employee_id');

        foreach ($employeeIds as $id) {
            try {
                $payroll->recomputeEmployeePayslips((int) $id);
            } catch (\Throwable $e) {
                // One bad employee must not abort the rest of the branch.
                Log::warning("Payslip recompute failed for employee {$id} (branch {$this->branchId}): " . $e->getMessage());
            }
        }
    }
}
