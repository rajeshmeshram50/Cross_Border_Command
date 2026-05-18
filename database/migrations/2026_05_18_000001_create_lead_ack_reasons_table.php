<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Lead Acknowledgement Master.
 *
 * One row per (client, opportunity_type, reason). The three opportunity
 * types — qualified / disqualified / clarity_pending — drive the three
 * tabs on the Lead Acknowledgement Master page. `dq_status` is only set
 * for the disqualified type (positive vs. negative — does this reason
 * leave the door open for re-engagement or is it a hard no?).
 *
 * Multi-tenant scope via `client_id`; everything cascades on tenant delete.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_ack_reasons', function (Blueprint $table) {
            $table->id();

            // Tenant scope — same FK pattern other masters use. Sub-branches
            // share their client's master data, so branch_id is intentionally
            // omitted: a consignee/customer-facing lead reason belongs to the
            // org, not a single branch.
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            // qualified | disqualified | clarity_pending — string column instead
            // of MySQL ENUM so future categories can be added without ALTER.
            $table->string('opportunity_type', 24);

            // Reason text. UI caps at 500 chars (textarea maxlength); store the
            // same upper bound at the DB to catch any non-UI client.
            $table->string('reason', 500);

            // active | inactive — the trash icon flips to inactive rather than
            // hard-delete, matching the source design (mark inactive). Hard
            // delete is reserved for the destroy endpoint / admin cleanup.
            $table->string('status', 16)->default('active');

            // positive | negative — nullable; only meaningful for the
            // disqualified type. Application-layer validation enforces "set
            // for disqualified, null for the other two".
            $table->string('dq_status', 16)->nullable();

            // Audit trail — who created / last edited the row.
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            // Hot path: list reasons of one type for one tenant, filtered by status.
            $table->index(['client_id', 'opportunity_type', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_ack_reasons');
    }
};
