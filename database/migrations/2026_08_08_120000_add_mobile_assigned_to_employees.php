<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `mobile_assigned` had no column. Both the Employee form and the Onboarding
 * wizard carried it as a UI-only Yes/No and re-derived it on load from
 * `mobile_master_asset_id ?: mobile_device` — so "Yes" with no device picked
 * yet had nowhere to live and came back as "No" in the other form.
 *
 * Sits beside `laptop_assigned`, which has always been a real column; the two
 * fields are the same thing and behaved differently only by accident.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('employees', 'mobile_assigned')) {
            return;
        }
        Schema::table('employees', function (Blueprint $table) {
            $table->string('mobile_assigned', 20)->nullable()->after('mobile_device');
        });

        // Backfill from what the forms were inferring, so existing records keep
        // showing what they show today instead of all resetting to blank.
        DB::table('employees')
            ->where(function ($q) {
                $q->whereNotNull('mobile_master_asset_id')
                  ->orWhere(function ($q2) {
                      $q2->whereNotNull('mobile_device')->where('mobile_device', '<>', '');
                  });
            })
            ->update(['mobile_assigned' => 'Yes']);
    }

    public function down(): void
    {
        if (Schema::hasColumn('employees', 'mobile_assigned')) {
            Schema::table('employees', fn (Blueprint $t) => $t->dropColumn('mobile_assigned'));
        }
    }
};
