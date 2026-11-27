<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->string('document_type', 16)->nullable()->after('regulatory_status');
            $table->index(['client_id', 'segment_id', 'document_type']);
        });
    }

    public function down(): void
    {
        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->dropIndex(['client_id', 'segment_id', 'document_type']);
            $table->dropColumn('document_type');
        });
    }
};
