<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Stage 2 (Lead Acknowledgement) activity log.
 *
 * Append-only history of qualification touchpoints on a lead. One row
 * per (lead, master reason) submission — duplicates are allowed across
 * time (the legacy IDIMS schema explicitly dropped its unique constraint
 * so the same reason can be re-applied days later), but a `id ASC` scan
 * gives the chronological story for the Activity Report card.
 *
 * `opportunity_type` is denormalized off lead_ack_reasons so:
 *   - "latest type" lookups for the Save & Next gate are a single
 *     index scan instead of a join,
 *   - the master reason can be edited / inactivated later without
 *     rewriting historical rows.
 *
 * `reason_snapshot` captures the master text at write time for the same
 * resilience reason — the Activity Report always shows what the user
 * actually picked, even if the master reason is later renamed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_acknowledgements', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();
            $table->foreignId('lead_ack_reason_id')
                  ->constrained('lead_ack_reasons')
                  ->restrictOnDelete();

            // Denormalized from the master at write time — see header.
            $table->string('opportunity_type', 32);       // qualified / disqualified / clarity_pending
            $table->string('dq_status', 16)->nullable();  // positive / negative (only for disqualified rows)
            $table->string('reason_snapshot', 500);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // Fast "latest activity for a lead" lookup.
            $table->index(['lead_id', 'id']);
            $table->index(['client_id', 'lead_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_acknowledgements');
    }
};
