<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Step 3 of the wizard now renders a page-style preview with a FIXED-height
 * header (logo + title) and a fixed-height footer (text) around the
 * Tiptap-edited body. Persist those two zones as JSON so the frontend can
 * render them independently and the DOCX exporter can embed them.
 *
 *   header_config: { logo_path, title, subtitle, align, background, text_color, show_logo }
 *   footer_config: { text, align, background, text_color }
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_document_templates', function (Blueprint $table) {
            $table->json('header_config')->nullable()->after('content_html');
            $table->json('footer_config')->nullable()->after('header_config');
        });
    }

    public function down(): void
    {
        Schema::table('hr_document_templates', function (Blueprint $table) {
            $table->dropColumn(['header_config', 'footer_config']);
        });
    }
};
