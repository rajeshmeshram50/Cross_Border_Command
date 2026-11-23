<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
