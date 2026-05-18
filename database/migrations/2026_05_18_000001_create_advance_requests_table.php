<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `advance_requests` mirrors `expense_claims` one-for-one in shape so the
 * same two-stage approval flow (reporting manager → HR/Finance) works
 * unchanged. Only the form payload columns differ: instead of category /
 * vendor / expense_date / purpose we carry the advance-specific fields
 * (type, recovery schedule, reason, monthly EMI, etc.).
 *
 * The audit columns (`*_status`, `*_acted_at`, `*_comment`, `hr_user_id`)
 * use the same names as expense_claims so the SPA can reuse its existing
 * AuditLogPopover component without per-table branching.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('advance_requests', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('advance_no', 50)->nullable();

            // Owner — the employee who raised the advance request.
            $table->unsignedBigInteger('employee_id');
            // Reporting manager at submission time. Snapshotted so a later
            // manager change doesn't reroute pending requests.
            $table->unsignedBigInteger('manager_id')->nullable();

            // ── Form payload (advance-specific) ──
            // `advance_type` is one of the four enums the form offers; when
            // the user picks "Other" the free-text reason lands in
            // `advance_type_other` to avoid corrupting the enum column.
            $table->string('advance_type', 60);
            $table->string('advance_type_other', 255)->nullable();
            $table->decimal('amount', 18, 2)->default(0);
            $table->date('requested_date');
            $table->date('recovery_start');
            // emi / lumpsum / bimonthly — matches the form's MasterSelect.
            $table->string('recovery_mode', 16);
            // Only meaningful when recovery_mode='emi'. Nullable for the
            // other two modes.
            $table->unsignedSmallInteger('recovery_months')->nullable();
            $table->decimal('monthly_emi', 18, 2)->nullable();
            $table->text('reason');
            $table->json('attachments')->nullable();

            // ── Two-stage approval (identical to expense_claims) ──
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->enum('manager_status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->timestamp('manager_acted_at')->nullable();
            $table->text('manager_comment')->nullable();
            $table->enum('hr_status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->unsignedBigInteger('hr_user_id')->nullable();
            $table->timestamp('hr_acted_at')->nullable();
            $table->text('hr_comment')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            $table->index('employee_id');
            $table->index('manager_id');
            $table->index(['client_id', 'status']);
            $table->index(['client_id', 'branch_id', 'employee_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('advance_requests');
    }
};
