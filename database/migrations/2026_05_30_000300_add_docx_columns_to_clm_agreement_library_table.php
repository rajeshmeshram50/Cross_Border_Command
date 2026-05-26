<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Agreement Library — DOCX round-trip columns.
 *
 * Mirrors the same pair on clm_trade_doc_library so the Agreement wizard's
 * editor can offer Download DOCX / Upload Word Doc with the same persistence
 * shape (path + original filename) the Trade Document editor uses.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            $table->string('docx_path', 512)->nullable()->after('content');
            $table->string('docx_original_name', 255)->nullable()->after('docx_path');
        });
    }

    public function down(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            $table->dropColumn(['docx_path', 'docx_original_name']);
        });
    }
};
