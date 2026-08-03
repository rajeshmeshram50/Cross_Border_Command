<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When HR emails the employee their reimbursement confirmation (available once
 * the claim is fully paid AND every payment is synced to Zoho Books), we stamp
 * this so the UI can show "Emailed" and allow a resend.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->timestamp('reimbursement_emailed_at')->nullable()->after('settled_at');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn('reimbursement_emailed_at');
        });
    }
};
