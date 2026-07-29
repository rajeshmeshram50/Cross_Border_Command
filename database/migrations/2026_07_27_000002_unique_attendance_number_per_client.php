<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * eSSL integration prerequisite — a device User ID maps to exactly ONE employee
 * via employees.attendance_number, so the number must be unique within a
 * tenant. Two employees sharing a number would route a device punch to the
 * wrong person (and therefore the wrong payslip).
 *
 * Partial unique index keyed on COALESCE(client_id, 0) — mirrors the
 * users_email_client_unique pattern (2026_06_25). Ignores NULL/blank numbers
 * (employees not tracked on a device) and soft-deleted rows.
 *
 * NOTE: if the tenant already has two live employees sharing an
 * attendance_number, index creation will fail — resolve the duplicate first,
 * then re-run. The matching application-level guard lives in
 * EmployeeController's validator.
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §14.2.
 */
return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // Pre-flight: a unique index cannot be built while duplicates exist.
        // Detect them and abort with an ACTIONABLE list (which employees share a
        // number) instead of a raw SQLSTATE 23505 that says only one key.
        $dupes = DB::select(
            "SELECT COALESCE(client_id, 0) AS client_id, attendance_number, count(*) AS c
               FROM employees
              WHERE attendance_number IS NOT NULL AND attendance_number <> '' AND deleted_at IS NULL
              GROUP BY 1, 2 HAVING count(*) > 1
              ORDER BY 1, 2"
        );
        if (!empty($dupes)) {
            $lines = array_map(
                fn ($d) => "  · client {$d->client_id}, attendance_number '{$d->attendance_number}' (x{$d->c})",
                $dupes
            );
            throw new \RuntimeException(
                "Cannot create employees_attendance_number_client_unique — duplicate Attendance "
                . "Numbers exist. Each employee's Attendance Number must be unique per client. "
                . "Resolve these (clear or renumber the duplicates), then re-run migrate:\n"
                . implode("\n", $lines)
            );
        }

        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS employees_attendance_number_client_unique '
            . 'ON employees (COALESCE(client_id, 0), attendance_number) '
            . "WHERE attendance_number IS NOT NULL AND attendance_number <> '' AND deleted_at IS NULL"
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS employees_attendance_number_client_unique');
    }
};
