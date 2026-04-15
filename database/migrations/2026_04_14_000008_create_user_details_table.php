<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_details', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->nullable()->constrained('users')->cascadeOnDelete();

            // Personal
            $table->string('gender', 20)->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('blood_group', 10)->nullable();
            $table->string('marital_status', 20)->nullable();
            $table->string('nationality', 50)->nullable();
            $table->string('religion', 50)->nullable();

            // Employment
            $table->string('employee_id', 50)->nullable(); // company-specific employee ID
            $table->string('role_level', 20)->nullable(); // manager, employee, intern
            $table->date('joining_date')->nullable();
            $table->date('confirmation_date')->nullable();
            $table->date('resignation_date')->nullable();
            $table->string('employment_type', 30)->nullable(); // full_time, part_time, contract, intern

            // Salary
            $table->decimal('basic_salary', 12, 2)->nullable();
            $table->decimal('hra', 12, 2)->nullable();
            $table->decimal('da', 12, 2)->nullable();
            $table->decimal('special_allowance', 12, 2)->nullable();
            $table->decimal('gross_salary', 12, 2)->nullable();
            $table->decimal('net_salary', 12, 2)->nullable();
            $table->string('bank_name', 100)->nullable();
            $table->string('bank_account_number', 50)->nullable();
            $table->string('bank_ifsc', 20)->nullable();

            // Documents
            $table->string('aadhaar_number', 20)->nullable();
            $table->string('pan_number', 20)->nullable();
            $table->string('passport_number', 20)->nullable();
            $table->date('passport_expiry')->nullable();
            $table->string('driving_license', 30)->nullable();

            // Emergency
            $table->string('emergency_contact', 255)->nullable();
            $table->string('emergency_phone', 20)->nullable();
            $table->string('emergency_relation', 50)->nullable();

            // Address
            $table->text('current_address')->nullable();
            $table->text('permanent_address')->nullable();

            // Qualifications
            $table->string('highest_qualification', 100)->nullable();
            $table->string('specialization', 100)->nullable();
            $table->string('university', 255)->nullable();
            $table->integer('passing_year')->nullable();

            // Profile pic and docs stored as paths
            $table->string('profile_photo', 500)->nullable();
            $table->jsonb('document_uploads')->nullable(); // [{type, path, uploaded_at}]

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_details');
    }
};
