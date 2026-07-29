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
