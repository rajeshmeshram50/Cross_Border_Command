<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Track that a view-only HR user has SEEN a leave request. Leave approval is
 * reporting-manager-only, so HR never acts on the chain — but the UI shows an
 * "HR" node that should turn green once HR has reviewed the request. These
 * columns record the first such view (idempotent — set once, never overwritten).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->timestamp('hr_viewed_at')->nullable()->after('approver_comment');
            $table->unsignedBigInteger('hr_viewed_by')->nullable()->after('hr_viewed_at');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn(['hr_viewed_at', 'hr_viewed_by']);
        });
    }
};
