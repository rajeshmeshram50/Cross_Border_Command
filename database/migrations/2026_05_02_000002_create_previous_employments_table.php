<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stage 2 — Previous Employment Companies. One row per company the
 * candidate worked at before. The Stage 2 form lets the admin add /
 * remove rows; per-company document uploads land in `employee_documents`
 * with a key like `prev_<previous_employment_id>_exp_letter`.
 *
 * Background-verification fields (HR emails + contact number) live on
 * this row so each company carries its own verification context.
 */
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

            // Background-verification context. Two HR emails so HR can
            // cross-check; phone for direct contact.
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
