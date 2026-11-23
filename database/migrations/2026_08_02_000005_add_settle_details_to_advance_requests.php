<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->decimal('settle_actual_amount', 18, 2)->nullable()->after('employee_settle_note');
            $table->string('settle_type', 16)->nullable()->after('settle_actual_amount');
            $table->decimal('settle_balance', 18, 2)->default(0)->after('settle_type');
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
