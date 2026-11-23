<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->enum('source_type', ['trade', 'agreement'])->nullable()->after('doc_kind');
            $t->unsignedBigInteger('source_id')->nullable()->after('source_type');
            $t->string('doc_sub', 150)->nullable()->after('name');

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
