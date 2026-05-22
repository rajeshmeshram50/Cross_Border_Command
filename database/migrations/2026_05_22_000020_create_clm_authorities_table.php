<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Authority master.
 *
 * Issuing / certifying bodies (FSSAI, DGFT, BIS, CDSCO, RBI, …) referenced
 * by every downstream document master (KYC, DD, Trade Licences, QC). The
 * CLM-Master.html prototype seeded 12 of these; we keep that list as the
 * default but each tenant maintains their own copy so private/regional
 * authorities can be added.
 *
 * Tenant-scoped via client_id (same pattern as clm_segments). Code follows
 * the legacy `AUTH-001` sequence per tenant; the controller auto-allocates
 * it under a row lock at insert time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_authorities', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // AUTH-001 (zero-padded, scoped to client)
            $table->string('name', 255);         // FSSAI, DGFT, BIS, …
            $table->string('description', 500);  // Long form (Food Safety & Standards Authority of India)

            $table->string('status', 16)->default('active');  // active | inactive

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_authorities');
    }
};
