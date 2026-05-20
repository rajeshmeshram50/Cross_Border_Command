<?php

use App\Http\Controllers\Api\MasterController;
use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One-time cleanup — remove the super-admin-seeded "global" rows from
 * every master table EXCEPT:
 *
 *   • organization_types  (Organization master)
 *   • countries           (ISO country list)
 *   • states              (full state dataset)
 *   • state_codes         (GST state codes)
 *
 * Those four stay because they're platform-level reference data and
 * the rest of the app depends on the well-known global rows.
 *
 * The seed pattern that this migration targets:
 *   client_id  = NULL
 *   branch_id  = NULL
 *   created_by = <super_admin user id>
 *
 * Each tenant can then build out their own master values from scratch.
 *
 * SAFETY:
 *   • Only deletes rows that match all three predicates above, so
 *     anything a tenant has actually created stays untouched.
 *   • Skips tables that don't expose `client_id` / `branch_id` /
 *     `created_by` columns — those are platform-only masters that
 *     don't follow the tenant-scoped seeder pattern.
 *   • Wraps every per-table delete in a try/catch so one bad table
 *     can't abort the whole migration.
 *
 * REVERSAL:
 *   `down()` is a no-op. To restore the global rows, re-run the
 *   master seeder:  php artisan db:seed --class=Database\\Seeders\\MasterDataSeeder
 */
return new class extends Migration
{
    public function up(): void
    {
        $admin = User::where('user_type', 'super_admin')->first();
        if (! $admin) {
            // Nothing to purge — there's no super_admin user, so no
            // super-admin-seeded rows can exist.
            return;
        }
        $adminId = $admin->id;

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

                // Skip tables that don't carry the tenant + creator triplet —
                // they're not part of the super-admin seeded scope.
                if (
                    ! Schema::hasColumn($table, 'client_id')
                    || ! Schema::hasColumn($table, 'branch_id')
                    || ! Schema::hasColumn($table, 'created_by')
                ) {
                    continue;
                }

                $deleted = DB::table($table)
                    ->whereNull('client_id')
                    ->whereNull('branch_id')
                    ->where('created_by', $adminId)
                    ->delete();

                if ($deleted > 0) {
                    $totalDeleted   += $deleted;
                    $tablesPurged[] = "$table ($deleted)";
                }
            } catch (\Throwable $e) {
                // Skip and continue — a missing table or model class
                // shouldn't break the migration.
                continue;
            }
        }

        if ($totalDeleted > 0) {
            echo "  ⇂ Purged $totalDeleted super-admin-seeded rows across " . count($tablesPurged) . " masters.\n";
            foreach ($tablesPurged as $line) {
                echo "    • $line\n";
            }
        }
    }

    public function down(): void
    {
        // No-op — re-run MasterDataSeeder to restore.
    }
};
