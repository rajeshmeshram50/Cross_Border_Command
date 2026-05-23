<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Trade Documents → Send for Signature (Zoho Sign).
 *
 * One row per e-signature request the user fires from a Customer / Consignee /
 * Vendor record. A single request can bundle up to 10 Trade Document drafts
 * (Zoho returns one signing session for the recipient covering all of them) —
 * the primary draft id is kept in `trade_doc_id` for backward compatibility,
 * and the full list lives in `trade_doc_ids`.
 *
 * Tenant-scoped by `client_id` + `branch_id` so the [[project_branch_hierarchy]]
 * visibility rules (sub-branches can't read each other) apply to the signature
 * tracker the same way they apply to the customers/drafts the request was
 * built from.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_signature_requests', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // Primary draft (kept for one-doc convenience joins) + the full
            // multi-doc array — both populated even for single-doc sends so
            // downstream code only has to look at one shape.
            $table->unsignedBigInteger('trade_doc_id');
            $table->json('trade_doc_ids');
            $table->json('document_names');
            $table->json('zoho_document_ids')->nullable();

            // Polymorphic party — 'Customer' for v1; structure left open so
            // Consignee/Vendor flows can reuse the table without a migration.
            $table->string('model_name', 32);
            $table->unsignedBigInteger('party_id');

            $table->string('zoho_request_id')->nullable()->index();
            $table->string('request_name');
            // draft | inprogress | completed | declined | recalled | expired
            $table->string('status', 32)->default('draft')->index();

            $table->json('signers');
            $table->json('signing_urls')->nullable();

            $table->timestamp('expiry_date')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('declined_at')->nullable();
            $table->text('decline_reason')->nullable();
            $table->timestamp('recalled_at')->nullable();
            $table->text('recall_reason')->nullable();

            // signed_document_path is the legacy single-file pointer; the
            // multi-doc list lives in signed_document_paths. Both filled on
            // download so the frontend can use whichever shape it prefers.
            $table->string('signed_document_path', 500)->nullable();
            $table->json('signed_document_paths')->nullable();
            $table->string('certificate_path', 500)->nullable();

            // Free-form bag for sig-coord overrides, party snapshot, the
            // "sent_at" timestamp etc. — same role as in [[New_IDIMS_6.0]].
            $table->json('metadata')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('last_reminder_sent_at')->nullable();
            $table->unsignedInteger('reminder_count')->default(0);

            $table->timestamps();
            $table->softDeletes();

            $table->index(['model_name', 'party_id']);
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_signature_requests');
    }
};
