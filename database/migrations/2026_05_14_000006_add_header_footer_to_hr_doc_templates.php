<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
