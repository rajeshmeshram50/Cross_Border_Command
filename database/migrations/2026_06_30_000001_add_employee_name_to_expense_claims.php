<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Denormalised employee name on the claim so it survives the employee
     * being deleted (soft OR hard) — mirrors the existing `category_name`
     * snapshot. The Approval Audit Log / All Claims list reads this as a
     * fallback when the employee relation no longer resolves.
     */
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->string('employee_name', 255)->nullable()->after('employee_id');
        });

        // Backfill existing rows from the employees table. A raw query-builder
        // read ignores the SoftDeletes global scope, so soft-deleted employees
        // still resolve their name here.
        DB::table('expense_claims')->orderBy('id')->chunkById(500, function ($claims) {
            foreach ($claims as $claim) {
                if (!empty($claim->employee_name) || !$claim->employee_id) {
                    continue;
                }
                $emp = DB::table('employees')->where('id', $claim->employee_id)->first();
                if (!$emp) {
                    continue;
                }
                $name = $emp->display_name
                    ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''));
                if ($name !== '') {
                    DB::table('expense_claims')->where('id', $claim->id)->update(['employee_name' => $name]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn('employee_name');
        });
    }
};
