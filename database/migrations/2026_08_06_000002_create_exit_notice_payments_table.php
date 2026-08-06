<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Notice-period recovery paid BY the employee.
 *
 * When someone resigns without serving their notice they owe the company the
 * unserved days. Until now HR typed that receipt into the exit wizard from
 * memory; this table lets the EMPLOYEE submit it themselves from their own
 * Payroll Details tab — amount, mode, reference, date and a screenshot of the
 * transfer — and leaves HR to verify and approve it.
 *
 * One row per submission rather than one per exit: a rejected payment has to
 * be resubmittable, and the history of what was sent and why it was refused is
 * exactly what makes the approval defensible.
 *
 * `amount_due` snapshots what was owed AT SUBMISSION. The live figure moves
 * with the last working day and the salary basis, so without the snapshot an
 * approved payment could later look short (or over) against a number that
 * changed after the fact.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('exit_notice_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('employee_exit_id')->nullable()->index();

            $table->decimal('amount_due', 12, 2)->default(0);
            $table->decimal('amount', 12, 2);
            $table->string('payment_mode', 40)->nullable();
            $table->string('bank_name', 120)->nullable();
            $table->string('utr_cheque_number', 40)->nullable();
            $table->date('payment_date')->nullable();

            $table->string('attachment_path', 1024)->nullable();
            $table->string('attachment_name', 255)->nullable();
            $table->string('employee_note', 500)->nullable();

            // Pending → Approved / Rejected. Approving is what settles the
            // notice recovery and unblocks the exit's Final Closure stage.
            $table->string('status', 20)->default('Pending')->index();
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->string('verification_remarks', 500)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exit_notice_payments');
    }
};
