<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · A purchase order number is unique within its BRANCH, not the client.
 *
 * PO codes were one sequence per client, so a branch's numbering counted every
 * other branch's orders: raise PO/2026-27/001 in Pune and Mumbai's first order
 * of the year came out PO/2026-27/002. A number that skips reads as a lost
 * document, and the gaps let one branch infer how much the others were buying
 * (QA #15).
 *
 * Every other per-branch code here already works this way — emp_code,
 * vendor_code, customer_code, and the inventory WH-/ZN-/RC- codes — so the
 * index moves to (client_id, branch_id, code) to match.
 *
 * EXISTING CODES ARE LEFT ALONE. A PO number is an external reference: it is
 * printed, emailed to the supplier and quoted back on their invoice, so
 * renumbering one after the fact breaks a document somebody else holds. The
 * allocator takes the highest number IN THE BRANCH and carries on from there,
 * which means a branch that was pushed up to 018 by its neighbours keeps
 * going at 019 while a new branch starts at 001. The two never collide again.
 *
 * A null branch_id is its own slot, which Postgres treats as distinct from any
 * value — that is the client-wide PO a user without a branch raises, and it
 * keeps numbering off the client as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->dropUnique('p2p_purchase_orders_client_id_code_unique');
            $t->unique(['client_id', 'branch_id', 'code'], 'p2p_purchase_orders_code_unique_per_branch');
        });
    }

    /**
     * Reversible only while no two branches share a code. Once branch 4 holds a
     * PO/2026-27/001 that branch 3 also holds, the client-wide index cannot be
     * rebuilt — which is the point of the change, so this will refuse rather
     * than delete one of them.
     */
    public function down(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->dropUnique('p2p_purchase_orders_code_unique_per_branch');
            $t->unique(['client_id', 'code'], 'p2p_purchase_orders_client_id_code_unique');
        });
    }
};
