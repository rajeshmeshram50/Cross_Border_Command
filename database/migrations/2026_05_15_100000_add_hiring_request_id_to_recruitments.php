<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the optional `hiring_request_id` FK on `recruitments` so a
 * recruitment row knows which hiring request it was created from.
 *
 * Why we need it now:
 *   - The Hiring Requests modal grew a second tab ("Recruitment Created")
 *     that has to surface every request that's been promoted into a
 *     recruitment. Without a stable link, we'd have to fall back to
 *     fragile (title, department_id) matching.
 *   - Nullable because not every recruitment originates from a hiring
 *     request — recruiters can still raise a recruitment directly.
 *
 * No FK constraint is enforced at the DB level (matches the rest of
 * this codebase, which avoids hard FKs to allow soft-deleted parents).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recruitments', function (Blueprint $table) {
            $table->unsignedBigInteger('hiring_request_id')->nullable()->after('client_id');
            $table->index('hiring_request_id', 'recruitments_hiring_request_idx');
        });
    }

    public function down(): void
    {
        Schema::table('recruitments', function (Blueprint $table) {
            $table->dropIndex('recruitments_hiring_request_idx');
            $table->dropColumn('hiring_request_id');
        });
    }
};
