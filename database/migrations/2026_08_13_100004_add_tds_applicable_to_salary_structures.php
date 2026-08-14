<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * TDS — opt-in automatic income-tax deduction.
 *
 * Sits alongside pf_applicable / esi_applicable / pt_applicable, but unlike
 * those it defaults to FALSE. The other three describe statutory schemes an
 * employer is either registered for or not; TDS is a computation this module
 * has never performed, and switching it on by default would start deducting
 * income tax from every payslip in every existing tenant on the next run.
 *
 * With the flag off (every existing structure) payroll keeps honouring a manual
 * `tds` line on the structure exactly as before, so no payslip moves. With it
 * on, PayrollService::tdsForCycle() projects the annual liability on the new
 * regime and spreads it across the remaining months of the financial year.
 *
 * A manual `tds` line still wins over the computed figure either way — payroll
 * must never override a number accounts entered deliberately.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_structures', function (Blueprint $table) {
            $table->boolean('tds_applicable')->default(false)->after('pt_applicable');
        });
    }

    public function down(): void
    {
        Schema::table('salary_structures', function (Blueprint $table) {
            $table->dropColumn('tds_applicable');
        });
    }
};
