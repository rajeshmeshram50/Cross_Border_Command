<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class EmployeeSalarySeeder extends Seeder
{
    private int $clientId = 1;
    private int $branchId = 3;

    public function run(): void
    {
        $emps = DB::table('employees')
            ->where('client_id', $this->clientId)
            ->where('branch_id', $this->branchId)
            ->where('status', 'Active')
            ->where('onboarding_stage_completed', '>=', 6)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get();

        if ($emps->isEmpty()) {
            $this->command->warn('No onboarded employees for client 1 / branch 3.');
            return;
        }

        $bands = [
            6 => [5000,  0],
            5 => [50000, 2000],
            4 => [65000, 2000],
            3 => [80000, 2000],
            2 => [92000, 1500],
        ];
        $defaultBand = [55000, 2000];

        $structs = 0; $banks = 0;
        foreach ($emps as $e) {
            [$base, $spread] = $bands[$e->designation_id] ?? $defaultBand;
            $gross = $spread > 0 ? $base + (($e->id % 6) * $spread) : $base;
            $gross = (float) min($gross, 100000);

            $basic   = round($gross * 0.50, 2);
            $hra     = round($gross * 0.20, 2);
            $special = round($gross - $basic - $hra, 2);

            $earnings = [
                ['code' => 'basic',   'label' => 'Basic Salary',          'amount' => $basic],
                ['code' => 'hra',     'label' => 'House Rent Allowance',  'amount' => $hra],
                ['code' => 'special', 'label' => 'Special Allowance',     'amount' => $special],
            ];
            $deductions = [
                ['code' => 'pt', 'label' => 'Professional Tax', 'amount' => 200],
            ];

            DB::table('salary_structures')->where('employee_id', $e->id)->delete();
            DB::table('salary_structures')->insert([
                'client_id'       => $this->clientId,
                'branch_id'       => $this->branchId,
                'employee_id'     => $e->id,
                'version'         => 1,
                'effective_from'  => '2026-01-01',
                'status'          => 'active',
                'earnings'        => json_encode($earnings),
                'deductions'      => json_encode($deductions),
                'monthly_gross'   => $gross,
                'monthly_ctc'     => $gross,
                'pf_applicable'   => true,
                'esi_applicable'  => false,
                'pt_applicable'   => true,
                'approval_status' => 'approved',
                'approved_by'     => 4,
                'approved_at'     => now(),
                'created_by'      => 4,
                'created_at'      => now(),
                'updated_at'      => now(),
            ]);
            $structs++;

            $holder = trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: ($e->emp_code ?? 'Employee');
            DB::table('employees')->where('id', $e->id)->update([
                'pf_eligible'          => true,
                'pf_deduction'         => 'Yes',
                'work_type'            => 'Full Time',
                'esi_applicable'       => 'No',
                'annual_salary'        => round($gross * 12, 2),
                'salary_frequency'     => 'monthly',
                'salary_effective_from'=> '2026-01-01',
                'salary_payment_mode'  => 'bank',
                'bank_name'            => 'HDFC Bank',
                'bank_account_number'  => '5010' . str_pad((string) $e->id, 10, '0', STR_PAD_LEFT),
                'ifsc_code'            => 'HDFC0001234',
                'account_holder_name'  => $holder,
                'bank_branch'          => 'Baner, Pune',
                'bank_account_type'    => 'Savings',
                'updated_at'           => now(),
            ]);
            $banks++;
        }

        $this->command->info("Seeded salary structures for {$structs} employees (client 1 / branch 3):");
        $this->command->info("  · PF ON (12% of basic), Professional Tax ₹200 each, bank details filled (mode=bank).");
        $this->command->info("  · Interns ₹5,000 · staff ₹50k–100k by designation, varied per person.");
    }
}
