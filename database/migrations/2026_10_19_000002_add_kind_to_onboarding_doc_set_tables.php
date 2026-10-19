<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The document-set tables now serve BOTH onboarding and exit, so each row is
 * tagged with its `kind`. An employee can have an onboarding set and an exit
 * set at once, so the lock's uniqueness moves from (employee_id) to
 * (employee_id, kind). Existing rows are onboarding by default.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_onboarding_doc_selections', function (Blueprint $t) {
            $t->string('kind', 20)->default('onboarding')->after('employee_id');
            $t->index(['employee_id', 'kind']);
        });

        Schema::table('hr_onboarding_docset_locks', function (Blueprint $t) {
            $t->string('kind', 20)->default('onboarding')->after('employee_id');
        });
        // One lock per (employee, kind) instead of per employee.
        Schema::table('hr_onboarding_docset_locks', function (Blueprint $t) {
            $t->dropUnique(['employee_id']);
            $t->unique(['employee_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::table('hr_onboarding_docset_locks', function (Blueprint $t) {
            $t->dropUnique(['employee_id', 'kind']);
            $t->unique(['employee_id']);
            $t->dropColumn('kind');
        });
        Schema::table('hr_onboarding_doc_selections', function (Blueprint $t) {
            $t->dropIndex(['employee_id', 'kind']);
            $t->dropColumn('kind');
        });
    }
};
