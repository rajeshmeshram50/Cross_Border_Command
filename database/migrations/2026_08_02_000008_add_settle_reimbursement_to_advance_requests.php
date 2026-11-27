<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
