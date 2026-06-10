<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Link holidays to a holiday group, and assign each employee a holiday group.
 * Both columns are nullable (ungrouped holidays + unassigned employees stay
 * valid) and follow the project's no-DB-FK convention for HR tables.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('holidays', function (Blueprint $table) {
            $table->unsignedBigInteger('holiday_group_id')->nullable()->index()->after('branch_id');
        });

        Schema::table('employees', function (Blueprint $table) {
            if (!Schema::hasColumn('employees', 'holiday_group_id')) {
                $table->unsignedBigInteger('holiday_group_id')->nullable()->index()->after('leave_plan');
            }
        });
    }

    public function down(): void
    {
        Schema::table('holidays', function (Blueprint $table) {
            $table->dropColumn('holiday_group_id');
        });
        Schema::table('employees', function (Blueprint $table) {
            if (Schema::hasColumn('employees', 'holiday_group_id')) {
                $table->dropColumn('holiday_group_id');
            }
        });
    }
};
