<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · The codes raised under a purchase order are unique within its BRANCH.
 *
 * 2026_10_13_000003 moved the PO number itself; this follows the three codes
 * issued beneath it, which were all still one sequence per client:
 *
 *   ADR/<FY>/<SEQ>  advance refund adjustment
 *   DOC/<FY>/<SEQ>  purchase order document
 *   PRQ-###         payment request
 *
 * Each is raised on one office's order and settled in that office, so counting
 * another branch's rows only skips numbers and lets each branch read how busy
 * the others are — the same complaint as the PO number (QA #15).
 *
 * Existing codes are left where they are, for the same reason: a refund
 * adjustment and a payment request are quoted back by number in email. The
 * allocator takes the highest number IN THE BRANCH and carries on.
 *
 * PAYMENT REQUESTS GET THEIR FIRST UNIQUE INDEX. They never had one — not even
 * client-wide — so nothing but the lock stood between two saves and the same
 * PRQ-001, and a lock is only as good as the next caller that forgets it.
 * Numbering per branch without an index is how duplicates arrive quietly.
 */
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
