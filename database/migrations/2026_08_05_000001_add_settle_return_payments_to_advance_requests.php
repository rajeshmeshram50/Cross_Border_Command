<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Return-payment ledger for a "return" (used-less) settlement. The employee
 * returns the unused balance to the company, either paid directly (in one or
 * more instalments) or cut from payroll. Each entry:
 *   { amount, method, mode: 'direct'|'payroll', proof_path, proof_name, paid_at }
 * `settle_returned_at` is stamped once the ledger total covers the balance.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->json('settle_return_payments')->nullable()->after('settle_return_proof_name');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn('settle_return_payments');
        });
    }
};
