<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Proceed-to-Pay is now filed as two separate batches — HDFC (same-bank) and
 * Other Banks (outbound NEFT). The chosen batch has to persist on the payment
 * draft, because approve/initiate/bank-file all run later and must disburse
 * exactly the set that was reviewed and signed off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_payments', function (Blueprint $table) {
            $table->string('bank_group', 16)->default('all')->after('mode');
        });

        // Payments raised before the split covered every bank in one advice.
        \Illuminate\Support\Facades\DB::table('payroll_payments')
            ->whereNull('bank_group')->update(['bank_group' => 'all']);
    }

    public function down(): void
    {
        Schema::table('payroll_payments', function (Blueprint $table) {
            $table->dropColumn('bank_group');
        });
    }
};
