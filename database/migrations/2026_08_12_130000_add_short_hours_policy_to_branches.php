<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-branch short-hours policy: how few hours a worked day must fall under
 * before payroll counts it as half a day (or as absent) instead of a full day.
 *
 * Nullable and disabled by default — until an admin switches it on, a day's
 * credit is decided purely by attendances.status exactly as before, so no
 * existing payslip moves. See Branch::shortHoursPolicy().
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->json('short_hours_policy')->nullable()->after('lop_policy');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('short_hours_policy');
        });
    }
};
