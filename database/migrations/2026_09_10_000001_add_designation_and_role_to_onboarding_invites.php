<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Designation and Primary Role move onto the INVITE. (CBC #24)
 *
 * Both were asked of the candidate on the public onboarding form, which is the
 * wrong party: what someone is hired as is HR's decision, not a field the new
 * joiner picks for themselves from a master list. They join department_id and
 * expected_join_date, which the invite already carried for exactly this reason,
 * and the form now shows them read-only alongside Legal Entity and Location.
 *
 * Nullable, so every invite already issued stays valid — an older one simply
 * carries no designation and the employee record is created without one, which
 * is what happened before this column existed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_onboarding_invites', function (Blueprint $table) {
            if (!Schema::hasColumn('employee_onboarding_invites', 'designation_id')) {
                $table->unsignedBigInteger('designation_id')->nullable()->after('department_id');
            }
            if (!Schema::hasColumn('employee_onboarding_invites', 'primary_role_id')) {
                $table->unsignedBigInteger('primary_role_id')->nullable()->after('designation_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('employee_onboarding_invites', function (Blueprint $table) {
            foreach (['designation_id', 'primary_role_id'] as $col) {
                if (Schema::hasColumn('employee_onboarding_invites', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
