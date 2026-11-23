<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_reminders', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();

            $table->string('opp_id', 60)->nullable()->index();
            $table->date('opp_date')->nullable();
            $table->string('subject', 255);
            $table->date('set_date');
            $table->string('tat', 60)->default('24 Hours');
            $table->text('remark')->nullable();
            $table->string('attachment_path', 1024)->nullable();
            $table->string('attachment_original_name', 255)->nullable();

            $table->string('status', 32)->default('In Progress')->index();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status']);
            $table->index(['created_by_user_id', 'status']);
            $table->index('set_date');
        });

        Schema::create('sales_meetings', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();

            $table->string('code', 30);

            $table->string('opp_id', 60)->nullable()->index();
            $table->string('customer', 255);
            $table->string('email', 191)->nullable();
            $table->string('contact', 50)->nullable();

            $table->string('platform', 100)->nullable();

            $table->date('date');
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();

            $table->text('link')->nullable();
            $table->text('venue')->nullable();

            $table->text('agenda')->nullable();

            $table->string('status', 32)->default('In Progress')->index();
            $table->string('type', 16)->default('virtual')->index();

            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'branch_id', 'code'], 'sales_meetings_code_tenant_unique');
            $table->index(['client_id', 'branch_id', 'type', 'status']);
            $table->index(['created_by_user_id', 'status']);
            $table->index('date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_meetings');
        Schema::dropIfExists('sales_reminders');
    }
};
