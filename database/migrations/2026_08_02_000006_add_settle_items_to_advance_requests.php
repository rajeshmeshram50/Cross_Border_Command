<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Settle "usage" items — the employee itemises how a company advance was used,
 * one row per bill: { amount, reason, proof_path, proof_name }. The rows are
 * captured together when the advance is settled; their total drives the
 * equal / minimum / maximum outcome + return/reimburse balance already stored
 * in settle_type / settle_balance / settle_actual_amount.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->json('settle_items')->nullable()->after('settle_proof_name');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn('settle_items');
        });
    }
};
