<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
