<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Salary structures + bank details for the AgroTech branch (client 1 / branch 3)
 * so payroll has something to run on. Designation-driven monthly gross:
 *
 *   Intern / Trainee ............ ₹5,000 (flat)
 *   Employee .................... ₹50k–60k   ┐
 *   Executive ................... ₹65k–75k   │ varied per person so no two
 *   Team Leader ................. ₹80k–90k   │ are identical, all inside the
 *   Head of Department (HOD) .... ₹92k–98k   │ 50k–100k band the brief gave.
 *   (no designation) ............ ₹55k–65k   ┘
 *
 * For every employee: PF kept ON (12% of basic, statutory cap), Professional
 * Tax fixed at ₹200 (a manual 'pt' line the engine honours over the slab), and
 * bank details filled (mode = bank) so payslips aren't held for missing bank.
 *
 * Idempotent: replaces the employee's existing structure(s) with one clean
 * active version. Skips anyone not onboarded (stage < 6).
 * Run:  php artisan db:seed --class=EmployeeSalarySeeder
 */
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

        // designation_id → [base gross, spread] (spread varied by employee id).
        //   2 HOD · 3 Team Leader · 4 Executive · 5 Employee · 6 Intern/Trainee
        $bands = [
            6 => [5000,  0],      // Intern / Trainee — flat 5,000
            5 => [50000, 2000],   // Employee
            4 => [65000, 2000],   // Executive
            3 => [80000, 2000],   // Team Leader
            2 => [92000, 1500],   // Head of Department
        ];
        $defaultBand = [55000, 2000]; // no / unknown designation

        $structs = 0; $banks = 0;
        foreach ($emps as $e) {
            [$base, $spread] = $bands[$e->designation_id] ?? $defaultBand;
            // Vary within the band so people differ but stay ≤ ₹100k.
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
            // ₹200 Professional Tax as a manual line — the engine takes this over
            // the state slab, so every employee lands at exactly ₹200 (full month).
            $deductions = [
                ['code' => 'pt', 'label' => 'Professional Tax', 'amount' => 200],
            ];

            // Replace any existing structure(s) with one clean active version.
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
                'pf_applicable'   => true,   // PF kept ON
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

            // Employee-level flags PF eligibility + take-home routing depend on.
            $holder = trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: ($e->emp_code ?? 'Employee');
            DB::table('employees')->where('id', $e->id)->update([
                'pf_eligible'          => true,
                'pf_deduction'         => 'Yes',
                'work_type'            => 'Full Time',           // isPfEligibleType → true
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
