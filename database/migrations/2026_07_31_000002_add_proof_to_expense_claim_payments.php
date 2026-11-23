<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
