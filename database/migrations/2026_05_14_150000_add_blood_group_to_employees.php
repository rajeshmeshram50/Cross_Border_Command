<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds `blood_group` to the employees table.
 *
 * The onboarding wizard's Stage 1 form has had a Blood Group dropdown for
 * a while, but the column never existed on employees (it lives on
 * user_details — a sibling table that nothing else here writes to). Every
 * save silently stripped the field at validation and the dropdown reset
 * to empty on reload.
 *
 * Schema convention follows the other personal-info fields on the
 * employees table (gender, date_of_birth, nationality_country_id) —
 * everything Stage 1 touches lives here for simpler reads.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('blood_group', 10)->nullable()->after('date_of_birth');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('blood_group');
        });
    }
};
