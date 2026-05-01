<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recruitment requisitions — one row per open hiring position.
 *
 * Tenant scoping mirrors `employees` and the master tables (client_id,
 * branch_id). The auto-numbered `code` (REC-001, REC-002, …) restarts per
 * tenant tuple so each client/branch has its own numbering series.
 *
 * FK columns reference master tables for department / designation / role
 * and the `employees` table for hiring manager / assigned HR. Free-form
 * dropdown values that come from the frontend (employment_type, work_mode,
 * priority, experience) are stored as strings — they aren't a backed master.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recruitments', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            // Auto-generated REC-### per tenant.
            $table->string('code', 20)->nullable()->index();

            // ── Position Details ──────────────────────────────────────
            $table->string('job_title', 191);
            $table->unsignedBigInteger('department_id')->nullable()->index();
            $table->unsignedBigInteger('designation_id')->nullable()->index();
            $table->unsignedBigInteger('primary_role_id')->nullable()->index();

            // Free-form dropdowns from the frontend — no backing master.
            $table->string('employment_type', 30)->nullable();   // Full Time / Part Time / Contract / Internship
            $table->unsignedInteger('openings')->default(1);
            $table->string('experience', 30)->nullable();        // 0-1, 1-3, 3-5, 5-8, 8+
            $table->string('work_mode', 30)->nullable();         // On-site / Remote / Hybrid / Flexible
            // CTC arrives as a free string ("8-12", "12.5", "Open") to support
            // ranges as well as single values — keeping it textual avoids
            // splitting into min/max columns when the form is open-ended.
            $table->string('ctc_range', 50)->nullable();
            $table->string('priority', 20)->default('Medium');   // Critical / High / Medium / Low

            // ── Hiring Configuration ──────────────────────────────────
            // Both point to employees.id — UI shows them as searchable employee
            // dropdowns. Nullable so a draft can be saved before assignment.
            $table->unsignedBigInteger('hiring_manager_id')->nullable()->index();
            $table->unsignedBigInteger('assigned_hr_id')->nullable()->index();
            $table->date('start_date')->nullable();
            $table->date('deadline')->nullable();

            // ── Job Details ───────────────────────────────────────────
            $table->text('job_description')->nullable();
            $table->text('requirements')->nullable();

            // ── Toggles ──────────────────────────────────────────────
            $table->boolean('post_on_portal')->default(true);
            $table->boolean('notify_team_leads')->default(true);
            $table->boolean('enable_referral_bonus')->default(false);

            // ── Lifecycle ────────────────────────────────────────────
            $table->string('status', 20)->default('In Progress'); // In Progress / Completed / Cancelled
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
