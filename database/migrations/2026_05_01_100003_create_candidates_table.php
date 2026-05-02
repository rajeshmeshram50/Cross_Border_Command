<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Candidates — applicants linked to a specific Recruitment requisition.
 *
 * Tenant scoping mirrors `recruitments` (client_id, branch_id) and the
 * row inherits the parent recruitment's tenant on save. CV uploads are
 * stored on the public disk under `candidates/{client_id}/{file}` and
 * the relative path is kept in `cv_path`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('candidates', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership — copied from the parent recruitment at create
            // time so list scoping works without an extra join.
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            // Parent recruitment — required, indexed (every list query filters
            // by recruitment_id first). Cascade-delete cleans up candidates
            // when a recruitment is hard-deleted, but the recruitment is
            // soft-deletes-only so this is mostly defensive.
            $table->unsignedBigInteger('recruitment_id')->index();

            // ── Section 1 — Basic Details ─────────────────────────────
            $table->string('name', 150);
            $table->string('email', 191)->nullable()->index();
            $table->string('mobile', 30)->nullable();
            $table->string('current_address', 500)->nullable();
            $table->string('qualification', 191)->nullable();
            // Decimal so 5.5 yrs / 0.5 yrs (intern) round-trip cleanly.
            $table->decimal('experience_years', 5, 2)->default(0);
            $table->string('mode_of_transport', 30)->nullable();
            $table->decimal('distance_km', 7, 2)->nullable();

            // ── Section 2 — Compensation ──────────────────────────────
            $table->decimal('current_salary_lpa', 10, 2)->nullable();
            $table->decimal('expected_salary_lpa', 10, 2)->nullable();
            // Free-form preset value (Immediate / 15 Days / 30 Days / …).
            $table->string('notice_period', 30)->nullable();

            // ── Section 3 — Source ────────────────────────────────────
            $table->string('source', 50)->nullable();

            // ── Section 4 — CV upload ─────────────────────────────────
            // Relative path on the public disk (e.g. candidates/12/cv-abc.pdf).
            // cv_url is computed at serialize-time from Storage::url(cv_path).
            $table->string('cv_path', 255)->nullable();
            $table->string('cv_original_name', 191)->nullable();

            // ── Section 5 — Pipeline status ───────────────────────────
            $table->string('status', 30)->default('Applied');
            // Captured by the Confirm Selection / Confirm Rejection modal so
            // the audit trail survives even after the row is later edited.
            $table->string('rejection_reason', 100)->nullable();
            $table->text('status_notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['recruitment_id', 'status'], 'candidates_rec_status_idx');
            $table->index(['client_id', 'branch_id', 'status'], 'candidates_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('candidates');
    }
};
