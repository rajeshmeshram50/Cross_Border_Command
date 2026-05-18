<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Trigger Point master cleanup — adds "Promotion" alongside the existing
 * "Onboarding" and "Exit Management" canonical rows AND consolidates the
 * three names into a single global row each (client_id IS NULL,
 * branch_id IS NULL) so super-admin owns the canonical list and every
 * tenant sees the same names. Prior to this migration we used to seed
 * one row per client which duplicated names across tenants and made the
 * master list feel out of the admin's control.
 *
 * Steps (idempotent):
 *   1. Ensure all three global canonical rows exist.
 *   2. Repoint any HrDocumentTemplate.trigger_point_id that currently
 *      points at a per-client canonical row → the matching global id,
 *      so the templates' lifecycle link survives the cleanup.
 *   3. Delete the per-client canonical rows we seeded earlier
 *      (matched by name + the exact description text we inserted, so
 *      branch-user customisations with the same name are left alone).
 *
 * `down()` is intentionally limited: it only drops the "Promotion" row
 * we added here. Restoring deleted per-client rows would re-introduce
 * the duplication we're cleaning up, so we don't do that.
 */
return new class extends Migration
{
    private array $canonical = [
        ['Onboarding',      'Documents that auto-attach to the new-hire onboarding flow.'],
        ['Exit Management', 'Documents that auto-attach to the employee exit flow.'],
        ['Promotion',       'Documents that auto-attach to the employee promotion flow.'],
    ];

    public function up(): void
    {
        $now = now();

        // 1. Ensure each canonical name has a global row.
        foreach ($this->canonical as [$name, $description]) {
            $exists = DB::table('master_trigger_points')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                ->exists();
            if ($exists) continue;
            DB::table('master_trigger_points')->insert([
                'client_id'   => null,
                'branch_id'   => null,
                'module_name' => $name,
                'description' => $description,
                'status'      => 'Active',
                'created_by'  => null,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }

        // 2. Build a map of "name (lower) -> global id" for the repoint step.
        $globalIds = [];
        foreach ($this->canonical as [$name]) {
            $id = DB::table('master_trigger_points')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                ->value('id');
            if ($id) $globalIds[strtolower($name)] = (int) $id;
        }

        // hr_document_templates may not exist yet on a brand-new install
        // depending on migration order, so guard the schema check.
        if (\Illuminate\Support\Facades\Schema::hasTable('hr_document_templates')) {
            foreach ($this->canonical as [$name, $description]) {
                $targetId = $globalIds[strtolower($name)] ?? null;
                if (!$targetId) continue;

                // Per-client rows we previously seeded — match by name +
                // exact description so user-created rows aren't touched.
                $perClientIds = DB::table('master_trigger_points')
                    ->whereNotNull('client_id')
                    ->whereNull('branch_id')
                    ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                    ->where('description', $description)
                    ->pluck('id')
                    ->all();

                if (!empty($perClientIds)) {
                    DB::table('hr_document_templates')
                        ->whereIn('trigger_point_id', $perClientIds)
                        ->update(['trigger_point_id' => $targetId]);
                }
            }
        }

        // 3. Delete the per-client canonical rows. Description match ensures
        //    branch-user rows that happen to share a name (different desc)
        //    are left alone — those represent intentional customisation.
        DB::table('master_trigger_points')
            ->whereNotNull('client_id')
            ->whereNull('branch_id')
            ->whereIn('description', array_map(fn ($p) => $p[1], $this->canonical))
            ->whereIn(DB::raw('LOWER(module_name)'), array_map(fn ($p) => strtolower($p[0]), $this->canonical))
            ->delete();
    }

    public function down(): void
    {
        // Only drop the row this migration newly added. Restoring deleted
        // per-client rows would re-introduce the duplication we cleaned
        // up, so we deliberately don't unwind step 2/3.
        DB::table('master_trigger_points')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(module_name) = ?', ['promotion'])
            ->where('description', 'Documents that auto-attach to the employee promotion flow.')
            ->delete();
    }
};
