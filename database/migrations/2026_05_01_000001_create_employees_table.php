<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employees', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            $table->unsignedBigInteger('user_id')->nullable()->unique();

            $table->string('emp_code', 20)->nullable()->index();

            $table->string('first_name', 100);
            $table->string('middle_name', 100)->nullable();
            $table->string('last_name', 100)->nullable();
            $table->string('display_name', 255)->nullable()->index();
            $table->enum('gender', ['Male', 'Female', 'Other'])->nullable();
            $table->date('date_of_birth')->nullable();
            $table->unsignedBigInteger('nationality_country_id')->nullable()->index();
            $table->unsignedBigInteger('work_country_id')->nullable()->index();

            $table->string('email', 191)->nullable()->index();
            $table->string('mobile', 30)->nullable();
            $table->string('alt_mobile', 30)->nullable();

            $table->unsignedBigInteger('country_id')->nullable()->index();
            $table->unsignedBigInteger('state_id')->nullable()->index();
            $table->string('city', 100)->nullable();
            $table->string('address_line1', 255)->nullable();
            $table->string('address_line2', 255)->nullable();
            $table->string('pincode', 20)->nullable();

            $table->unsignedBigInteger('legal_entity_id')->nullable()->index();
            $table->string('location', 191)->nullable();
            $table->unsignedBigInteger('department_id')->nullable()->index();
            $table->unsignedBigInteger('designation_id')->nullable()->index();
            $table->unsignedBigInteger('primary_role_id')->nullable()->index();
            $table->unsignedBigInteger('ancillary_role_id')->nullable()->index();
            $table->unsignedBigInteger('reporting_manager_id')->nullable()->index();
            $table->date('date_of_joining')->nullable();

            $table->string('probation_policy', 50)->nullable();
            $table->integer('probation_months')->nullable();
            $table->string('notice_period', 50)->nullable();
            $table->integer('notice_period_days')->nullable();

            $table->json('assets')->nullable();

            $table->enum('status', [
                'Active', 'Inactive', 'On Leave', 'Probation',
                'Notice Period', 'Resigned', 'Terminated',
            ])->default('Active');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status'], 'employees_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employees');
    }
};
