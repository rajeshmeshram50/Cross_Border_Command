<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Remove the Legal Entities master entirely.
     *
     * The branch record replaced it: a branch carries the GST/PAN/CIN/IEC and,
     * since 2026_07_30_000010, the bank accounts, and `employees.legal_entity_id`
     * was repointed at `branches` by 2026_07_30_000020. Nothing reads
     * master_legal_entities any more, so the tables, the module and its granted
     * permissions all go.
     *
     * Child table first — master_legal_entity_banks has an FK to the parent.
     */
    public function up(): void
    {
        Schema::dropIfExists('master_legal_entity_banks');
        Schema::dropIfExists('master_legal_entities');

        $moduleIds = DB::table('modules')->where('slug', 'master.legal_entities')->pluck('id');
        if ($moduleIds->isEmpty()) {
            return;
        }

        // permissions.module_id / plan_modules.module_id are cascadeOnDelete, but
        // clear them explicitly so the intent is visible and the migration is
        // safe on installs where the FK was never created.
        DB::table('permissions')->whereIn('module_id', $moduleIds)->delete();
        if (Schema::hasTable('plan_modules')) {
            DB::table('plan_modules')->whereIn('module_id', $moduleIds)->delete();
        }
        DB::table('modules')->whereIn('id', $moduleIds)->delete();
    }

    /**
     * Not reversible: the master's rows are gone and the feature it backed no
     * longer exists in the app. Restoring the empty tables would only create a
     * module with no UI behind it.
     */
    public function down(): void
    {
        //
    }
};
