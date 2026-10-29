<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · A payment may be released against a Direct SPI, not only a PO.
 *
 * Separate from 000001 only because that one had already run by the time this
 * part was written. It belongs to the same feature.
 *
 * p2p_po_payment_requests ALREADY carries supplier_invoice_id — it was added
 * to record WHICH invoice a release was for, while the money still moved on
 * the order ("The money still moves on the PURCHASE ORDER: the ceiling stays
 * po.grand_total - po.tds_amount"). That is why the per-invoice history
 * already works. What it cannot do is exist without an order, because
 * purchase_order_id is NOT NULL — and a Direct SPI has none.
 *
 * p2p_po_payments gets the invoice id as well. It could be reached one join
 * away through payment_request_id, but a payment is the row finance
 * reconciles against, and making it depend on its request to say which
 * invoice it settled is a join that gets forgotten in a report.
 *
 * Exactly one of the two ids is set on any row. No CHECK constraint saying
 * so — this project does not use them, and the controller is the only writer.
 *
 * Nullable, no foreign keys, per the house rules. Indexed because finance
 * looks payments up by the invoice they settled.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable()->change();
        });

        Schema::table('p2p_po_payments', function (Blueprint $t) {
            $t->unsignedBigInteger('supplier_invoice_id')->nullable()->after('purchase_order_id');
            $t->index('supplier_invoice_id');
        });

        /* Separate statement: the column being altered is the one the table
           was keyed on, and some drivers dislike an add and a change sharing
           a blueprint. */
        Schema::table('p2p_po_payments', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        /* A Direct SPI's payment rows have no purchase_order_id to restore,
           so they cannot survive the column going back to NOT NULL. Dropping
           the column that identified them is the honest outcome: the table
           has nowhere to put them again. */
        Schema::table('p2p_po_payments', function (Blueprint $t) {
            $t->dropIndex(['supplier_invoice_id']);
            $t->dropColumn('supplier_invoice_id');
        });

        Schema::table('p2p_po_payments', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable(false)->change();
        });

        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable(false)->change();
        });
    }
};
