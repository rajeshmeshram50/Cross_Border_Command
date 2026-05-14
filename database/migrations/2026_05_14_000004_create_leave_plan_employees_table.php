<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Maps employees to the leave plan they're on. Unique on employee_id —
 * an employee can be on exactly one plan at a time (matches Keka). The
 * existing `employees.leave_plan` text column is left in place for
 * backward compat; new writes go through this pivot. A future migration
 * can backfill the pivot from the legacy column once the UI fully
 * cuts over.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('leave_plan_employees', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('leave_plan_id')->index();
            $table->unsignedBigInteger('employee_id')->unique();
            $table->timestamp('assigned_at')->nullable();
            $table->unsignedBigInteger('assigned_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_plan_employees');
    }
};
