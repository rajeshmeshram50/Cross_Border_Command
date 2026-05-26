<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Polymorphic doc-type support for clm_signature_requests.
 *
 *   document_type = 'trade_doc'  (default) → trade_doc_ids reference clm_trade_doc_library
 *   document_type = 'agreement'            → trade_doc_ids reference clm_agreement_library
 *
 * Also adds a `lead_id` association so the agreement send flow from the
 * Sales Matrix lead detail can scope requests back to the originating
 * opportunity without scanning metadata JSON.
 */
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
