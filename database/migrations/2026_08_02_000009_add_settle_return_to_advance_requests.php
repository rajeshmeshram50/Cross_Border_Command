<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When a finalised COMPANY advance settled as "return" (used less than the
 * advance), the employee returns the unused balance to the company. These
 * columns record that return payment (method + proof + timestamp) so the
 * "Make Payment" action flips to "Returned" and can't be actioned twice.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->timestamp('settle_returned_at')->nullable()->after('settle_reimbursed_at');
            $table->string('settle_return_method', 40)->nullable()->after('settle_returned_at');
            $table->string('settle_return_proof_path')->nullable()->after('settle_return_method');
            $table->string('settle_return_proof_name')->nullable()->after('settle_return_proof_path');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['settle_returned_at', 'settle_return_method', 'settle_return_proof_path', 'settle_return_proof_name']);
        });
    }
};
