<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persist the Yes/No answer to "Has the employee worked anywhere
 * before?" so the Document Management stage can hydrate the radio
 * group on revisit. Previously the answer was derived purely from
 * whether any previous_employments rows existed — which meant a
 * "No — first job" pick had nowhere to live and the radio reset to
 * unanswered every time the HR reopened the wizard.
 *
 * Nullable boolean: null = not answered yet, true = Yes, false = No.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->boolean('has_prior_experience')
                ->nullable()
                ->after('reporting_manager_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('has_prior_experience');
        });
    }
};
