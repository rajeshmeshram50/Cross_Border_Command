<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Agreement Library — Stage 2 page-shell config columns.
 *
 * Mirrors the same pair on clm_trade_doc_library so the agreement wizard
 * can wrap its draft editor in the shared HeaderFooterPanel and the PDF
 * renderer can honour per-row logo / title / subtitle / footer settings.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            $table->json('header_config')->nullable()->after('docx_original_name');
            $table->json('footer_config')->nullable()->after('header_config');
        });
    }

    public function down(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            $table->dropColumn(['header_config', 'footer_config']);
        });
    }
};
