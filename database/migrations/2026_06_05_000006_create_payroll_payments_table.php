<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('payroll_run_id')->index();
            $table->unsignedBigInteger('payroll_period_id')->index();

            $table->string('mode', 16);
            $table->string('status', 24)->default('draft');

            $table->unsignedInteger('employee_count')->default(0);
            $table->decimal('total_amount', 16, 2)->default(0);

            $table->string('company_name', 191)->nullable();
            $table->string('bank_name', 191)->nullable();

            $table->string('prepared_by_name', 191)->nullable();
            $table->string('verified_by_name', 191)->nullable();
            $table->string('approved_by_name', 191)->nullable();
            $table->timestamp('approved_at')->nullable();

            $table->string('batch_ref', 40)->nullable();
            $table->timestamp('paid_at')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_payments');
    }
};
