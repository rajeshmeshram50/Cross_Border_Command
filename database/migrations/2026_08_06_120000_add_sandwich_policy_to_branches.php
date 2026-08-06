<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sandwich Leave Policy — master switch, held at BRANCH level.
 *
 * The rule is a statutory/HR-policy choice that applies uniformly to an office,
 * not to an individual: if it is on for a branch, every employee posted to that
 * branch is covered, and a new joiner inherits it the moment they are assigned.
 * Storing it per-employee would let the same office run two different leave
 * arithmetics side by side and would need backfilling on every hire.
 *
 * Boolean rather than an enum: today the only question is on/off. The finer
 * variants that may follow (which leave types it bites on, one-sided vs
 * both-sided) are separate concerns and get their own columns when specified —
 * folding them into one enum now would force a data migration then.
 *
 * Defaults to false so existing branches keep counting leave exactly as they do
 * today; turning it on is an explicit, deliberate act by an admin.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->boolean('sandwich_policy')->default(false)->after('branch_type');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('sandwich_policy');
        });
    }
};
