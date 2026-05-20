<?php

use App\Http\Controllers\Api\MasterController;
use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Follow-up cleanup — the previous purge migration only targeted rows
 * with `client_id IS NULL` AND `branch_id IS NULL`. Some super-admin-
 * seeded rows can carry a tenant context (e.g. when the seeder ran
 * against a logged-in super-admin who also had a default client), so
 * those didn't get caught.
 *
 * This pass is broader: delete from every master EXCEPT
 *   • organization_types
 *   • countries
 *   • states
 *   • state_codes
 * any row whose `created_by` points to ANY super_admin user, regardless
 * of client_id / branch_id.
 *
 * Reversal is a no-op; rerun MasterDataSeeder to restore globals.
 */
return new class extends Migration
{
    public function up(): void
    {
        $adminIds = User::where('user_type', 'super_admin')->pluck('id')->all();
        if (empty($adminIds)) {
            return;
        }

        $ref    = new \ReflectionClass(MasterController::class);
        $MODELS = $ref->getConstant('MODELS');

        $skip = ['organization_types', 'countries', 'states', 'state_codes'];

        $totalDeleted = 0;
        $tablesPurged = [];

        foreach ($MODELS as $slug => $class) {
            if (in_array($slug, $skip, true)) {
                continue;
            }
            try {
                /** @var \Illuminate\Database\Eloquent\Model $instance */
                $instance = new $class();
                $table = $instance->getTable();

                if (! Schema::hasColumn($table, 'created_by')) {
                    continue;
                }

                $deleted = DB::table($table)
                    ->whereIn('created_by', $adminIds)
                    ->delete();

                if ($deleted > 0) {
                    $totalDeleted   += $deleted;
                    $tablesPurged[] = "$table ($deleted)";
                }
            } catch (\Throwable $e) {
                continue;
            }
        }

        if ($totalDeleted > 0) {
            echo "  ⇂ Purged $totalDeleted super-admin-created rows across " . count($tablesPurged) . " masters.\n";
            foreach ($tablesPurged as $line) {
                echo "    • $line\n";
            }
        }
    }

    public function down(): void
    {
        // No-op — rerun MasterDataSeeder if you want the globals back.
    }
};
