<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-document page setup for CTC agreements — currently just the left/right
 * margin.
 *
 * The PDF hardcoded `@page { margin-left: 25px; margin-right: 25px }`, so a
 * drafter had no way to widen or tighten a document, and the editor could not
 * show the true text column either. Its own column rather than a key inside
 * header_config: a page margin is not a property of the header, and folding it
 * in there would make the header payload mean two different things.
 *
 * Shape: {"margin_x": 25}. Left as JSON so the next page setting (top/bottom,
 * paper size, orientation) does not need another migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->json('page_config')->nullable()->after('footer_config');
        });
    }

    public function down(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->dropColumn('page_config');
        });
    }
};
