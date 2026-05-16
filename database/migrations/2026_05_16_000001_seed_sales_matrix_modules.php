<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the Sales Matrix permission tree into existing installs:
 *
 *   Sales Matrix (top-level)
 *     ├── Sales Insights & Productivity
 *     │     ├── Sales Analytics
 *     │     ├── Productivity Tracker
 *     │     └── Procure to Pay (P2P) Summary
 *     ├── Sales Core (Masters)
 *     │     ├── Customers
 *     │     ├── Consignee
 *     │     └── Lead Acknowledgement Master
 *     └── Sales Matrix Operations
 *           ├── My Workplace
 *           └── Quotation Vs PI History
 *
 * No permission rows are backfilled — the grant flow stays explicit:
 *   super_admin → client_admin → branch_user → employee
 * matching what PermissionController.savePermissions() enforces. Existing
 * users see Sales Matrix in the Permissions page; nobody auto-receives access.
 *
 * Existing Settings / Profile rows are renumbered so the new top-level slots
 * cleanly between HR (9) and Settings (was 10, now 11).
 *
 * Fully idempotent — re-running is a no-op for rows that already exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Renumber existing top-levels to free sort_order = 10 for Sales Matrix.
        //    The Permissions UI sorts the tree by sort_order, so leaving the old
        //    Settings(10)/Profile(11) in place would push Sales Matrix to the end.
        DB::table('modules')->where('slug', 'settings')->whereNull('parent_id')->update(['sort_order' => 11, 'updated_at' => now()]);
        DB::table('modules')->where('slug', 'profile')->whereNull('parent_id')->update(['sort_order' => 12, 'updated_at' => now()]);

        // 2. Top-level "Sales Matrix" module.
        $salesId = DB::table('modules')->where('slug', 'sales')->value('id');
        if (!$salesId) {
            $salesId = DB::table('modules')->insertGetId([
                'parent_id'    => null,
                'name'         => 'Sales Matrix',
                'slug'         => 'sales',
                'icon'         => 'TrendingUp',
                'description'  => 'Sales insights, customer masters & opportunity operations',
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => 10,
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
        }

        // 3. Three grouping categories (level 2).
        $categories = [
            ['slug' => 'sales.insights',   'name' => 'Sales Insights & Productivity', 'icon' => 'BarChart3', 'description' => 'Sales analytics, productivity tracker & P2P summary',  'sort_order' => 1],
            ['slug' => 'sales.core',       'name' => 'Sales Core (Masters)',          'icon' => 'Database',  'description' => 'Customer, consignee & lead acknowledgement masters',    'sort_order' => 2],
            ['slug' => 'sales.operations', 'name' => 'Sales Matrix Operations',       'icon' => 'Activity',  'description' => 'My Workplace & quotation/PI tracking',                  'sort_order' => 3],
        ];

        $catIds = [];
        foreach ($categories as $cat) {
            $existingId = DB::table('modules')->where('slug', $cat['slug'])->value('id');
            $catIds[$cat['slug']] = $existingId ?: DB::table('modules')->insertGetId([
                'parent_id'    => $salesId,
                'name'         => $cat['name'],
                'slug'         => $cat['slug'],
                'icon'         => $cat['icon'],
                'description'  => $cat['description'],
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => $cat['sort_order'],
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
        }

        // 4. Eight leaf modules (level 3) — these are the only rows that can
        //    carry permission flags. The Permissions UI hides parents from
        //    the matrix and the controller skips any payload pointing at a
        //    parent module id.
        $leaves = [
            'sales.insights' => [
                ['slug' => 'sales.analytics',            'name' => 'Sales Analytics',              'icon' => 'BarChart3',      'description' => 'Sales dashboard, diagnosis & resolution center'],
                ['slug' => 'sales.productivity_tracker', 'name' => 'Productivity Tracker',         'icon' => 'ClipboardCheck', 'description' => 'Manage reminders, meetings & to-do activities'],
                ['slug' => 'sales.p2p_summary',          'name' => 'Procure to Pay (P2P) Summary', 'icon' => 'ShoppingBag',    'description' => 'Track opportunity-wise product sourcing summary'],
            ],
            'sales.core' => [
                ['slug' => 'sales.customers',       'name' => 'Customers',                  'icon' => 'UserSquare', 'description' => 'Manage customer master records'],
                ['slug' => 'sales.consignee',       'name' => 'Consignee',                  'icon' => 'Truck',      'description' => 'Manage consignee master records'],
                ['slug' => 'sales.lead_ack_master', 'name' => 'Lead Acknowledgement Master','icon' => 'BadgeCheck', 'description' => 'Manage Lead Acknowledgement reasons'],
            ],
            'sales.operations' => [
                ['slug' => 'sales.workplace',       'name' => 'My Workplace',               'icon' => 'Activity',   'description' => 'Manage active sales opportunities'],
                ['slug' => 'sales.quotation_vs_pi', 'name' => 'Quotation Vs PI History',    'icon' => 'FileText',   'description' => 'Track quotation & PI conversion history'],
            ],
        ];

        foreach ($leaves as $catSlug => $items) {
            foreach ($items as $i => $item) {
                $existingId = DB::table('modules')->where('slug', $item['slug'])->value('id');
                if ($existingId) continue;
                DB::table('modules')->insert([
                    'parent_id'    => $catIds[$catSlug],
                    'name'         => $item['name'],
                    'slug'         => $item['slug'],
                    'icon'         => $item['icon'],
                    'description'  => $item['description'],
                    'route_name'   => null,
                    'route_prefix' => null,
                    'sort_order'   => $i + 1,
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
            'sales.analytics', 'sales.productivity_tracker', 'sales.p2p_summary',
            'sales.customers', 'sales.consignee', 'sales.lead_ack_master',
            'sales.workplace', 'sales.quotation_vs_pi',
            'sales.insights', 'sales.core', 'sales.operations',
            'sales',
        ];

        $ids = DB::table('modules')->whereIn('slug', $slugs)->pluck('id');
        if ($ids->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $ids)->delete();
            DB::table('modules')->whereIn('id', $ids)->delete();
        }

        // Restore Settings / Profile sort_orders.
        DB::table('modules')->where('slug', 'settings')->whereNull('parent_id')->update(['sort_order' => 10, 'updated_at' => now()]);
        DB::table('modules')->where('slug', 'profile')->whereNull('parent_id')->update(['sort_order' => 11, 'updated_at' => now()]);
    }
};
