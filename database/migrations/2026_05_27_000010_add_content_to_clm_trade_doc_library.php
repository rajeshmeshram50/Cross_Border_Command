<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persist the Draft Editor's rich-text body on each library row so the
 * Step 2 content survives Save → re-open → Edit. Nullable + long-text so
 * existing rows stay valid and we have room for placeholder-laden HTML.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->longText('content')->nullable()->after('file_path');
        });
    }

    public function down(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->dropColumn('content');
        });
    }
};
