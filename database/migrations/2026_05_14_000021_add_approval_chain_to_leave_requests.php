<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Multi-level approval support. Each leave request snapshots its approval
 * chain at submission time so changing the plan's chain config after the
 * fact doesn't retroactively re-route in-flight requests.
 *
 * `approval_chain` JSON shape:
 *   [
 *     {
 *       "level": 1,
 *       "approver_kind": "reporting_manager" | "role" | "user",
 *       "approver_role": "hr" | "branch_admin" | null,
 *       "approver_user_id": int | null,
 *       "approver_employee_id": int | null,    // resolved at snapshot
 *       "status": "Pending" | "Approved" | "Rejected" | "Skipped",
 *       "acted_by": int | null,
 *       "acted_at": string | null,
 *       "comment": string | null
 *     },
 *     ...
 *   ]
 *
 * `current_approval_level` is the 1-based index of the next level that
 * still needs to act. Equals chain.length + 1 once fully approved.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->json('approval_chain')->nullable()->after('approver_comment');
            $table->unsignedSmallInteger('current_approval_level')->default(1)->after('approval_chain');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn(['approval_chain', 'current_approval_level']);
        });
    }
};
