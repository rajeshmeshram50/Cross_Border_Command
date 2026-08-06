<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Approval gate on the employee's SETTLEMENT of a company advance.
 *
 * Previously the employee finalised their usage declaration and could then
 * immediately return the balance / raise a reimbursement. Now the finalised
 * settlement first goes to a branch admin or HR for approve/reject; only after
 * approval can the return / reimbursement / close proceed. A rejection reopens
 * the settlement (employee_settled_at cleared) so the employee can re-settle.
 *
 *   settle_approval_status : null → not finalised yet
 *                            pending  → finalised, awaiting branch/HR
 *                            approved → unlocked for return/reimburse/close
 *                            rejected → reopened; comment carries the reason
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->string('settle_approval_status', 12)->nullable()->after('employee_settled_at');
            $table->unsignedBigInteger('settle_approved_by')->nullable()->after('settle_approval_status');
            $table->timestamp('settle_approved_at')->nullable()->after('settle_approved_by');
            $table->string('settle_approval_comment', 500)->nullable()->after('settle_approved_at');
        });

        // Grandfather settlements finalised BEFORE this approval gate existed as
        // already-approved, so their return/reimburse isn't retroactively blocked.
        DB::table('advance_requests')
            ->whereNotNull('employee_settled_at')
            ->whereNull('settle_approval_status')
            ->update(['settle_approval_status' => 'approved']);
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn([
                'settle_approval_status',
                'settle_approved_by',
                'settle_approved_at',
                'settle_approval_comment',
            ]);
        });
    }
};
