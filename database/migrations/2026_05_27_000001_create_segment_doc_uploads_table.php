<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Segment-rule document uploads — polymorphic store.
 *
 * Drives the Stage 2 reference-row uploads + Stage 3 Evidence Vault for
 * Customers / Consignees / Suppliers. Each row is one uploaded file
 * attached to a specific (entity, category, doc_code) tuple.
 *
 *   uploadable_type / uploadable_id  → App\Models\Customer | Consignee | Vendor
 *   category                         → kyc | dd | tl | td | qc
 *   doc_code                         → 'DD-001', 'KYC-003', …  (the
 *                                       segment rule's auto-code; the
 *                                       dedupe key per entity)
 *
 * One file per (entity, category, doc_code) — re-uploading replaces the
 * previous row's path (the controller handles disk cleanup). The
 * UNIQUE constraint enforces this at the DB level.
 *
 * client_id rides along so the tenant scope can filter without a join
 * back through the morph relation.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('segment_doc_uploads')) {
            return;
        }
        Schema::create('segment_doc_uploads', function (Blueprint $table) {
            $table->id();
            // morphs() creates uploadable_type (string) + uploadable_id
            // (bigint) plus a composite index over both.
            $table->morphs('uploadable');
            $table->unsignedBigInteger('client_id')->index();
            // 5 categories from the segment rule. Stored as a string so
            // we can add categories later without an ALTER on an enum.
            $table->string('category', 8);
            // Segment-rule auto-code (e.g. 'DD-001'). Bounded at 32 so
            // we can index it cheaply.
            $table->string('doc_code', 32);
            // Snapshot of the doc's display name + requirement at
            // upload time. The rule master can be edited after the
            // user uploads, but we want the Evidence Vault to render
            // what they SAW, not whatever the rule says now.
            $table->string('doc_name');
            $table->char('requirement', 1)->default('O');
            $table->string('attachment_path');
            $table->string('attachment_name');
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->timestamps();

            // One file per (entity, category, doc_code) — re-upload
            // replaces. Composite key matches the morph index direction.
            $table->unique(['uploadable_type', 'uploadable_id', 'category', 'doc_code'], 'seg_uploads_unique_per_doc');
            // Tenant-scoped list queries always filter by client_id.
            $table->index(['client_id', 'uploadable_type', 'uploadable_id'], 'seg_uploads_tenant_owner_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('segment_doc_uploads');
    }
};
