<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Collapse the duplicate exit trigger point. (#41)
 *
 * The Life Cycle & Signing dropdown offered BOTH "Exit Process" and "Exit
 * Management", which are the same event under two names.
 *
 * How it happened: 2026_05_20_000003_seed_default_trigger_points seeds a row
 * called "Exit Process", and decides whether to seed by looking for that exact
 * module_name. Someone renamed the row to "Exit Management" through the master
 * UI — reasonably, since that is what the HR module is called everywhere else
 * — and the next time the seeding ran it could not find "Exit Process", so it
 * inserted a second row. Name-based idempotency cannot survive the name being
 * editable by the user.
 *
 * "Exit Management" is kept: it matches the module name used across HRMS, and
 * it is the row that already exists on the server. Any template pointing at
 * the "Exit Process" row is repointed first, so nothing is orphaned.
 *
 * On a FRESH database the old seeder creates only "Exit Process"; there is
 * nothing to merge, so this renames it instead. Either way every environment
 * ends with exactly one exit trigger, named the same thing.
 */
return new class extends Migration
{
    private const KEEP = 'Exit Management';
    private const DROP = 'Exit Process';

    public function up(): void
    {
        if (!Schema::hasTable('master_trigger_points')) return;

        $dupes = DB::table('master_trigger_points')->where('module_name', self::DROP)->pluck('id');
        if ($dupes->isEmpty()) return;

        $keep = DB::table('master_trigger_points')->where('module_name', self::KEEP)->value('id');

        if (!$keep) {
            // Nothing to merge into — this is the fresh-install case. Rename.
            DB::table('master_trigger_points')->whereIn('id', $dupes)->update([
                'module_name' => self::KEEP,
                'description' => 'Fires when an employee starts the exit / offboarding flow',
                'updated_at'  => now(),
            ]);
            return;
        }

        // Repoint before deleting, so no template is left pointing at nothing.
        if (Schema::hasTable('hr_document_templates')) {
            DB::table('hr_document_templates')->whereIn('trigger_point_id', $dupes)
                ->update(['trigger_point_id' => $keep, 'updated_at' => now()]);
        }

        DB::table('master_trigger_points')->whereIn('id', $dupes)->delete();
    }

    public function down(): void
    {
        /* Deliberately not reversible. Re-creating the duplicate would restore
           the bug, and the rename cannot be told apart from a row a tenant
           created themselves. */
    }
};
