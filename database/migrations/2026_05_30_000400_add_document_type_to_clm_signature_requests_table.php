<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_signature_requests', function (Blueprint $table) {
            $table->string('document_type', 32)->default('trade_doc')->index()->after('branch_id');
            $table->foreignId('lead_id')->nullable()->after('document_type')
                  ->constrained('leads')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('clm_signature_requests', function (Blueprint $table) {
            $table->dropForeign(['lead_id']);
            $table->dropColumn(['document_type', 'lead_id']);
        });
    }
};
