<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Attendance regularization requests. An employee raises a correction for a
 * past day — either adjusting the punch log (mode = adjust) or asking for the
 * day to be exempted from the late/absent penalty policy (mode = exempt). The
 * request is routed to the reporting manager (and HR) for approval, mirroring
 * the leave_requests workflow (snapshotted approval_chain + per-level status).
 *
 * Drives:
 *   - Employee profile Attendance tab ("Request Regularization" + history)
 *   - HR Attendance review screen (Regularize action + approve/reject)
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('attendance_regularizations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            // Links to the daily attendance row when one already exists for the
            // date (nullable — an absent day has no attendance row yet).
            $table->unsignedBigInteger('attendance_id')->nullable()->index();

            $table->date('regularization_date');
            $table->enum('mode', ['adjust', 'exempt'])->default('adjust');
            // Human label kept from the UI ("Forgot to Punch", "On Duty (OD)", …).
            $table->string('type', 100)->nullable();

            // Requested work location(s) for the corrected day — multi-select.
            $table->json('work_locations')->nullable();
            // Requested punch entries: [{ in: "09:30", out: "18:00" }, …]. The
            // exact in/out times the employee wants on record for the day.
            $table->json('punches')->nullable();

            $table->text('reason')->nullable();

            $table->enum('status', ['Pending', 'Approved', 'Rejected', 'Cancelled'])->default('Pending')->index();

            // Snapshotted approval chain — frozen at submit time so later RM
            // changes don't reroute in-flight requests (same shape as leave).
            $table->json('approval_chain')->nullable();
            $table->unsignedInteger('current_approval_level')->default(1);

            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('approver_comment')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_regularizations');
    }
};
