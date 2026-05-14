<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the "DEFAULT plan" flag and the policy-explanation choice that
 * the Add Leave Plan modal exposes (system-generated vs. uploaded
 * custom doc). One default per branch is enforced in LeavePlanController,
 * not at the DB level, so HR can switch the default without races.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('master_leave_plans', function (Blueprint $table) {
            $table->boolean('is_default')->default(false)->after('status');
            $table->enum('policy_explanation_mode', ['System', 'Custom'])->default('System')->after('is_default');
            $table->string('policy_doc_path', 1024)->nullable()->after('policy_explanation_mode');
        });
    }

    public function down(): void
    {
        Schema::table('master_leave_plans', function (Blueprint $table) {
            $table->dropColumn(['is_default', 'policy_explanation_mode', 'policy_doc_path']);
        });
    }
};
