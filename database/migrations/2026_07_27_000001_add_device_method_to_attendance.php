<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    private array $methodColumns = [
        ['attendances', 'check_in_method'],
        ['attendances', 'check_out_method'],
        ['attendance_punches', 'method'],
    ];

    public function up(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            foreach ($this->methodColumns as [$table, $col]) {
                DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_{$col}_check");
                DB::statement(
                    "ALTER TABLE {$table} ADD CONSTRAINT {$table}_{$col}_check "
                    . "CHECK ({$col} IS NULL OR {$col} IN ('face', 'manual', 'auto', 'device'))"
                );
            }
        }

        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->string('device_serial', 64)->nullable()->after('method')->index();
            $table->string('device_user_id', 50)->nullable()->after('device_serial');
            $table->string('raw_status', 8)->nullable()->after('device_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->dropColumn(['device_serial', 'device_user_id', 'raw_status']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("UPDATE attendance_punches SET method = 'auto' WHERE method = 'device'");
            DB::statement("UPDATE attendances SET check_in_method  = 'auto' WHERE check_in_method  = 'device'");
            DB::statement("UPDATE attendances SET check_out_method = 'auto' WHERE check_out_method = 'device'");

            foreach ($this->methodColumns as [$table, $col]) {
                DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_{$col}_check");
                DB::statement(
                    "ALTER TABLE {$table} ADD CONSTRAINT {$table}_{$col}_check "
                    . "CHECK ({$col} IS NULL OR {$col} IN ('face', 'manual', 'auto'))"
                );
            }
        }
    }
};
