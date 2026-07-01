<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A leave plan is view-only ("locked") once every assigned type is fully
 * configured — changes are made by cloning it into a new plan. But a clone is
 * created already fully-configured (it copies the source's config), so under
 * the pure completeness rule it would be born locked and could never be
 * edited — the exact opposite of why you clone.
 *
 * `unlocked` is an explicit override: when true, the plan stays editable even
 * though it is fully configured. Only clone() sets it, so a cloned plan opens
 * as an editable draft. Every other plan keeps the completeness-derived lock
 * (default false), so existing behaviour is unchanged.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('master_leave_plans', function (Blueprint $table) {
            $table->boolean('unlocked')->default(false)->after('is_default');
        });
    }

    public function down(): void
    {
        Schema::table('master_leave_plans', function (Blueprint $table) {
            $table->dropColumn('unlocked');
        });
    }
};
