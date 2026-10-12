<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Record which supplier invoice a payment request was raised against.
 *
 * The money still moves on the PURCHASE ORDER: the ceiling stays
 * po.grand_total - po.tds_amount, and approval still deducts from
 * po.paid_amount / po.balance_amount. Nothing about the existing flow changes.
 *
 * This column only records WHICH INVOICE a release was for, so the screen can
 * say "Request raised against SPI/2025-26/029", the Linked Payment Requests tab
 * can group them, and finance can answer "which invoice was this payment for?"
 * — a question the PO alone cannot answer once several SPIs sit under it.
 *
 * Nullable, because an advance is usually raised BEFORE any invoice exists and
 * has no SPI to attach to.
 *
 * Nothing is added to p2p_po_payments: it already carries payment_request_id,
 * so the invoice is one join away and a second copy would only drift.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->unsignedBigInteger('supplier_invoice_id')->nullable()->after('purchase_order_id');
            $t->index('supplier_invoice_id');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->dropIndex(['supplier_invoice_id']);
            $t->dropColumn('supplier_invoice_id');
        });
    }
};
