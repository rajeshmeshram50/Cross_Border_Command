<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bug #114 — Payable Days and Paid Days mismatch.
 *
 * paid_days used to be derived as working_days − lop_days, and lop_days carries
 * the late-mark penalty as well as real absence. An employee present for every
 * payable day therefore read "Payable 25 / Paid 24" with nothing on the slip to
 * account for the missing day.
 *
 * paid_days is now the attendance figure, and this column records how much of
 * lop_days is the late-mark penalty rather than absence — so the two numbers
 * still reconcile for anyone reading the slip:
 *
 *     paid_days − late_lop_days + (absence) = working_days
 *
 * Nullable with a 0 default: payslips generated before this migration keep a
 * null, which the UI reads as "not recorded for this cycle" rather than
 * claiming a confident zero on a slip that was built the old way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->decimal('late_lop_days', 6, 2)->nullable()->after('lop_days');
        });
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropColumn('late_lop_days');
        });
    }
};
