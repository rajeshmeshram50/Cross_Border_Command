<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Realigns the HR module tree to match HR_GROUPS in
 * resources/js/constants.ts (the source of truth for the sidebar/topbar).
 *
 * Before: 6 categories (hr.command, hr.core, hr.operations, hr.time_pay,
 *         hr.documents, hr.ai)
 * After:  4 categories (hr.command, hr.core, hr.time_pay, hr.documents)
 *
 * Re-parented:
 *   hr.recruitment / hr.onboarding / hr.exit  →  hr.core
 *   hr.reports     / hr.ai_master              →  hr.command
 *
 * Pruned (categories): hr.operations, hr.ai
 * Pruned (leaves not in the menu): hr.department, hr.designation,
 *                                  hr.role, hr.kpis
 *
 * Permission rows and plan_module rows for the pruned modules cascade away
 * automatically (both tables have ON DELETE CASCADE on module_id).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::transaction(function () {
            $idBySlug = fn (string $slug) =>
                DB::table('modules')->where('slug', $slug)->value('id');

            // Re-parent leaves that moved between categories.
            $moves = [
                'hr.recruitment' => 'hr.core',
                'hr.onboarding'  => 'hr.core',
                'hr.exit'        => 'hr.core',
                'hr.reports'     => 'hr.command',
                'hr.ai_master'   => 'hr.command',
            ];
            foreach ($moves as $leafSlug => $newParentSlug) {
                $newParentId = $idBySlug($newParentSlug);
                if (!$newParentId) continue;
                DB::table('modules')
                    ->where('slug', $leafSlug)
                    ->update(['parent_id' => $newParentId]);
            }

            // Drop obsolete categories & leaves. Cascade on module_id cleans
            // up dependent permissions / plan_modules rows.
            DB::table('modules')->whereIn('slug', [
                'hr.operations',
                'hr.ai',
                'hr.department',
                'hr.designation',
                'hr.role',
                'hr.kpis',
            ])->delete();
        });
    }

    public function down(): void
    {
        // No-op: the legacy categories/leaves are recreated by re-running
        // ModuleSeeder if needed. Reversing this migration deterministically
        // would require recovering soft-state (permissions/plan_modules rows
        // for the dropped slugs) which the cascade has already removed.
    }
};
