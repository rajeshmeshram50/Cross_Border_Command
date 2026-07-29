<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * eSSL biometric-device integration — Phase 0 foundation.
 *
 * 1. Widen the attendance `method` enums to accept 'device' — punches ingested
 *    from an eSSL / ZKTeco terminal, distinct from the in-app 'face' / 'manual'
 *    / 'auto' sources. Laravel's enum() compiles to a CHECK constraint on
 *    Postgres, so we drop + re-add it (same pattern as the gender / hr-doc
 *    role_type relaxations already in this folder).
 * 2. Add device-provenance columns to attendance_punches so an imported punch
 *    can be traced back to the physical terminal + its raw device record even
 *    if the employee's attendance_number is later changed.
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §14.
 */
return new class extends Migration {
    /** table => enum column, all widened to include 'device'. */
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
            // Which physical terminal produced this punch (eSSL Serial No.).
            $table->string('device_serial', 64)->nullable()->after('method')->index();
            // The raw User ID sent by the device (mapped to employee via
            // employees.attendance_number). Retained for audit/disputes.
            $table->string('device_user_id', 50)->nullable()->after('device_serial');
            // The device status code (0..5) exactly as sent, BEFORE our
            // normaliser re-derives strict in/out alternation.
            $table->string('raw_status', 8)->nullable()->after('device_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->dropColumn(['device_serial', 'device_user_id', 'raw_status']);
        });

        if (DB::getDriverName() === 'pgsql') {
            // Coerce any device punches back to 'auto' so the tighter
            // constraint can re-apply on rollback.
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
