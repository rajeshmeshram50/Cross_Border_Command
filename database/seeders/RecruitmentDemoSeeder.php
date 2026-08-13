<?php

namespace Database\Seeders;

use App\Models\Employee;
use App\Models\Masters\Departments;
use App\Models\Masters\Designations;
use App\Models\Masters\Roles;
use App\Models\Recruitment;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;

/**
 * Demo recruitments for QA — 5 per tab (In Progress / Completed / Cancelled /
 * Expired) for client_id = 1, branch_id = 3. Idempotent-ish: it appends fresh
 * REC-### codes after whatever already exists, so re-running just adds more.
 *
 *   php artisan db:seed --class=RecruitmentDemoSeeder
 */
class RecruitmentDemoSeeder extends Seeder
{
    public function run(): void
    {
        $clientId = 1;
        $branchId = 3;

        $deptIds  = Departments::pluck('id')->all();
        $desigIds = Designations::pluck('id')->all();
        $roleIds  = Roles::pluck('id')->all();
        $empIds   = Employee::where('client_id', $clientId)->where('branch_id', $branchId)->pluck('id')->all();
        $creator  = User::where('client_id', $clientId)->where('user_type', 'branch_user')->value('id')
            ?? User::where('client_id', $clientId)->value('id');

        if (empty($deptIds) || empty($desigIds) || empty($roleIds) || empty($empIds)) {
            $this->command?->warn('Missing master/employee data for client 1 / branch 3 — nothing seeded.');
            return;
        }

        // Next REC-### for this tenant.
        $maxSeq = 0;
        foreach (Recruitment::withTrashed()->where('client_id', $clientId)->where('branch_id', $branchId)->pluck('code') as $c) {
            if (preg_match('/^REC-(\d+)$/i', (string) $c, $m)) {
                $maxSeq = max($maxSeq, (int) $m[1]);
            }
        }

        $emp   = ['Full Time', 'Part Time', 'Contract', 'Internship'];
        $modes = ['On-site', 'Remote', 'Hybrid', 'Flexible'];
        $prio  = ['Critical', 'High', 'Medium', 'Low'];
        $exp   = ['0-1 years', '2-4 years', '3-5 years', '5+ years', '6-8 years'];
        $ctc   = ['₹4-6 LPA', '₹8-12 LPA', '₹12-18 LPA', '₹18-25 LPA', '₹25-35 LPA'];

        $titles = [
            'In Progress' => ['Senior Backend Engineer', 'HR Business Partner', 'Accounts Executive', 'Sales Development Rep', 'DevOps Engineer'],
            'Completed'   => ['Frontend Engineer', 'Payroll Specialist', 'Financial Analyst', 'Key Account Manager', 'QA Engineer'],
            'Cancelled'   => ['Data Analyst', 'Recruitment Coordinator', 'Audit Associate', 'Regional Sales Lead', 'Mobile Developer'],
            'Expired'     => ['UX Designer', 'L&D Specialist', 'Treasury Analyst', 'Inside Sales Executive', 'Site Reliability Engineer'],
        ];
        $cancelReasons = ['Budget freeze', 'Position on hold', 'Filled internally', 'Reorg — role merged', 'Hiring paused'];

        $today = Carbon::today();
        $seq   = $maxSeq;
        $made  = 0;

        foreach ($titles as $status => $jobs) {
            foreach ($jobs as $i => $job) {
                $seq++;
                // Dates per status. Expired needs a PAST deadline; In Progress a
                // future one; the rest are illustrative.
                [$start, $deadline] = match ($status) {
                    'In Progress' => [$today->copy()->subDays(5),  $today->copy()->addDays(30)],
                    'Completed'   => [$today->copy()->subDays(60), $today->copy()->subDays(10)],
                    'Cancelled'   => [$today->copy()->subDays(40), $today->copy()->addDays(15)],
                    'Expired'     => [$today->copy()->subDays(45), $today->copy()->subDays(10)],
                };

                Recruitment::create([
                    'client_id'         => $clientId,
                    'branch_id'         => $branchId,
                    'created_by'        => $creator,
                    'code'              => 'REC-' . str_pad((string) $seq, 3, '0', STR_PAD_LEFT),
                    'job_title'         => $job,
                    'department_id'     => $deptIds[$i % count($deptIds)],
                    'designation_id'    => $desigIds[$i % count($desigIds)],
                    'primary_role_id'   => $roleIds[$i % count($roleIds)],
                    'employment_type'   => $emp[$i % count($emp)],
                    'openings'          => ($i % 4) + 1,
                    'experience'        => $exp[$i % count($exp)],
                    'work_mode'         => $modes[$i % count($modes)],
                    'ctc_range'         => $ctc[$i % count($ctc)],
                    'priority'          => $prio[$i % count($prio)],
                    'hiring_manager_id' => $empIds[$i % count($empIds)],
                    'assigned_hr_id'    => $empIds[($i + 1) % count($empIds)],
                    'start_date'        => $start,
                    'deadline'          => $deadline,
                    'job_description'   => "We are hiring a {$job}. This is a demo recruitment record seeded for QA.",
                    'requirements'      => "Relevant experience for a {$job} role.",
                    'post_on_portal'    => true,
                    'notify_team_leads' => false,
                    'enable_referral_bonus' => $i % 2 === 0,
                    'status'            => $status,
                    'cancel_reason'     => $status === 'Cancelled' ? $cancelReasons[$i % count($cancelReasons)] : null,
                    'cancel_notes'      => $status === 'Cancelled' ? 'Cancelled during QA seeding.' : null,
                ]);
                $made++;
            }
        }

        $this->command?->info("Seeded {$made} recruitments (5 per tab) for client {$clientId} / branch {$branchId}.");
    }
}
