<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Make `emp_code` unique per BRANCH instead of per client.
 *
 * EmployeeController::allocateCode() has always counted EMP-### within a
 * single branch (it filters `branch_id`), so every branch restarts at
 * EMP-001. The index it wrote against, however, was (client_id, emp_code)
 * from OB-10 — client-wide. Result: the FIRST hire in a client's second
 * branch allocated EMP-001, collided with branch 1's EMP-001, and the
 * insert died with SQLSTATE 23505. store()'s catch-all mapped every 23505
 * to the email message, so QA saw "This email already has an account in
 * this organization" while using a brand-new address — the email was never
 * the problem.
 *
 * Widen the index to (client_id, branch_id, emp_code) so each branch keeps
 * its own EMP-001, EMP-002, … series. Mirrors the same fix already applied
 * to product codes (2026_07_14_000030) and the CLM master codes.
 *
 * The partial predicate is preserved: null/blank codes (incomplete
 * onboarding) stay exempt. NULL branch_id rows (client-level employees
 * created by a client_admin, whose resolveOwnership returns a null branch)
 * form their own bucket — Postgres treats NULLs as distinct, which matches
 * the allocator's whereNull('branch_id') path.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP INDEX IF EXISTS employees_client_emp_code_unique');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS employees_client_branch_emp_code_unique
            ON employees (client_id, branch_id, emp_code)
            WHERE emp_code IS NOT NULL AND emp_code <> ''");
    }

    public function down(): void
    {
        // NOTE: reverting only succeeds once duplicate emp_codes across the
        // branches of a client have been renumbered by hand.
        DB::statement('DROP INDEX IF EXISTS employees_client_branch_emp_code_unique');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS employees_client_emp_code_unique
            ON employees (client_id, emp_code)
            WHERE emp_code IS NOT NULL AND emp_code <> ''");
    }
};
