<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exit Process — blacklist flag captured at final closure.
 *
 * Asked only for the exit types where it can apply: a resignation WITHOUT
 * serving notice, and a termination. A clean resignation that served its
 * notice is never blacklisted, so the field isn't offered there and the column
 * stays NULL for those cases.
 *
 * Stored as a nullable string rather than a boolean so the three states stay
 * distinguishable: 'Yes' / 'No' = HR answered, NULL = never asked (a standard
 * resignation, or a case closed before this field existed). A boolean would
 * collapse "not applicable" into "No" and make a genuine clearance
 * indistinguishable from a question nobody was asked.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->string('blacklisted', 3)->nullable()->after('hr_sign_off');
            $table->string('blacklist_reason', 500)->nullable()->after('blacklisted');
            // Rehire screening reads this — index it so "is this person
            // blacklisted?" doesn't scan the table.
            $table->index('blacklisted');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['blacklisted']);
            $table->dropColumn(['blacklisted', 'blacklist_reason']);
        });
    }
};
