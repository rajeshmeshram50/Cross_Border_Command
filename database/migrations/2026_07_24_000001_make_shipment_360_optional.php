<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Shipment 360 (the `developers` / `developers.ops` / `developers.shipment`
 * modules) was seeded with is_default=true, which made the Permissions matrix
 * force-lock its checkbox ON for every user — so everyone saw the Shipment 360
 * tab regardless of what was actually granted.
 *
 * Make it a normal OPT-IN module like every other: clear the is_default flag so
 * the matrix lets admins tick/untick it, and remove the auto-granted permission
 * rows so it's hidden until someone explicitly grants it. (User request.)
 */
return new class extends Migration
{
    private array $slugs = ['developers', 'developers.ops', 'developers.shipment'];

    public function up(): void
    {
        // 1) No longer a default module.
        DB::table('modules')->whereIn('slug', $this->slugs)->update(['is_default' => false]);

        // 2) Drop the permissions that were auto-granted while it was default, so
        //    the tab disappears until it's explicitly re-granted from Permissions.
        $moduleIds = DB::table('modules')->whereIn('slug', $this->slugs)->pluck('id');
        if ($moduleIds->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $moduleIds)->delete();
        }
    }

    public function down(): void
    {
        // Restore the default flag (previously-deleted grants can't be recovered).
        DB::table('modules')->whereIn('slug', $this->slugs)->update(['is_default' => true]);
    }
};
