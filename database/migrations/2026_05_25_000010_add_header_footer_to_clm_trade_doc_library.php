<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Trade Document Draft → Step 2 now renders the rich-text editor inside a
 * page-style preview with a fixed-height header (logo + title + subtitle)
 * and a fixed-height footer (text + page number). Persist those two zones
 * as JSON so the frontend can render them independently — same pattern
 * `hr_document_templates` uses.
 *
 *   header_config: { logo_path, title, subtitle, align, background, text_color, show_logo, show_title, logo_pos, title_pos, logo_height }
 *   footer_config: { text, align, background, text_color, show_page_number, page_number_align, page_number_format }
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->json('header_config')->nullable()->after('content');
            $table->json('footer_config')->nullable()->after('header_config');
        });
    }

    public function down(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->dropColumn(['header_config', 'footer_config']);
        });
    }
};
