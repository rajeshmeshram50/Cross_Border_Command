<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-leave escape hatch from the branch's Sandwich Leave Policy.
 *
 * The policy is deliberately blunt — it fires on the shape of the calendar, not
 * on why the leave was taken. A bereavement or a hospital admission that
 * happens to straddle a weekend is exactly the case an HR team wants to spare,
 * and the policy alone has no way to tell it apart from a stretched long
 * weekend. This flag is that judgement call, recorded per leave.
 *
 * It lives on the LEAVE, not on the payroll run, because leave_requests.days is
 * the one number both the leave BALANCE and the payslip read. Waiving only at
 * payroll time would pay 2 days while the employee's balance stayed down 4, and
 * nothing in the system would explain the gap.
 *
 * waived_by / waived_at exist because this is a discretionary reversal of a
 * company policy: "who let this through" has to be answerable months later.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->boolean('sandwich_waived')->default(false)->after('days');
            $table->unsignedBigInteger('sandwich_waived_by')->nullable()->after('sandwich_waived');
            $table->timestamp('sandwich_waived_at')->nullable()->after('sandwich_waived_by');
            // Free text — "father's funeral", "emergency surgery". Kept short:
            // it is a margin note for an auditor, not a case file.
            $table->string('sandwich_waiver_reason', 255)->nullable()->after('sandwich_waived_at');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn([
                'sandwich_waived',
                'sandwich_waived_by',
                'sandwich_waived_at',
                'sandwich_waiver_reason',
            ]);
        });
    }
};
