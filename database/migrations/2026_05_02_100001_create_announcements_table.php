<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Broadcast Centre — company-wide announcements with targeting,
 * acknowledgement tracking and scheduling.
 *
 * Audience targeting is captured as a small enum (all_employees / roles /
 * designations) plus a JSON id list — keeps the schema simple and avoids a
 * pivot table while announcements are the only consumer. Promote to a real
 * pivot if/when delivery tracking goes per-recipient.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership — same scoping rules as recruitments etc.
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();

            // ANN-#### per tenant. Auto-allocated like REC- / HRQ-.
            $table->string('code', 20)->nullable()->index();

            // ── Step 1 — Basic Details ────────────────────────────────
            $table->string('title', 191);
            $table->text('description');
            $table->string('type', 30)->default('General');     // General / Policy / Urgent
            $table->string('priority', 20)->default('Normal');  // Normal / High / Critical

            // Optional attachment — same public-disk layout as candidate CVs.
            $table->string('attachment_path', 255)->nullable();
            $table->string('attachment_original_name', 191)->nullable();

            // ── Step 2 — Audience ─────────────────────────────────────
            // 'all_employees', 'roles', 'designations'
            $table->string('audience_type', 30)->default('all_employees');
            // JSON id list — interpreted per audience_type. NULL when
            // audience_type=all_employees.
            $table->json('audience_role_ids')->nullable();
            $table->json('audience_designation_ids')->nullable();
            $table->json('exclude_employee_ids')->nullable();
            // Cached for the list view's "x employees" subtitle so we don't
            // re-derive the recipient count on every list query.
            $table->unsignedInteger('audience_count')->default(0);

            // ── Step 3 — Scheduling ───────────────────────────────────
            $table->string('publish_type', 20)->default('immediate'); // immediate | scheduled
            $table->dateTime('publish_at')->nullable();
            $table->dateTime('expires_at')->nullable();

            // ── Step 4 — Acknowledgement ──────────────────────────────
            $table->boolean('ack_required')->default(false);
            $table->string('ack_mode', 20)->default('Mandatory');           // Mandatory | Optional
            $table->string('ack_reminder_frequency', 20)->default('Weekly'); // Daily | Weekly | Never
            $table->unsignedInteger('ack_escalation_days')->default(3);

            // ── Step 5 — Notifications ────────────────────────────────
            $table->boolean('notify_email')->default(true);
            $table->boolean('notify_in_app')->default(true);
            $table->boolean('notify_sms')->default(false);
            $table->boolean('notify_whatsapp')->default(false);

            // ── Lifecycle ─────────────────────────────────────────────
            // Draft → Scheduled (when publish_at > now and saved as
            // immediate=false) → Active (live) → Expired (past expires_at).
            $table->string('status', 20)->default('Draft');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status'], 'announcements_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
