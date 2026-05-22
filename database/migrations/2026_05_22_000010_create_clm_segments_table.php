<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Segment master.
 *
 * Ported from the CLM-Master.html prototype (lines ~680-830). One row per
 * trade / business segment (Tobacco, Rice, Food Grade Ethanol, …) with
 * its regulatory classification and whether the buyer can differ from
 * the consignee on shipments in that segment.
 *
 * `code` follows the legacy S-001 / S-002 sequence — auto-generated per
 * client at insert time by ClmSegmentController so each tenant has its
 * own zero-padded counter starting at 001.
 *
 * Tenant-scoped via client_id (mirrors the master_* tables). A composite
 * UNIQUE on (client_id, code) prevents the counter from accidentally
 * producing duplicates if two requests race on insert.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_segments', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // S-001 (zero-padded, scoped to client)
            $table->string('name', 255);         // Tobacco, Rice, Food Grade Ethanol, …

            // Regulatory tier — drives the All / Highly Regulated / Less
            // Regulated tab buckets on the listing page.
            $table->string('regulatory_status', 16);    // 'highly' | 'less'

            // Whether the consignee on a shipment is allowed to differ
            // from the named buyer for products in this segment.
            $table->string('buyer_consignee', 16);      // 'allowed' | 'not_allowed'

            $table->string('status', 16)->default('active');  // active | inactive

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'regulatory_status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_segments');
    }
};
