<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Used For" on an advance request — is the payout for the employee's own use
 * (Self, the existing recoverable-from-salary flow) or spent on the company's
 * behalf (Company, NOT recovered from salary)?
 *
 *  • self    → recovery_start + recovery_mode apply (salary recovery).
 *  • company → no salary recovery; capture an expected_use_date instead and
 *              leave recovery_mode blank.
 *
 * Existing rows default to 'self' so the current behaviour is unchanged.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->string('used_for', 16)->default('self')->after('amount'); // self | company
            $table->date('expected_use_date')->nullable()->after('recovery_start');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['used_for', 'expected_use_date']);
        });
    }
};
