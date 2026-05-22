<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Document Control Panel · Segment Rules.
 *
 * One row per (segment × regulatory tier) configuration. Stores the doc
 * requirements as a single JSON blob in the shape
 *   {
 *     "kyc": { "KYC-001": "M" | "O", ... },
 *     "dd":  { "DD-001":  "M" | "O", ... },
 *     "tl":  { "TL-001":  "M" | "O", ... },
 *     "td":  { "TD-001":  "M" | "O", ... },
 *     "qc":  { "QC-001":  "M" | "O", ... }
 *   }
 *
 * JSON keeps the schema flexible as new doc categories appear and avoids
 * a 6-table join just to compute requirement counts. Numeric aggregates
 * (mandatory_count, optional_count) are denormalised at write time so the
 * Segment Rules table can render badges without re-parsing the JSON on
 * every row.
 *
 * `auths_json` mirrors the auto-mapped authority list from the prototype
 * (segment → list of AUTH-NNN codes); also persisted as JSON so changes
 * to the lookup don't break older rules.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_segment_rules', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('segment_id')->nullable()->constrained('clm_segments')->nullOnDelete();
            $table->string('segment_code', 16);   // Snapshot so the row survives segment renames

            $table->string('rule_code', 16);      // SR-NNN
            $table->string('regulatory_status', 16);  // highly | less
            $table->json('auths_json')->nullable();   // Authority codes auto-mapped at save time
            $table->json('doc_selections');           // The big payload (see header comment)

            $table->unsignedInteger('mandatory_count')->default(0);
            $table->unsignedInteger('optional_count')->default(0);

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'rule_code']);
            $table->index(['client_id', 'segment_id']);
            $table->index(['client_id', 'regulatory_status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_segment_rules');
    }
};
