<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Stage 1 (Inquiry Received) → Task Manager.
 *
 * One row per lead. Captures the Purchase-Decision-Maker contact + the
 * order-context fields (buying plan / order value / optional attachment)
 * the salesperson collects while qualifying the inquiry.
 *
 * The relationship is one-to-one with leads, enforced via a composite
 * UNIQUE on (client_id, lead_id) so:
 *   - the controller upserts in place on re-save,
 *   - rows cascade away when the parent lead is hard-deleted, and
 *   - the same lead_id is never duplicated within a tenant.
 *
 * Ported from IDIMS_6.0's `lead_task_managers` table; tenant scope is
 * the cross-cutting addition for the SaaS port.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_task_managers', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();

            // Order context
            $table->decimal('order_value', 15, 2)->nullable();
            $table->date('buying_plan')->nullable();

            // Purchase Decision Maker
            $table->string('name', 255);
            $table->string('mobile_no', 32);
            $table->string('email', 255);

            // Optional supporting document — stored on the public disk
            // under leads/task-manager/{client}/...
            $table->string('attachment', 500)->nullable();
            $table->string('attachment_original', 255)->nullable();

            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // One task-manager row per (tenant, lead).
            $table->unique(['client_id', 'lead_id'], 'lead_task_managers_tenant_lead_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_task_managers');
    }
};
