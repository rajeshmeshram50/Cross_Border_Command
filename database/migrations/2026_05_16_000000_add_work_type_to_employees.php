<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the missing `work_type` column to the employees table. The Add /
 * Edit Employee form had a Work Type dropdown (Full Time / Part Time /
 * Contract / Intern / Consultant) but the value was never persisted —
 * the field only existed in React state and got dropped on every save.
 * This migration plus the matching changes in EmployeeController and the
 * `$fillable` array in the Employee model close the loop so editing a
 * row shows the originally-selected work type.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('work_type', 50)->nullable()->after('ancillary_role_ids');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('work_type');
        });
    }
};