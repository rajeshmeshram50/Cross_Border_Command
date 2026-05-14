<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per document generated from an HR template for one employee.
 *
 * This is the audit trail + storage of the rendered output. Each row carries
 * the fully-resolved HTML (template content_html with every {{Token}}
 * substituted), the custom-field values the operator typed at generation
 * time, and the resolved-vars map for traceability.
 *
 * Status state machine (Phase 1 ships only Generated; Phase 2 adds the rest):
 *   Draft       — staged, not committed
 *   Generated   — rendered + stored, downloadable
 *   Sent        — emailed to the employee  (Phase 2)
 *   Viewed      — employee opened the link (Phase 2)
 *   Acknowledged — employee confirmed       (Phase 2)
 *   Signed      — e-signature collected     (Phase 2)
 *
 * Tenant scoping mirrors hr_document_templates.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_generated_documents', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->unsignedBigInteger('template_id')->index();
            $table->unsignedBigInteger('employee_id')->index();

            // The fully-rendered template HTML for this employee, with every
            // {{Token}} substituted in-place. This is what gets shown in the
            // preview, downloaded as DOCX, and (Phase 2) emailed.
            $table->longText('rendered_html')->nullable();

            // Free-form custom field values the operator entered for this
            // employee — e.g. { "LastWorkingDate": "2026-06-15", "ExitReason": "Career change" }
            // Stored verbatim for auditability and to allow re-rendering.
            $table->json('custom_values')->nullable();

            // The full resolved-token map used during render. Includes both
            // employee-derived tokens (FirstName, FullName, JoiningDate, …)
            // and the operator's custom values. Lets us reproduce the exact
            // render later for legal traceability.
            $table->json('resolved_vars')->nullable();

            $table->enum('status', ['Draft', 'Generated', 'Sent', 'Viewed', 'Acknowledged', 'Signed'])
                ->default('Generated')->index();

            $table->unsignedBigInteger('generated_by')->nullable();
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_generated_documents');
    }
};
