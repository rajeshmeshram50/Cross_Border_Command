<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-branch loss-of-pay policy: which salary component an absent day is
 * charged against, and what it is divided by.
 *
 * Nullable on purpose — a branch that has never been configured keeps the
 * legacy hardcoded rule (basic ÷ calendar days), so no existing payslip moves
 * until an admin deliberately changes it. See Branch::lopPolicy().
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->json('lop_policy')->nullable()->after('late_mark_policy');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('lop_policy');
        });
    }
};
