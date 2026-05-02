<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Documents uploaded during the Stage 2 (Document Management) onboarding step.
 *
 * The frontend ships a fixed catalogue of document keys (aadhaar, pan,
 * photo, ssc, hsc, grad, pg, cheque, cur_addr, perm_addr, exp_letter,
 * rel_letter, salary_slips, offer_letter, …). One row per
 * (employee_id, document_key) — re-uploading replaces the file but keeps
 * the same row so verify/reject metadata follows the document, not the
 * latest upload.
 *
 * Verification lifecycle (`status`):
 *   pending   → no upload yet (default — also implied by row absence)
 *   uploaded  → file present, awaiting HR review
 *   verified  → HR confirmed authenticity
 *   rejected  → HR rejected; `rejection_reason` carries the why
 *
 * Tenant scope (`client_id` + `branch_id`) is denormalised so the list
 * query stays fast without joining through employees on every page.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_documents', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // Catalogue key. Loose string instead of an enum so the
            // frontend catalogue can grow without DB migrations.
            $table->string('document_key', 60)->index();

            // File metadata. `file_path` is the public-disk relative path
            // (e.g. employee-documents/12/aadhaar-1714579200.pdf).
            $table->string('file_path', 500)->nullable();
            $table->string('original_name', 255)->nullable();
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();

            $table->enum('status', ['pending', 'uploaded', 'verified', 'rejected'])
                  ->default('uploaded');
            $table->text('rejection_reason')->nullable();

            // Provenance
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->timestamp('uploaded_at')->nullable();
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->timestamp('verified_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            // One slot per catalogue key per employee — re-upload UPDATEs.
            $table->unique(['employee_id', 'document_key'], 'employee_documents_emp_key_unique');
            $table->index(['client_id', 'branch_id', 'status'], 'employee_documents_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_documents');
    }
};
