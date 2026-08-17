<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Termination — how the notice period is settled becomes HR's decision.
 *
 * Every other exit type derives its notice settlement from the type alone
 * (ExitController::resolveSettlementMode): a resignation serves its notice, a
 * resignation without notice recovers the unserved days. Termination sat in
 * that same bracket — always 'pay_in_lieu' — but a company can legitimately
 * terminate either WITH pay in lieu of notice or WITHOUT it, and only HR knows
 * which. So this one type takes an explicit answer, asked up-front in the
 * Initiate Exit picker and stored here.
 *
 * Nullable, and only ever set for a Termination:
 *   'pay'    → notice details are required; the amount is calculated and
 *              carried into the Full & Final settlement.
 *   'no_pay' → no notice payment is calculated; F&F shows it Not Applicable.
 *   NULL     → not a termination, or a case opened before this column existed.
 *              Those legacy terminations keep their previous behaviour (pay in
 *              lieu), so nothing already recorded changes meaning.
 *
 * A short string rather than an enum: the settlement vocabulary has grown twice
 * already, and an enum needs a schema change to grow again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->string('notice_payment_choice', 10)
                ->nullable()
                ->after('notice_settlement_mode');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropColumn('notice_payment_choice');
        });
    }
};
