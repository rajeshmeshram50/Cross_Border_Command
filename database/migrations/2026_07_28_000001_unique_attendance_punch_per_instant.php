<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * DB-level idempotency for attendance punches: one employee cannot have two
 * (non-deleted) punches at the exact same instant. Backs the importer's
 * check-then-insert dedup against a concurrency race (two overlapping imports,
 * or an import racing a live punch), and makes re-pushed device buffers safe.
 *
 * Partial (WHERE deleted_at IS NULL) so a deliberately soft-deleted punch does
 * not block a genuinely different future punch — resurrection is separately
 * prevented in the importer via a withTrashed() existence check.
 *
 * See docs/ATTENDANCE_AUDIT_2026-07-28.md (F: importer idempotency).
 */
return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // Auto-resolve duplicate punch instants so the unique index can build:
        // soft-delete all but the lowest id in each (employee_id, punched_at)
        // group (identical-instant punches are redundant). Logged + recoverable.
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
