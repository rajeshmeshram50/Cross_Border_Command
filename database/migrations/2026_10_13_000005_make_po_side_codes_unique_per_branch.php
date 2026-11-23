<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_po_refund_adjustments', function (Blueprint $t) {
            $t->dropUnique('p2p_po_refund_adjustments_client_id_code_unique');
            $t->unique(['client_id', 'branch_id', 'code'], 'p2p_po_refund_adj_code_uq_per_branch');
        });

        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->dropUnique('p2p_purchase_order_documents_client_id_code_unique');
            $t->unique(['client_id', 'branch_id', 'code'], 'p2p_po_doc_code_uq_per_branch');
        });

        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->unique(['client_id', 'branch_id', 'code'], 'p2p_po_payment_req_code_uq_per_branch');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->dropUnique('p2p_po_payment_req_code_uq_per_branch');
        });

        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->dropUnique('p2p_po_doc_code_uq_per_branch');
            $t->unique(['client_id', 'code'], 'p2p_purchase_order_documents_client_id_code_unique');
        });

        Schema::table('p2p_po_refund_adjustments', function (Blueprint $t) {
            $t->dropUnique('p2p_po_refund_adj_code_uq_per_branch');
            $t->unique(['client_id', 'code'], 'p2p_po_refund_adjustments_client_id_code_unique');
        });
    }
};
