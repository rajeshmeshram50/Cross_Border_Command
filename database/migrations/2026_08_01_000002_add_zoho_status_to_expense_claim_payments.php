<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks whether a settlement payment has been pushed to Zoho Books. For now the
 * status is toggled locally by the "Sync to Zoho" button (UI only) — the actual
 * Zoho Books push (createExpense) is a senior-owned ZohoBooksService addition and
 * will be wired here later. `not_synced` | `synced`.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->string('zoho_status', 16)->default('not_synced')->after('proof_name');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_status');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->dropColumn(['zoho_status', 'zoho_synced_at']);
        });
    }
};
