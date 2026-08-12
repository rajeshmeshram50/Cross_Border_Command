<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `pf_eligible` was NOT NULL DEFAULT false, so the column could say "PF does
 * not apply" but never "nobody has decided yet" — an unanswered field and an
 * explicit No were the same value.
 *
 * PF Applicable is now a required answer on the onboarding wizard's
 * Compensation step. Without a nullable column that requirement collapses the
 * moment HR saves a draft: the unanswered field would round-trip as `false`,
 * come back pre-selected as "No", and pass its own validation.
 *
 * Existing rows keep `false`. They were saved through a form that offered only
 * Yes/No, so reading them as an explicit "No" is the honest interpretation —
 * there is no way to recover, retroactively, who actually chose it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->boolean('pf_eligible')->nullable()->default(null)->change();
        });
    }

    public function down(): void
    {
        // NOT NULL cannot be restored while unanswered rows exist; they become
        // the "No" they were indistinguishable from before this migration.
        DB::table('employees')->whereNull('pf_eligible')->update(['pf_eligible' => false]);

        Schema::table('employees', function (Blueprint $table) {
            $table->boolean('pf_eligible')->nullable(false)->default(false)->change();
        });
    }
};
