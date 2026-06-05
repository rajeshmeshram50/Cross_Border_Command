<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll period (a.k.a. "cycle") — one row per (client, branch, month, year).
 *
 * This is the spine of the payroll engine. A period must have its attendance
 * FINALIZED before any payroll run can start against it (Rule 1), and once the
 * run is paid the period is LOCKED so no further attendance edits leak in
 * (Rule 14). Status ladder: open → processing → locked.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_periods', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // Cycle coordinates. `month` 1-12, `year` 4-digit. `label` is the
            // display string the SPA already speaks ("Apr 2026").
            $table->unsignedTinyInteger('month');
            $table->unsignedSmallInteger('year');
            $table->string('label', 20);
            $table->date('period_start');
            $table->date('period_end');
            // Payable working days in the cycle (excludes weekly-offs/holidays).
            // Drives proration + the "x/working_days" attendance cells.
            $table->unsignedTinyInteger('working_days')->default(26);

            // Rule 1 — attendance must be finalized before processing.
            $table->boolean('attendance_finalized')->default(false);
            $table->timestamp('attendance_finalized_at')->nullable();
            $table->unsignedBigInteger('attendance_finalized_by')->nullable();

            // Rule 14 — period-level lock. open=editable, processing=run in
            // flight, locked=paid & frozen.
            $table->enum('status', ['open', 'processing', 'locked'])->default('open');
            $table->timestamp('locked_at')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // One period per tenant+branch+month+year (Rule 13 — no duplicate
            // cycle). branch_id is part of the key so each branch runs its own.
            $table->unique(['client_id', 'branch_id', 'month', 'year'], 'payroll_periods_unique_cycle');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_periods');
    }
};
