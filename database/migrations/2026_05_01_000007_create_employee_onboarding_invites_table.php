<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_onboarding_invites', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            $table->string('invitee_name', 255);
            $table->string('invitee_email', 191)->index();
            $table->unsignedBigInteger('department_id')->nullable();
            $table->date('expected_join_date')->nullable();

            $table->string('token', 64)->unique();
            $table->timestamp('expires_at');

            $table->string('status', 20)->default('pending')->index();
            $table->timestamp('completed_at')->nullable();
            $table->unsignedBigInteger('employee_id')->nullable()->index();

            $table->timestamps();
            $table->index(['client_id', 'branch_id', 'status'], 'invites_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_onboarding_invites');
    }
};
