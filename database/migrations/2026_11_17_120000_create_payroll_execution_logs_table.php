<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_execution_logs', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->unsignedBigInteger('payroll_run_id')->nullable()->index();
            $table->unsignedBigInteger('payroll_period_id')->nullable()->index();
            $table->smallInteger('month')->nullable();
            $table->smallInteger('year')->nullable();
            $table->string('period_label', 40)->nullable();

            $table->unsignedBigInteger('run_by_employee_id')->nullable()->index();
            $table->string('run_by_employee_code', 60)->nullable();
            $table->string('run_by_name', 191)->nullable();

            $table->unsignedBigInteger('executed_by_user_id')->nullable()->index();
            $table->string('executed_by_user_name', 191)->nullable();

            $table->string('status', 20)->default('Completed')->index();
            $table->string('failure_reason', 500)->nullable();

            $table->timestamp('executed_at')->nullable()->index();

            $table->string('batch_ref', 60)->nullable();
            $table->integer('employees_paid')->nullable();
            $table->integer('employees_held')->nullable();
            $table->decimal('total_amount', 14, 2)->nullable();

            $table->timestamps();

            $table->index(['client_id', 'branch_id', 'year', 'month'], 'pel_scope_period_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_execution_logs');
    }
};
