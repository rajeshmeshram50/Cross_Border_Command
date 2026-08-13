<?php

namespace Database\Seeders;

use App\Models\Candidate;
use App\Models\Recruitment;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Demo candidates for a recruitment's Candidate Management screen (QA).
 * Seeds a spread across the pipeline so every tab + KPI populates:
 *   Final Round Selected = 'Final Interview', Selected = 'Selected'/'Offered',
 *   Rejected = 'Rejected', plus Applied / Shortlisted / In Interview / On Hold.
 *
 *   php artisan db:seed --class=CandidateDemoSeeder            (defaults to REC id 9)
 *   RECRUITMENT_ID=12 php artisan db:seed --class=CandidateDemoSeeder
 */
class CandidateDemoSeeder extends Seeder
{
    public function run(): void
    {
        $recruitmentId = (int) (env('RECRUITMENT_ID') ?: 9);

        $rec = Recruitment::withTrashed()->find($recruitmentId);
        if (!$rec) {
            $this->command?->warn("Recruitment #{$recruitmentId} not found — nothing seeded.");
            return;
        }

        $clientId = $rec->client_id;
        $branchId = $rec->branch_id;
        $creator  = User::where('client_id', $clientId)->where('user_type', 'branch_user')->value('id')
            ?? User::where('client_id', $clientId)->value('id');

        // How many per status (drives the tabs + KPI cards).
        $plan = [
            'Applied'          => 3,
            'Shortlisted'      => 2,
            'In Interview'     => 4,
            'Final Interview'  => 5,   // → "Final Round Selected" tab
            'Selected'         => 3,   // ┐ "Selected Candidates" tab (3 + 1)
            'Offered'          => 1,   // ┘ kept within the 4 openings
            'Rejected'         => 5,   // → "Rejected Candidates" tab
            'On Hold'          => 1,
        ];

        $firstNames = ['Aarav', 'Isha', 'Rohan', 'Priya', 'Karan', 'Sneha', 'Aditya', 'Neha', 'Vikram', 'Ananya',
                       'Rahul', 'Pooja', 'Siddharth', 'Meera', 'Arjun', 'Kavya', 'Nikhil', 'Divya', 'Manish', 'Riya',
                       'Sameer', 'Tanvi', 'Yash', 'Shreya'];
        $lastNames  = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Patel', 'Reddy', 'Gupta', 'Menon', 'Joshi', 'Kulkarni',
                       'Desai', 'Malhotra', 'Rao', 'Chopra', 'Bose', 'Kapoor', 'Sinha', 'Pillai', 'Bhat', 'Mehta',
                       'Agarwal', 'Nanda', 'Saxena', 'Roy'];
        $sources    = ['LinkedIn', 'Naukri', 'Indeed', 'Referral', 'Company Website', 'Walk-in', 'Recruitment Agency', 'Internal', 'Other'];
        $notices    = ['Immediate', '15 Days', '30 Days', '45 Days', '60 Days', '90 Days'];
        $quals      = ['MBA', 'B.Tech', 'B.Com', 'MCA', 'M.Com', 'BBA', 'B.Sc', 'PGDM'];
        $rejReasons = ['Salary expectations too high', 'Skills mismatch', 'Failed technical round',
                       'Long notice period', 'Position filled', 'Culture fit concern'];

        $i = 0; $made = 0;
        foreach ($plan as $status => $count) {
            for ($k = 0; $k < $count; $k++, $i++) {
                $fn   = $firstNames[$i % count($firstNames)];
                $ln   = $lastNames[$i % count($lastNames)];
                $name = "{$fn} {$ln}";
                $slug = strtolower($fn . '.' . $ln);
                $exp  = round(1 + ($i % 10) + (($i % 2) * 0.5), 2);   // 1.0 – 10.5 yrs
                $cur  = round(4 + ($i % 12), 2);                       // 4 – 15 LPA
                $exp2 = round($cur + 2 + ($i % 5), 2);                 // expected > current

                Candidate::create([
                    'client_id'           => $clientId,
                    'branch_id'           => $branchId,
                    'created_by'          => $creator,
                    'recruitment_id'      => $recruitmentId,
                    'name'                => $name,
                    'email'               => "{$slug}.{$i}@mailinator.com",
                    'mobile'              => '9' . str_pad((string) (100000000 + $i * 37), 9, '0', STR_PAD_LEFT),
                    'current_address'     => 'Demo address, India',
                    'qualification'       => $quals[$i % count($quals)],
                    'experience_years'    => $exp,
                    'current_salary_lpa'  => $cur,
                    'expected_salary_lpa' => $exp2,
                    'notice_period'       => $notices[$i % count($notices)],
                    'source'              => $sources[$i % count($sources)],
                    'status'              => $status,
                    'rejection_reason'    => $status === 'Rejected' ? $rejReasons[$i % count($rejReasons)] : null,
                    'status_notes'        => 'Seeded for QA.',
                ]);
                $made++;
            }
        }

        $this->command?->info("Seeded {$made} candidates for recruitment #{$recruitmentId} ({$rec->job_title}).");
    }
}
