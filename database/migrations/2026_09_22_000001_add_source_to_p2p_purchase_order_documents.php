<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stage 04 documents are no longer two fixed rows: they are built from the CLM
 * Trade Document / Agreement libraries that apply to the PO's product segments.
 * These columns record where a row came from, so a re-submit never duplicates a
 * document and the screen can group them into its two tabs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            // Which library the row came from; null for the Purchase Order itself.
            $t->enum('source_type', ['trade', 'agreement'])->nullable()->after('doc_kind');
            $t->unsignedBigInteger('source_id')->nullable()->after('source_type');
            // The library's own sub-title (doc type / agreement type), shown under the name.
            $t->string('doc_sub', 150)->nullable()->after('name');

            // One row per library document per PO. Postgres allows many NULLs,
            // so the Purchase Order row is unaffected.
            $t->unique(['purchase_order_id', 'source_type', 'source_id'], 'p2p_po_doc_source_unique');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->dropUnique('p2p_po_doc_source_unique');
            $t->dropColumn(['source_type', 'source_id', 'doc_sub']);
        });
    }
};
