<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hiring_requests', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            $table->string('code', 20)->nullable()->index();

            $table->string('title', 191);
            $table->string('job_role', 191);
            $table->unsignedBigInteger('department_id')->nullable()->index();
            $table->string('team', 100)->nullable();
            $table->string('requested_by_name', 150)->nullable();
            $table->date('request_date')->nullable();

            $table->unsignedInteger('openings')->default(1);
            $table->string('employment_type', 30)->nullable();
            $table->string('work_mode', 30)->nullable();
            $table->string('urgency', 20)->default('Medium');

            $table->text('job_description')->nullable();
            $table->text('daily_responsibilities')->nullable();
            $table->string('required_skills', 255)->nullable();
            $table->string('required_experience', 30)->nullable();
            $table->string('required_qualification', 100)->nullable();
            $table->string('preferred_profile', 191)->nullable();

            $table->string('request_type', 50)->nullable();
            $table->text('business_justification')->nullable();
            $table->text('hiring_need_reason')->nullable();
            $table->text('current_team_gap')->nullable();
            $table->text('what_if_not_filled')->nullable();

            $table->date('target_join_date')->nullable();

            $table->string('status', 30)->default('Draft');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status'], 'hiring_requests_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hiring_requests');
    }
};
