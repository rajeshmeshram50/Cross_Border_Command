<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Round-trip DOCX storage on each library row. `docx_path` is the
 * storage-relative path to the user-uploaded Word file (matches the
 * pattern used by hr_document_templates), `docx_original_name` keeps
 * the filename the user saw locally so re-download preserves it. Both
 * nullable so existing rows stay valid.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->string('docx_path', 500)->nullable()->after('content');
            $table->string('docx_original_name', 255)->nullable()->after('docx_path');
        });
    }

    public function down(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->dropColumn(['docx_path', 'docx_original_name']);
        });
    }
};
