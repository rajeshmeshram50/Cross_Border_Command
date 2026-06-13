<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dedicated audit trail for a sales lead's ownership lifecycle.
 *
 * One row per event: the lead was generated, first-assigned, or reassigned.
 * Names + codes are SNAPSHOTTED at write time so the timeline stays correct
 * even if a user is later renamed / soft-deleted, and so reads need no joins.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_assignment_histories', function (Blueprint $table) {
            $table->id();

            // Tenancy — same scoping as every other business table.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // The opportunity / lead this event belongs to.
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();
            $table->string('opp_code', 64)->nullable();           // snapshot of leads.opp_code

            // generated | assigned | reassigned
            $table->string('action', 32);

            // Assigned TO — the new owner after this event.
            $table->unsignedBigInteger('assignee_user_id')->nullable();
            $table->string('assignee_name', 191)->nullable();

            // Previous owner (only on a reassignment).
            $table->unsignedBigInteger('previous_user_id')->nullable();
            $table->string('previous_name', 191)->nullable();

            // Assigned BY — who performed the action (the logged-in account).
            $table->unsignedBigInteger('assigned_by_user_id')->nullable();
            $table->string('assigned_by_name', 191)->nullable();

            // Context for a 'generated' event.
            $table->string('platform', 64)->nullable();           // Offline / IndiaMart / ...
            $table->string('source', 64)->nullable();             // Manual / CRM / ...

            // Pre-rendered human label + free notes.
            $table->string('description', 255)->nullable();

            $table->timestamp('created_at')->nullable();

            $table->index(['lead_id', 'created_at']);
            $table->index('client_id');
            $table->index('action');
            $table->index('assignee_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_assignment_histories');
    }
};
