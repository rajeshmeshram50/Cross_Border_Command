<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Quality & Compliance Documents master.
 *
 * Quality / regulatory certificates (ISO 9001, HACCP, GOTS, CE, WHO-GMP,
 * BIS, RoHS, REACH, …). Carries richer metadata than KYC/DD/TL — purpose,
 * QA testing parameters, minimum acceptance criteria, and a
 * cert/compliance-doc type discriminator — because the Document Control
 * Panel surfaces these alongside the others but compliance reviewers also
 * read them in isolation.
 *
 * `issued_by` stores the authority name as free text (same reasoning as KYC).
 * `type` is either 'cert' (formal certificate) or 'comp' (compliance doc).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_qc_documents', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // QC-001
            $table->string('name', 255);         // ISO 9001, HACCP Certification, …
            $table->string('purpose', 500);      // Short one-liner
            $table->string('issued_by', 255);    // FSSAI, BIS, CDSCO, …
            $table->string('doc_type', 16)->default('cert');  // cert | comp

            $table->text('qa_params')->nullable();        // Free text — testing parameters
            $table->text('min_criteria')->nullable();     // Free text — minimum acceptance criteria

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'doc_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_qc_documents');
    }
};
