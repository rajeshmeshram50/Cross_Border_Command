<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;


return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_claims', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('claim_no', 50)->nullable();

            // Owner — the employee who raised the claim.
            $table->unsignedBigInteger('employee_id');
            // Reporting manager at the time of submission. Snapshotted so a
            // later change to the employee's manager doesn't reroute existing
            // claims.
            $table->unsignedBigInteger('manager_id')->nullable();

            // Form payload
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('category_name', 255)->nullable(); // denormalized for legacy mock rows
            $table->string('currency', 8)->default('INR');
            $table->string('project', 64)->nullable();
            $table->string('payment_method', 64)->nullable();
            $table->string('title', 255);
            $table->decimal('amount', 18, 2)->default(0);
            $table->date('expense_date');
            $table->string('vendor', 255)->nullable();
            $table->text('purpose')->nullable();
            $table->json('attachments')->nullable();

            // Two-stage approval
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
        Schema::dropIfExists('expense_claims');
    }
};
