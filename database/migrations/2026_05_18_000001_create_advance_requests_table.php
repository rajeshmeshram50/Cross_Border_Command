<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('advance_requests', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('advance_no', 50)->nullable();

            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('manager_id')->nullable();

            $table->string('advance_type', 60);
            $table->string('advance_type_other', 255)->nullable();
            $table->decimal('amount', 18, 2)->default(0);
            $table->date('requested_date');
            $table->date('recovery_start');
            $table->string('recovery_mode', 16);
            $table->unsignedSmallInteger('recovery_months')->nullable();
            $table->decimal('monthly_emi', 18, 2)->nullable();
            $table->text('reason');
            $table->json('attachments')->nullable();

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
