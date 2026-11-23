<?php

use App\Http\Controllers\Api\MasterController;
use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $admin = User::where('user_type', 'super_admin')->first();
        if (! $admin) {
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
                $instance = new $class();
                $table = $instance->getTable();

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
    }
};
