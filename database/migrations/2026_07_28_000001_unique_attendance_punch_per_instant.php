<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $extras = DB::select(
            'SELECT p.id FROM attendance_punches p
              WHERE p.deleted_at IS NULL
                AND p.id > (
                    SELECT MIN(p2.id) FROM attendance_punches p2
                     WHERE p2.employee_id = p.employee_id
                       AND p2.punched_at = p.punched_at
                       AND p2.deleted_at IS NULL
                )'
        );
        if (!empty($extras)) {
            $ids = array_map(fn ($e) => $e->id, $extras);
            \Illuminate\Support\Facades\Log::warning('[migration] soft-deleted ' . count($ids) . ' duplicate attendance_punch(es) before adding unique index', ['ids' => $ids]);
            DB::table('attendance_punches')->whereIn('id', $ids)->update(['deleted_at' => now()]);
        }

        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS attendance_punches_emp_instant_unique '
            . 'ON attendance_punches (employee_id, punched_at) WHERE deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('DROP INDEX IF EXISTS attendance_punches_emp_instant_unique');
    }
};
