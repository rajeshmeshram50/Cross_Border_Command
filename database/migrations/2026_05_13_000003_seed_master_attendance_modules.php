<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Adds the new "Attendance Master Management" category under the top-level
 * Master module, plus its two leaf masters: Leave Type Master and Leave Plan
 * Master. Mirrors the pattern in 2026_05_04_000002_seed_expense_category_module.php
 * so branch_users that already have full master permissions automatically get
 * a permission row for the new leaves (copied from a peer master).
 */
return new class extends Migration
{
    public function up(): void
    {
        $masterId = DB::table('modules')->where('slug', 'master')->value('id');
        if (!$masterId) return;

        // 1) Category — Attendance Master Management
        $catSlug = 'master.attendance';
        $catId   = DB::table('modules')->where('slug', $catSlug)->value('id');
        if (!$catId) {
            $catId = DB::table('modules')->insertGetId([
                'parent_id'    => $masterId,
                'name'         => 'Attendance Master Management',
                'slug'         => $catSlug,
                'icon'         => 'CalendarCheck',
                'description'  => 'Branch attendance configuration: leave types & leave plans',
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => 99,
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
        }

        // 2) Leaves — Leave Type Master + Leave Plan Master
        $leaves = [
            [
                'slug' => 'master.leave_type',
                'name' => 'Leave Type Master',
                'icon' => 'CalendarOff',
                'desc' => 'Define leave categories (Regular, Incident Based, Unpaid) with short codes',
            ],
            [
                'slug' => 'master.leave_plan',
                'name' => 'Leave Plan Master',
                'icon' => 'CalendarRange',
                'desc' => 'Configure leave plans with calendar year & start-month rules',
            ],
        ];

        $leafIds = [];
        foreach ($leaves as $i => $l) {
            $existing = DB::table('modules')->where('slug', $l['slug'])->value('id');
            $id = $existing ?: DB::table('modules')->insertGetId([
                'parent_id'    => $catId,
                'name'         => $l['name'],
                'slug'         => $l['slug'],
                'icon'         => $l['icon'],
                'description'  => $l['desc'],
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => $i + 1,
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
            $leafIds[] = $id;
        }

        // 3) Copy permission rows from a peer master so existing users who
        //    already had blanket "all masters" access don't lose visibility.
        //    Uses expense_category as the donor (also branch-scoped, tenant
        //    isolated, fresh enough that admins have explicit rows for it).
        $donorId = DB::table('modules')->where('slug', 'master.expense_category')->value('id');
        if (!$donorId) return;

        $donorRows = DB::table('permissions')->where('module_id', $donorId)->get();
        if ($donorRows->isEmpty()) return;

        $now = now();
        foreach ($leafIds as $moduleId) {
            $existingUserIds = DB::table('permissions')
                ->where('module_id', $moduleId)
                ->pluck('user_id')
                ->all();
            $skip = array_flip($existingUserIds);

            $insert = [];
            foreach ($donorRows as $r) {
                if (isset($skip[$r->user_id])) continue;
                $insert[] = [
                    'user_id'     => $r->user_id,
                    'client_id'   => $r->client_id,
                    'branch_id'   => $r->branch_id,
                    'role'        => $r->role,
                    'module_id'   => $moduleId,
                    'can_view'    => $r->can_view,
                    'can_add'     => $r->can_add,
                    'can_edit'    => $r->can_edit,
                    'can_delete'  => $r->can_delete,
                    'can_export'  => $r->can_export,
                    'can_import'  => $r->can_import,
                    'can_approve' => $r->can_approve,
                    'granted_by'  => $r->granted_by,
                    'created_at'  => $now,
                    'updated_at'  => $now,
                ];
            }
            foreach (array_chunk($insert, 500) as $chunk) {
                DB::table('permissions')->insert($chunk);
            }
        }
    }

    public function down(): void
    {
        foreach (['master.leave_type', 'master.leave_plan'] as $slug) {
            $id = DB::table('modules')->where('slug', $slug)->value('id');
            if ($id) {
                DB::table('permissions')->where('module_id', $id)->delete();
                DB::table('modules')->where('id', $id)->delete();
            }
        }
        $catId = DB::table('modules')->where('slug', 'master.attendance')->value('id');
        if ($catId) {
            DB::table('modules')->where('id', $catId)->delete();
        }
    }
};
