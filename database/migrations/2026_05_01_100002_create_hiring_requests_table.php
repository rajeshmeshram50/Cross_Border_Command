<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hiring requests — the internal "raise hiring need" form that an HoD or
 * team-lead submits BEFORE recruitment opens an actual REC requisition.
 * Reviewed by HR (Approved → kicks off recruitment, Sent Back → returned
 * for clarification, Rejected → closed).
 *
 * Tenant scoping mirrors `recruitments` (client_id, branch_id) and the
 * auto-numbered `code` (HRQ-001, HRQ-002, …) restarts per tenant tuple so
 * each client/branch has its own numbering series.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hiring_requests', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            // Auto-generated HRQ-### per tenant.
            $table->string('code', 20)->nullable()->index();

            // ── Section 1 — Request Basics ─────────────────────────────
            $table->string('title', 191);
            $table->string('job_role', 191);
            $table->unsignedBigInteger('department_id')->nullable()->index();
            $table->string('team', 100)->nullable();
            // The form lets the requester type their own name (typically the
            // logged-in user) — kept as a free string so it survives even if
            // the linked user account is later deleted.
            $table->string('requested_by_name', 150)->nullable();
            $table->date('request_date')->nullable();

            // ── Section 2 — Hiring Need ────────────────────────────────
            $table->unsignedInteger('openings')->default(1);
            $table->string('employment_type', 30)->nullable(); // Full-time / Part-time / Contract / Intern
            $table->string('work_mode', 30)->nullable();        // Onsite / Remote / Hybrid / Flexible
            $table->string('urgency', 20)->default('Medium');   // Low / Medium / High / Critical

            // ── Section 3 — Role Details ───────────────────────────────
            $table->text('job_description')->nullable();
            $table->text('daily_responsibilities')->nullable();
            $table->string('required_skills', 255)->nullable();
            // 0-1, 1-3, 3-5, 5-8, 8+ — kept as a string so the front-end's
            // human-readable labels stay verbatim.
            $table->string('required_experience', 30)->nullable();
            $table->string('required_qualification', 100)->nullable();
            $table->string('preferred_profile', 191)->nullable();

            // ── Section 4 — Business Justification ─────────────────────
            $table->string('request_type', 50)->nullable();    // New Position / Backfill / …
            $table->text('business_justification')->nullable();
            $table->text('hiring_need_reason')->nullable();
            $table->text('current_team_gap')->nullable();
            $table->text('what_if_not_filled')->nullable();

            // Target join date — read-only on the form right now (the list
            // shows it), so the column is nullable and gets populated when
            // we add the date picker to the form later.
            $table->date('target_join_date')->nullable();

            // ── Lifecycle ──────────────────────────────────────────────
            // Draft → user clicked Save as Draft.
            // Submitted → form successfully submitted, awaiting HR review.
            // Under Review → HR is actively triaging.
            // Approved / Sent Back / Rejected → HR's outcome.
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
