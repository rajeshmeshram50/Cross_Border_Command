<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-advance, per-cycle recovery ledger.
 *
 * The payroll engine used to re-derive each EMI purely from dates, with no
 * memory of what was actually collected. That made it impossible to carry a
 * shortfall forward: when two advances' EMIs together exceed the 70% FOI
 * headroom in a lean month, the older advance is cut first and the remainder
 * of the newer one must roll into its next cycle. This table records, for each
 * advance and payroll month, what was DUE (EMI + any carried arrears), what was
 * actually RECOVERED, and what was CARRIED forward — so the next run can top up.
 *
 * One row per (advance_request_id, year, month); the run overwrites it on
 * regenerate (updateOrInsert) so re-processing a month stays idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('advance_recovery_ledger', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('advance_request_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('client_id')->nullable();
            $table->unsignedBigInteger('branch_id')->nullable();
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('month');
            $table->decimal('due', 12, 2)->default(0);      // EMI + carried arrears owed this cycle
            $table->decimal('amount', 12, 2)->default(0);   // actually recovered this cycle
            $table->decimal('carried', 12, 2)->default(0);  // deferred to the next cycle
            $table->timestamps();

            $table->unique(['advance_request_id', 'year', 'month'], 'adv_recovery_uniq');
            $table->index(['employee_id', 'year', 'month']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('advance_recovery_ledger');
    }
};
