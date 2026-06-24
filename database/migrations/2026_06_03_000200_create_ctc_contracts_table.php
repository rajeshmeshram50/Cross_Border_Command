<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CLM Operations · Without Shipment ID → Case-to-Case (CTC) Contracts.
 *
 * Backs the CTC add/drafting form plus the three operations views:
 *   - Case to Case Contracts  (full list)
 *   - Agreements We Sent       (created_by = me)
 *   - Agreements To Approve    (my email in approver_emails)
 *
 * Counterparties, the configured page header/footer, approvers and the
 * clarification thread are stored as JSON so the front-end-only prototype's
 * rich shape round-trips without a web of child tables.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ctc_contracts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 16);                       // CTC-001 (per-client sequential)
            $table->string('title', 255);
            $table->string('agreement_type', 64)->nullable();

            // "Our Organisation" (from the Company Details master)
            $table->string('org_name', 255)->nullable();
            $table->string('org_short_code', 64)->nullable();
            $table->string('org_state', 128)->nullable();
            $table->string('org_country', 128)->nullable();

            $table->json('counterparties')->nullable();        // [{name, code, country, phone, email, badge, referred}]

            $table->date('eff_date')->nullable();
            $table->date('end_date')->nullable();
            $table->boolean('auto_renewal')->default(false);
            $table->string('renewal_type', 16)->nullable();    // manual | auto

            $table->longText('content')->nullable();           // draft agreement HTML
            $table->json('header_config')->nullable();
            $table->json('footer_config')->nullable();

            $table->json('approvers')->nullable();             // [{name, email, role, mandatory}]
            $table->json('approver_emails')->nullable();       // ["ceo@…"] — queryable for "To Approve"
            $table->json('clarifications')->nullable();        // [{query, date, response, resolved}]

            $table->unsignedTinyInteger('stage')->default(1);  // 1 Drafting · 2 Review · 3 Signing · 4 Repository
            $table->string('approval_status', 24)->default('pending'); // pending | approved | rejected | clarification
            $table->string('status', 24)->default('inprogress');       // inprogress | signed | rejected (list bucket)
            $table->text('rejection_reason')->nullable();
            $table->unsignedSmallInteger('days_to_approve')->nullable();
            $table->unsignedSmallInteger('reminder_days')->nullable();
            $table->date('cp_signed_date')->nullable();

            $table->string('primary_approver_name', 255)->nullable();
            $table->string('primary_approver_email', 255)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->string('created_by_name', 255)->nullable();
            $table->timestamp('submitted_at')->nullable();

            $table->timestamps();
            $table->softDeletes();
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ctc_contracts');
    }
};
