<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per "document instance" — the moment an admin clicks Send on a
 * template in the Evidence Vault, we freeze a snapshot (content + header +
 * footer) and create a workflow run. Each signer's state lives inside the
 * `signers` JSON column; the audit log is a JSON array of events on the
 * row itself so we don't need a separate join table for the MVP.
 *
 * Workflow status:
 *   Pending     — sent, no signer has acted yet
 *   In Progress — at least one signer has acted, more to go
 *   Completed   — every signer satisfied (each step's action was taken)
 *   Rejected    — a signer rejected; workflow halts
 *   Cancelled   — sender cancelled the run
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_document_signatures', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->unsignedBigInteger('template_id')->index();
            $table->unsignedBigInteger('employee_id')->index();   // subject of the doc
            $table->string('code', 64)->nullable()->index();      // template code + run no.

            // Snapshot of the template at send time so later edits to the
            // template can't retroactively change a signed document.
            $table->longText('content_html')->nullable();
            $table->json('header_config')->nullable();
            $table->json('footer_config')->nullable();

            // Resolved workflow — each entry mirrors a template signer:
            //   { index, action, role_name, user_id (resolved), name,
            //     status, acted_at, signed_name, note }
            $table->json('signers')->nullable();
            $table->unsignedSmallInteger('current_index')->default(0);

            $table->enum('status', ['Pending', 'In Progress', 'Completed', 'Rejected', 'Cancelled'])
                  ->default('Pending')->index();

            // Audit trail — array of { at, actor_id, actor_name, action, message, ip }
            $table->json('audit_log')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_document_signatures');
    }
};
