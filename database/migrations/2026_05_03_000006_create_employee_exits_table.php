<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exit Process — Stage 1 fields (Exit Initiation & Approval).
 *
 * One row per employee: Stage 1 captures the exit type, reason, notice
 * dates and impact assessment. Subsequent stages will extend this table
 * (or layer on a child table for line items like asset returns,
 * clearances). Tenant scope mirrors the parent `employees` row so
 * EmployeeController's applyScope continues to work via the BelongsTo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_exits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('employee_id')->unique();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // Exit Details (Stage 1)
            $table->string('exit_type', 40)->nullable();
            $table->string('initiated_by', 40)->nullable();
            $table->string('reason_for_exit', 60)->nullable();
            // Free-text "Other" reason / type — captured when the user
            // picks "Other" in either dropdown so we keep the colour
            // around the choice without bloating the enum.
            $table->string('other_reason', 255)->nullable();
            $table->date('notice_date')->nullable();
            $table->date('last_working_day')->nullable();
            // Reporting manager FK to the employees table — defaults to
            // whatever is on the employee row but admins can override.
            $table->unsignedBigInteger('reporting_manager_id')->nullable();
            $table->text('comments')->nullable();

            // Impact Assessment
            $table->string('business_impact', 20)->nullable();
            $table->string('replacement_required', 60)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_exits');
    }
};
