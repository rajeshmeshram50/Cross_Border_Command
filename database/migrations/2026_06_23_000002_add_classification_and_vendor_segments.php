<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Supplier (Vendor) form completion — two gaps that were UI-only:
 *
 *  1. classification_id on vendors → "Classification & Flags" now persists
 *     as a FK to the shared master_customer_classifications master, matching
 *     how every other supplier dropdown (vendor_type_id, risk_level_id, …)
 *     is stored.
 *
 *  2. vendor_segments join table → "Supplier Segment" is a multi-select, so
 *     a vendor can carry more than one CLM segment. The legacy scalar
 *     vendors.segment_id is kept as the primary/first segment for backward
 *     compatibility (CLM segment rules read it); the full set lives here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            if (!Schema::hasColumn('vendors', 'classification_id')) {
                $table->foreignId('classification_id')
                    ->nullable()
                    ->after('compliance_behaviour_id')
                    ->constrained('master_customer_classifications')
                    ->nullOnDelete();
            }
        });

        Schema::create('vendor_segments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();
            $table->foreignId('segment_id')->constrained('clm_segments')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['vendor_id', 'segment_id']);
            $table->index('segment_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_segments');

        Schema::table('vendors', function (Blueprint $table) {
            if (Schema::hasColumn('vendors', 'classification_id')) {
                $table->dropConstrainedForeignId('classification_id');
            }
        });
    }
};
