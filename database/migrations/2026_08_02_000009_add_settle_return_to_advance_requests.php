<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
