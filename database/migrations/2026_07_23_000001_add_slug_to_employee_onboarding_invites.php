<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Short public slug for onboarding invites. The emailed / shared link
 * becomes `/o/{slug}` (≈10 chars) instead of the 90-char
 * `/onboarding/{64-char-token}`. The long token stays the real credential —
 * `/o/{slug}` merely redirects to it — so the brute-force protection
 * (64-char token + throttle, per CLAUDE.md rule #6) is preserved.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_onboarding_invites', function (Blueprint $table) {
            // Nullable + unique so existing rows can be backfilled below.
            // Postgres permits many NULLs inside a unique index.
            $table->string('slug', 16)->nullable()->unique()->after('token');
        });

        // Backfill existing invites so their short links resolve too.
        foreach (DB::table('employee_onboarding_invites')->whereNull('slug')->get() as $row) {
            do {
                $slug = Str::random(10);
            } while (DB::table('employee_onboarding_invites')->where('slug', $slug)->exists());
            DB::table('employee_onboarding_invites')->where('id', $row->id)->update(['slug' => $slug]);
        }
    }

    public function down(): void
    {
        Schema::table('employee_onboarding_invites', function (Blueprint $table) {
            $table->dropUnique(['slug']);
            $table->dropColumn('slug');
        });
    }
};
