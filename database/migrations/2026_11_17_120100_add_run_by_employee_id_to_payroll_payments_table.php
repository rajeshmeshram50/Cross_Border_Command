<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Carries the declared operator from approve() to initiate().
 *
 * The disbursement popup names the operator on the APPROVE step, but payroll is
 * only actually executed on the INITIATE step that follows — and the audit log
 * must be written only after a successful execution, never on the intent to
 * execute. Parking the id here is what lets the two steps agree without the
 * client having to send the same answer twice (and without trusting it twice).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_payments', function (Blueprint $table) {
            $table->unsignedBigInteger('run_by_employee_id')->nullable()->after('approved_by_name');
        });
    }

    public function down(): void
    {
        Schema::table('payroll_payments', function (Blueprint $table) {
            $table->dropColumn('run_by_employee_id');
        });
    }
};
