<?php

use App\Support\ModuleDependencies;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Repair permissions granted BEFORE the HRMS dependency matrix existed.
 *
 * PermissionController now expands every save with the modules a grant depends
 * on, but rows already in the table were written without that rule — those
 * users keep the half-broken screens (empty Department/Designation dropdowns,
 * 403s on lookup calls) until somebody happens to re-save their permissions.
 * This walks the existing grants once and adds the missing can_view rows.
 *
 * Only can_view is added, and only for modules the user doesn't already have —
 * no existing row is modified and no action flag is ever granted. Mirrors
 * 2026_06_04_000100_backfill_can_view_for_action_permissions.php.
 */
return new class extends Migration
{
    public function up(): void
    {
        $slugById = DB::table('modules')->pluck('slug', 'id')->all();
        $idBySlug = DB::table('modules')->pluck('id', 'slug')->all();
        $flags = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

        // ── per-user permissions ────────────────────────────────────────────
        $rows = DB::table('permissions')->get();

        $active = [];   // user_id => [slug, …] (any flag set)
        $viewed = [];   // user_id => [slug => true]
        $meta   = [];   // user_id => tenant columns to copy onto new rows
        foreach ($rows as $r) {
            $slug = $slugById[$r->module_id] ?? null;
            if (!$slug) continue;

            $meta[$r->user_id] ??= [
                'client_id' => $r->client_id,
                'branch_id' => $r->branch_id,
                'role' => $r->role,
                'granted_by' => $r->granted_by,
            ];

            foreach ($flags as $f) {
                if ($r->$f) { $active[$r->user_id][] = $slug; break; }
            }
            if ($r->can_view) $viewed[$r->user_id][$slug] = true;
        }

        $inserts = [];
        foreach ($active as $userId => $slugs) {
            foreach (ModuleDependencies::resolve($slugs) as $dep) {
                $depId = $idBySlug[$dep] ?? null;
                if (!$depId || isset($viewed[$userId][$dep])) continue;

                $inserts[] = array_merge($meta[$userId], [
                    'user_id' => $userId,
                    'module_id' => $depId,
                    'can_view' => true,
                    'can_add' => false, 'can_edit' => false, 'can_delete' => false,
                    'can_export' => false, 'can_import' => false, 'can_approve' => false,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
        foreach (array_chunk($inserts, 500) as $chunk) {
            DB::table('permissions')->insert($chunk);
        }

        // ── department permissions (these propagate to HODs) ────────────────
        if (!DB::getSchemaBuilder()->hasTable('department_permissions')) return;

        $deptRows = DB::table('department_permissions')->get();
        $deptActive = $deptViewed = $deptMeta = [];
        foreach ($deptRows as $r) {
            $slug = $slugById[$r->module_id] ?? null;
            if (!$slug) continue;
            $key = $r->client_id . ':' . $r->department_id;
            $deptMeta[$key] ??= ['client_id' => $r->client_id, 'department_id' => $r->department_id, 'granted_by' => $r->granted_by];
            foreach ($flags as $f) {
                if ($r->$f) { $deptActive[$key][] = $slug; break; }
            }
            if ($r->can_view) $deptViewed[$key][$slug] = true;
        }

        $deptInserts = [];
        foreach ($deptActive as $key => $slugs) {
            foreach (ModuleDependencies::resolve($slugs) as $dep) {
                $depId = $idBySlug[$dep] ?? null;
                if (!$depId || isset($deptViewed[$key][$dep])) continue;

                $deptInserts[] = array_merge($deptMeta[$key], [
                    'module_id' => $depId,
                    'can_view' => true,
                    'can_add' => false, 'can_edit' => false, 'can_delete' => false,
                    'can_export' => false, 'can_import' => false, 'can_approve' => false,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
        foreach (array_chunk($deptInserts, 500) as $chunk) {
            DB::table('department_permissions')->insert($chunk);
        }
    }

    public function down(): void
    {
        // Not reversible: the added rows are indistinguishable from grants an
        // admin made by hand, and removing them would revoke real access.
    }
};
