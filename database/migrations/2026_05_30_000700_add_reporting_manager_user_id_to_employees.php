<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds a second reporting-manager FK so a non-employee login user (e.g.
 * a Branch User who hasn't been onboarded as an Employee row yet) can be
 * assigned as someone's manager. The existing `reporting_manager_id`
 * stays the canonical FK when the manager IS an employee.
 *
 * Only one of the two columns is populated per row; the controller
 * decides which based on the picker's selected "kind".
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedBigInteger('reporting_manager_user_id')
                ->nullable()
                ->after('reporting_manager_id')
                ->index();
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex(['reporting_manager_user_id']);
            $table->dropColumn('reporting_manager_user_id');
        });
    }
};
