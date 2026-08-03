<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Store the itemised deductions applied when settling an expense claim as a JSON
 * list of { amount, reason } — so the Record-Payment form can show each deduction
 * with its own reason (not just a single lump-sum deduction + one note).
 * `deduction_amount` stays the running total; `sanctioned_amount` = claim − total.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->json('deductions')->nullable()->after('deduction_reason');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn('deductions');
        });
    }
};
