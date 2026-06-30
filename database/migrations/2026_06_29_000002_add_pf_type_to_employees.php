<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PF calculation type — captured on the employee's Stage 4 (Payroll &
 * Finance Setup) once PF is marked applicable.
 *
 *   statutory = 12% of basic, capped at the ₹15,000 EPF wage ceiling
 *               (max ₹1,800/month) — the default.
 *   standard  = 12% of the FULL basic, no ceiling.
 *
 * Read by PayrollService when computing the PF deduction; `pf_eligible`
 * stays the on/off gate ("PF Applicable"), this column picks the method.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('pf_type', 16)->nullable()->after('pf_eligible'); // statutory | standard
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('pf_type');
        });
    }
};
