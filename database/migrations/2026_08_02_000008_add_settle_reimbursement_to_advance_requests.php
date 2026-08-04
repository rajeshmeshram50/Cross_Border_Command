<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When a finalised COMPANY advance settled as "reimburse" (used more than the
 * advance), the extra is paid back to the employee by raising a reimbursement
 * Expense Claim. These columns link the advance to that claim so the button
 * flips to "Reimbursement raised" and can't be actioned twice.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->unsignedBigInteger('settle_reimbursement_claim_id')->nullable()->after('settle_target_amount');
            $table->timestamp('settle_reimbursed_at')->nullable()->after('settle_reimbursement_claim_id');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['settle_reimbursement_claim_id', 'settle_reimbursed_at']);
        });
    }
};
