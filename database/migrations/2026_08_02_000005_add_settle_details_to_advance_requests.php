<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Employee "Settle Payment" details for a company advance. The employee records
 * the ACTUAL amount spent (with a required bill/proof); the system compares it
 * to the sanctioned/paid amount:
 *   • equal     → actual == sanctioned, balance 0
 *   • return    → actual <  sanctioned, employee returns (sanctioned − actual)
 *   • reimburse → actual >  sanctioned, company reimburses (actual − sanctioned)
 * `settle_balance` is stored as a positive magnitude; `settle_type` says which.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->decimal('settle_actual_amount', 18, 2)->nullable()->after('employee_settle_note');
            $table->string('settle_type', 16)->nullable()->after('settle_actual_amount'); // equal | return | reimburse
            $table->decimal('settle_balance', 18, 2)->default(0)->after('settle_type');    // magnitude to return / reimburse
            $table->string('settle_proof_path', 512)->nullable()->after('settle_balance');
            $table->string('settle_proof_name', 255)->nullable()->after('settle_proof_path');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['settle_actual_amount', 'settle_type', 'settle_balance', 'settle_proof_path', 'settle_proof_name']);
        });
    }
};
