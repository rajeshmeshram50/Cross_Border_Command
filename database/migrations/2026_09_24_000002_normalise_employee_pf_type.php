<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bring employees.pf_type into line with pf_eligible. (QA #214)
 *
 * PF Type lives only on `employees`, while PF applicability also mirrors onto
 * `salary_structures.pf_applicable`. Every screen that writes them is a partial
 * step save, and none of them reconciled the pair, so rows drifted into two
 * shapes that Compensation and Revise Salary then rendered differently:
 *
 *   PF on  + pf_type NULL  -> PayrollService silently uses the statutory base,
 *                             but neither screen shows a type.
 *   PF off + pf_type set   -> "PF: No" beside a stored PF Type.
 *
 * EmployeeController::normalisePfType() now enforces the rule on every write;
 * this repairs the rows written before it existed. Storing 'statutory' is not
 * a payroll change — it is what computeForEmployee() already assumes for NULL
 * (app/Services/PayrollService.php: only 'standard' takes the other branch).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('employees')
            || !Schema::hasColumn('employees', 'pf_type')
            || !Schema::hasColumn('employees', 'pf_eligible')) {
            return;
        }

        // PF on with no type named -> statutory, the base payroll already used.
        DB::table('employees')
            ->where('pf_eligible', true)
            ->whereNull('pf_type')
            ->update(['pf_type' => 'statutory']);

        // PF off -> no type. (Covers both false and the nullable "unanswered".)
        DB::table('employees')
            ->whereNotNull('pf_type')
            ->where(fn ($q) => $q->where('pf_eligible', false)->orWhereNull('pf_eligible'))
            ->update(['pf_type' => null]);
    }

    public function down(): void
    {
        // Data repair — the previous per-row values are not recoverable, and
        // restoring the inconsistency would serve nobody.
    }
};
