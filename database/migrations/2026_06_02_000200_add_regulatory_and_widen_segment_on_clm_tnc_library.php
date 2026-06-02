<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * T&C Library → regulatory tier + multi-segment support.
 *
 *  - `regulatory` ('highly' | 'less') mirrors clm_segments.regulatory_status.
 *    Highly-regulated T&Cs map to ONE segment; less-regulated T&Cs may map
 *    to MULTIPLE segments (stored as a CSV in `segment`, like the agreement
 *    library does).
 *  - `segment` widened 64 → 1024 to hold the comma-separated segment list.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_tnc_library', function (Blueprint $table) {
            // Widen to hold a CSV of segment names for the "less" tier.
            $table->string('segment', 1024)->default('General')->change();
            // Default existing single-segment rows to the "highly" tier
            // (one segment each), matching the new form's default.
            $table->string('regulatory', 16)->default('highly')->after('segment');
        });
    }

    public function down(): void
    {
        Schema::table('clm_tnc_library', function (Blueprint $table) {
            $table->dropColumn('regulatory');
            $table->string('segment', 64)->default('General')->change();
        });
    }
};
