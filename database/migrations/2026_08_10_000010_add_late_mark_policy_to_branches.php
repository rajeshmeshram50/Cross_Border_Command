<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-branch late-mark deduction policy.
 *
 * Until now BR-01 was hardcoded in PayrollService: every 3 late marks cost
 * half a day of LOP. Offices differ — some cut a half day every 3 lates,
 * some a full day every 4 — so the rule moves to branch configuration.
 *
 * Stored as JSON: { enabled: bool, count: int, deduction: 'half_day'|'full_day' }
 * NULL means "never configured" and falls back to the legacy 3 → half day,
 * so existing branches keep the exact behaviour they had before this column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->json('late_mark_policy')->nullable()->after('shifts');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('late_mark_policy');
        });
    }
};
