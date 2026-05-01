<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Self-service onboarding invites. The HR admin pre-fills the employee's
 * basic contact details + intended department/joining date and emails a
 * one-time signed link. The candidate clicks through, completes the wizard
 * themselves, and submitting the form mints the Employee + User rows.
 *
 * `status` lifecycle:
 *   pending   → link sent, candidate hasn't submitted yet
 *   completed → candidate submitted, `employee_id` populated
 *   expired   → expires_at passed, link no longer accepted
 *   cancelled → admin cancelled before completion
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_onboarding_invites', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            // Admin pre-fill — appears on the public form so the candidate
            // sees confirmation of which org invited them.
            $table->string('invitee_name', 255);
            $table->string('invitee_email', 191)->index();
            $table->unsignedBigInteger('department_id')->nullable();
            $table->date('expected_join_date')->nullable();

            // 64-char URL-safe token. Unique-indexed so token-collision lookups
            // are O(1) and we can hard-fail at insert if the random bytes ever
            // collide (effectively never).
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
