<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recruitments', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            $table->string('code', 20)->nullable()->index();

            $table->string('job_title', 191);
            $table->unsignedBigInteger('department_id')->nullable()->index();
            $table->unsignedBigInteger('designation_id')->nullable()->index();
            $table->unsignedBigInteger('primary_role_id')->nullable()->index();

            $table->string('employment_type', 30)->nullable();
            $table->unsignedInteger('openings')->default(1);
            $table->string('experience', 30)->nullable();
            $table->string('work_mode', 30)->nullable();
            $table->string('ctc_range', 50)->nullable();
            $table->string('priority', 20)->default('Medium');

            $table->unsignedBigInteger('hiring_manager_id')->nullable()->index();
            $table->unsignedBigInteger('assigned_hr_id')->nullable()->index();
            $table->date('start_date')->nullable();
            $table->date('deadline')->nullable();

            $table->text('job_description')->nullable();
            $table->text('requirements')->nullable();

            $table->boolean('post_on_portal')->default(true);
            $table->boolean('notify_team_leads')->default(true);
            $table->boolean('enable_referral_bonus')->default(false);

            $table->string('status', 20)->default('In Progress');
            $table->string('cancel_reason', 100)->nullable();
            $table->text('cancel_notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status'], 'recruitments_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recruitments');
    }
};
