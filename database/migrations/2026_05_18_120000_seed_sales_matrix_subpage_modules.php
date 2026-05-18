<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Adds 7 new Sales Matrix leaf modules to surface the centerpiece prototype
 * pages as their own sidebar entries:
 *
 *   Sales Insights & Productivity
 *     + Diagnosis
 *     + Resolution Center
 *     + Performance
 *
 *   Sales Matrix Operations
 *     + Lead Distribution
 *     + Lead Detail
 *     + Enquiries
 *     + Leads Details
 *
 * Mirrors the seeding pattern in 2026_05_16_000001_seed_sales_matrix_modules:
 * idempotent, no permission backfill (cascade super_admin → client_admin →
 * branch_user → employee stays explicit). sort_order continues after the
 * existing leaves in each category.
 */
return new class extends Migration
{
    public function up(): void
    {
        $catIds = [
            'sales.insights'   => DB::table('modules')->where('slug', 'sales.insights')->value('id'),
            'sales.operations' => DB::table('modules')->where('slug', 'sales.operations')->value('id'),
        ];

        // Bail if the parent rows aren't present — the 05_16 migration must
        // have run first.
        if (!$catIds['sales.insights'] || !$catIds['sales.operations']) {
            return;
        }

        $leaves = [
            'sales.insights' => [
                ['slug' => 'sales.diagnosis',         'name' => 'Diagnosis',         'icon' => 'Stethoscope', 'description' => 'Diagnose sales pipeline issues by branch & rep'],
                ['slug' => 'sales.resolution_center', 'name' => 'Resolution Center', 'icon' => 'Wrench',      'description' => 'Track and resolve flagged sales blockers'],
                ['slug' => 'sales.performance',       'name' => 'Performance',       'icon' => 'TrendingUp',  'description' => 'Overview, targets, leaderboard & activity'],
            ],
            'sales.operations' => [
                ['slug' => 'sales.lead_distribution', 'name' => 'Lead Distribution', 'icon' => 'Share2',      'description' => 'Distribute and reassign opportunity leads'],
                ['slug' => 'sales.lead_detail',       'name' => 'Lead Detail',       'icon' => 'FileSearch',  'description' => 'Full opportunity detail view'],
                ['slug' => 'sales.enquiries',         'name' => 'Enquiries',         'icon' => 'Mail',        'description' => 'Inbound enquiries log & triage'],
                ['slug' => 'sales.leads_details',     'name' => 'Leads Details',     'icon' => 'ListChecks',  'description' => 'Per-salesperson leads drill-down'],
            ],
        ];

        foreach ($leaves as $catSlug => $items) {
            // sort_order continues after the existing leaves in the category.
            $existingCount = DB::table('modules')
                ->where('parent_id', $catIds[$catSlug])
                ->count();
            foreach ($items as $i => $item) {
                if (DB::table('modules')->where('slug', $item['slug'])->exists()) continue;
                DB::table('modules')->insert([
                    'parent_id'    => $catIds[$catSlug],
                    'name'         => $item['name'],
                    'slug'         => $item['slug'],
                    'icon'         => $item['icon'],
                    'description'  => $item['description'],
                    'route_name'   => null,
                    'route_prefix' => null,
                    'sort_order'   => $existingCount + $i + 1,
                    'is_active'    => true,
                    'is_default'   => false,
                    'created_at'   => now(),
                    'updated_at'   => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        $slugs = [
            'sales.diagnosis', 'sales.resolution_center', 'sales.performance',
            'sales.lead_distribution', 'sales.lead_detail', 'sales.enquiries', 'sales.leads_details',
        ];
        $ids = DB::table('modules')->whereIn('slug', $slugs)->pluck('id');
        if ($ids->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $ids)->delete();
            DB::table('modules')->whereIn('id', $ids)->delete();
        }
    }
};
