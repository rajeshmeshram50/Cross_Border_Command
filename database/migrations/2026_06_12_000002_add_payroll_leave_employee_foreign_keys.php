<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Referential integrity for payroll / leave / employee-document tables.
 *
 * The audit flagged that these tables carried NO database foreign keys (P6,
 * LV-24, OB-04) and no unique constraint on emp_code (OB-10), so a hard-delete
 * left orphaned payslips / leave requests / documents behind and duplicate
 * employee codes were possible.
 *
 * SAFETY:
 *  - Every constraint is preceded by an orphan-cleanup step, so the migration is
 *    safe on ANY environment (it was verified to be a no-op on the current DB —
 *    zero orphans, zero duplicate codes).
 *  - ON DELETE CASCADE only fires on a HARD delete (forceDelete). The app uses
 *    soft deletes for normal flows — the parent row physically remains, so the
 *    cascade does NOT fire there. The cascade is exactly the orphan-cleanup the
 *    audit asked for when a row is permanently removed.
 *  - leave_plan_id is nullable → SET NULL. leave_type_id is NOT NULL and already
 *    guarded by the LeaveTypes "in use" check → RESTRICT (defence in depth).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Orphan cleanup (defensive; no-op when data is already clean) ──────
        // Delete child rows whose required parent is missing; null nullable ones.
        $this->deleteOrphans('payslips', 'payroll_run_id', 'payroll_runs');
        $this->deleteOrphans('payslips', 'payroll_period_id', 'payroll_periods');
        $this->deleteOrphans('payslips', 'employee_id', 'employees');
        $this->deleteOrphans('payroll_runs', 'payroll_period_id', 'payroll_periods');
        $this->deleteOrphans('leave_requests', 'employee_id', 'employees');
        $this->nullOrphans('leave_requests', 'leave_plan_id', 'master_leave_plans');
        $this->deleteOrphans('leave_requests', 'leave_type_id', 'master_leave_types');
        $this->deleteOrphans('employee_documents', 'employee_id', 'employees');
        $this->deleteOrphans('previous_employments', 'employee_id', 'employees');

        // ── Foreign keys ─────────────────────────────────────────────────────
        if (Schema::hasTable('payslips')) {
            Schema::table('payslips', function (Blueprint $t) {
                $t->foreign('payroll_run_id')->references('id')->on('payroll_runs')->cascadeOnDelete();
                $t->foreign('payroll_period_id')->references('id')->on('payroll_periods')->cascadeOnDelete();
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
            });
        }
        if (Schema::hasTable('payroll_runs')) {
            Schema::table('payroll_runs', function (Blueprint $t) {
                $t->foreign('payroll_period_id')->references('id')->on('payroll_periods')->cascadeOnDelete();
            });
        }
        if (Schema::hasTable('leave_requests')) {
            Schema::table('leave_requests', function (Blueprint $t) {
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
                $t->foreign('leave_plan_id')->references('id')->on('master_leave_plans')->nullOnDelete();
                $t->foreign('leave_type_id')->references('id')->on('master_leave_types')->restrictOnDelete();
            });
        }
        if (Schema::hasTable('employee_documents')) {
            Schema::table('employee_documents', function (Blueprint $t) {
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
            });
        }
        if (Schema::hasTable('previous_employments')) {
            Schema::table('previous_employments', function (Blueprint $t) {
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
            });
        }

        // ── De-duplicate emp_code per client BEFORE the unique index ─────────
        // Some environments carry duplicate codes (e.g. a seeder run twice or a
        // restored snapshot). Keep the lowest-id row of each (client_id, emp_code)
        // group and suffix the rest with "-<id>" — the code is preserved
        // (non-destructive) yet made unique so the index below can be created.
        DB::statement("
            UPDATE employees e
            SET emp_code = e.emp_code || '-' || e.id::text
            WHERE e.emp_code IS NOT NULL AND e.emp_code <> ''
              AND EXISTS (
                SELECT 1 FROM employees e2
                WHERE e2.client_id = e.client_id
                  AND e2.emp_code = e.emp_code
                  AND e2.id < e.id
              )
        ");

        // ── emp_code uniqueness per client (OB-10) ───────────────────────────
        // Partial unique index — only real codes are constrained; null/blank
        // codes (incomplete onboarding) are exempt, and Postgres treats NULLs as
        // distinct anyway.
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS employees_client_emp_code_unique
            ON employees (client_id, emp_code)
            WHERE emp_code IS NOT NULL AND emp_code <> ''");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS employees_client_emp_code_unique');

        foreach ([
            'payslips'             => ['payroll_run_id', 'payroll_period_id', 'employee_id'],
            'payroll_runs'         => ['payroll_period_id'],
            'leave_requests'       => ['employee_id', 'leave_plan_id', 'leave_type_id'],
            'employee_documents'   => ['employee_id'],
            'previous_employments' => ['employee_id'],
        ] as $table => $cols) {
            if (!Schema::hasTable($table)) continue;
            Schema::table($table, function (Blueprint $t) use ($cols) {
                foreach ($cols as $c) {
                    try { $t->dropForeign([$c]); } catch (\Throwable $e) { /* not present */ }
                }
            });
        }
    }

    /** Delete child rows whose (non-null) FK has no matching parent. */
    private function deleteOrphans(string $child, string $fk, string $parent): void
    {
        if (!Schema::hasTable($child) || !Schema::hasTable($parent)) return;
        DB::table($child)
            ->whereNotNull($fk)
            ->whereNotIn($fk, fn ($q) => $q->select('id')->from($parent))
            ->delete();
    }

    /** Null out a nullable FK whose value has no matching parent. */
    private function nullOrphans(string $child, string $fk, string $parent): void
    {
        if (!Schema::hasTable($child) || !Schema::hasTable($parent)) return;
        DB::table($child)
            ->whereNotNull($fk)
            ->whereNotIn($fk, fn ($q) => $q->select('id')->from($parent))
            ->update([$fk => null]);
    }
};
