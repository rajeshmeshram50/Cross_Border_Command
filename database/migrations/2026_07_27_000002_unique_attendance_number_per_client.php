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

        // Auto-resolve any duplicate attendance_numbers so the unique index can
        // build: keep the LOWEST employee id in each (client, number) group and
        // clear the number from the rest (they simply become not-device-tracked
        // until reassigned a unique one). Each cleared row is logged so the
        // change is recoverable / auditable.
        $extras = DB::select(
            "SELECT u.id, u.client_id, u.attendance_number
               FROM employees u
              WHERE u.deleted_at IS NULL AND u.attendance_number IS NOT NULL AND u.attendance_number <> ''
                AND u.id > (
                    SELECT MIN(e2.id) FROM employees e2
                     WHERE COALESCE(e2.client_id, 0) = COALESCE(u.client_id, 0)
                       AND e2.attendance_number = u.attendance_number
                       AND e2.deleted_at IS NULL
                )"
        );
        if (!empty($extras)) {
            foreach ($extras as $e) {
                \Illuminate\Support\Facades\Log::warning('[migration] cleared duplicate employee attendance_number', [
                    'employee_id' => $e->id, 'client_id' => $e->client_id, 'attendance_number' => $e->attendance_number,
                ]);
            }
            DB::table('employees')
                ->whereIn('id', array_map(fn ($e) => $e->id, $extras))
                ->update(['attendance_number' => null]);
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
