<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('previous_employments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('company_name', 255);
            $table->string('job_title', 255)->nullable();
            $table->date('start_date')->nullable();
            $table->date('end_date')->nullable();

            $table->string('hr_email_1', 191)->nullable();
            $table->string('hr_email_2', 191)->nullable();
            $table->string('contact_number', 30)->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['employee_id', 'deleted_at'], 'prev_emp_active_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('previous_employments');
    }
};
