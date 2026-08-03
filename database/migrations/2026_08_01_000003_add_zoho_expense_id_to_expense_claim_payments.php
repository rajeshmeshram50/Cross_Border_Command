<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Zoho Books expense_id created for a settlement payment when it's synced —
 * kept so a re-sync is idempotent (we don't create a duplicate expense) and so
 * a failed sync can be reversed by deleting that expense.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->string('zoho_expense_id')->nullable()->after('zoho_synced_at');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->dropColumn('zoho_expense_id');
        });
    }
};
