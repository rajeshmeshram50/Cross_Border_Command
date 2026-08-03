<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When Finance records a settlement payment they now attach a PROOF OF PAYMENT
 * (the receipt / transfer confirmation for the amount actually disbursed). Stored
 * per-installment on `expense_claim_payments`. `payment_type` also widens to hold
 * the fuller list of payment methods (UPI / PhonePe / Cash / Cheque / Bank Transfer).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->string('proof_path')->nullable()->after('note');
            $table->string('proof_name')->nullable()->after('proof_path');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->dropColumn(['proof_path', 'proof_name']);
        });
    }
};
