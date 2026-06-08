<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Brings the Trade Document Library in line with the Agreement Library form:
 * trade documents can now carry a regulatory tier (highly / less) and the
 * segment(s) they apply to (CSV, mirroring clm_agreement_library.segment).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            // 'less' default keeps every existing row on the less-regulated
            // tier (the agreement library uses the same default).
            $table->string('regulatory', 16)->default('less')->after('party');
            // CSV of segment names — single value for high-reg, comma-joined
            // for less-reg multi-select. Null = applies to all standard segments.
            $table->string('segment')->nullable()->after('regulatory');
        });
    }

    public function down(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->dropColumn(['regulatory', 'segment']);
        });
    }
};
