<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_request_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('advance_request_payments', 'zoho_status')) {
                $table->string('zoho_status', 16)->default('not_synced')->after('proof_name');
            }
            if (!Schema::hasColumn('advance_request_payments', 'zoho_synced_at')) {
                $table->timestamp('zoho_synced_at')->nullable()->after('zoho_status');
            }
            if (!Schema::hasColumn('advance_request_payments', 'zoho_expense_id')) {
                $table->string('zoho_expense_id', 64)->nullable()->after('zoho_synced_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('advance_request_payments', function (Blueprint $table) {
            foreach (['zoho_status', 'zoho_synced_at', 'zoho_expense_id'] as $col) {
                if (Schema::hasColumn('advance_request_payments', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
