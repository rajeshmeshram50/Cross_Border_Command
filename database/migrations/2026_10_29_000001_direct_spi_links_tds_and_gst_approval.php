<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Everything a Direct SPI needs that the purchase order used to carry.
 *
 * One migration, because none of it has been run yet and the three pieces are
 * one feature: an invoice raised with no purchase order behind it. Splitting
 * them would only mean three things to run in order.
 *
 * ── Why any of this is needed ────────────────────────────────────────────
 * A Direct SPI is `purchase_order_id IS NULL`. Everything conditional in this
 * module keys off that, and the SupplierInvoice model says why there is no
 * second flag: "a second column saying the same thing is a second thing to
 * keep in step." But the order is also where several facts physically live,
 * and with it null they have nowhere to be read from.
 *
 * ── 1. The three links the Direct SPI setup asks for ─────────────────────
 * p2p_purchase_orders carries shipment_order_id, lead_id,
 * procurement_request_id and procurement_request_code, and the model notes
 * that the lead / shipment / procurement chips "are NOT stored here. They are
 * read through the purchase order." The setup asks, in order:
 *
 *     Step 01  shipment     — "With Shipment ID", or All Other's (none)
 *     Step 02  procurement  — every SPI belongs to a procurement case
 *     Step 03  supplier     — vendor_id, which already exists
 *
 * procurement_request_code is stored beside its id exactly as the order
 * stores it: the code is what the lists search and the sticker prints, and a
 * procurement row deleted later would otherwise take the printed reference
 * with it. 30 characters, which is what the order validates (max:30).
 *
 * READ ORDER for every consumer: own column first, then the order.
 *     $spi->shipment_order_id ?? $spi->purchaseOrder?->shipment_order_id
 * A PO-backed invoice leaves its own columns null rather than copying the
 * order's — two copies of one fact drift, and the order is the authority
 * while it exists.
 *
 * ── 2. TDS and the payment ledger ────────────────────────────────────────
 * A Direct SPI is paid directly. All six of these live on the order today,
 * and PoPaymentRequestController reads them for its ceiling
 * (po.grand_total - po.tds_amount) and writes paid_amount back on approval —
 * with no order, that chain has no subject.
 *
 * TDS IS CUT ON taxable_total, NOT grand_total: saveTds() caps the deduction
 * at TDS_MAX_PCT of the taxable base because GST is not subject to TDS, and
 * grand_total includes it. taxable_total already exists here, so only the
 * deduction and the ledger are new.
 *
 * NO "final payable" column, deliberately — it is grand_total - tds_amount,
 * and a stored third number is free to disagree with the two it comes from.
 * The purchase order stores no payable column either.
 *
 * ── 3. GST senior approval against an invoice ────────────────────────────
 * The GATE itself is NOT stored and needs no column: gstGate() computes it
 * from the supplier on demand, reading the latest vendor_gst_scrutiny row by
 * vendor_id. Picking a supplier answers it.
 *
 * The APPROVAL is a different kind of fact. requested_by -> requested_to ->
 * status -> decided_at is a decision a person made; it cannot be recomputed,
 * and losing it loses the audit trail. p2p_po_gst_approvals could only hold
 * it against an order, and purchase_order_id was NOT NULL — which is what
 * made a PO-less approval impossible to insert at all.
 *
 * ── Nullability ──────────────────────────────────────────────────────────
 * EVERY new column is nullable, including the money. A null paid_amount says
 * "nothing has been paid on this invoice yet" — true of every row that exists
 * today and of every PO-backed invoice, which keeps deducting from its order.
 * A 0.00 default would read as a ledger opened and left empty, and the two
 * would be indistinguishable.
 *
 * Zoho needs nothing: zoho_bill_id, zoho_bill_number, zoho_status, zoho_error
 * and zoho_synced_at are already on this table, and ownsZohoBill() already
 * returns isStandalone(). The sync itself is a 501 stub — code, not schema.
 *
 * No foreign keys anywhere, per the house rule. Indexes where the screens
 * look rows up.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_supplier_invoices', function (Blueprint $t) {
            /* ── 1 · what the Direct SPI setup links to ───────────────── */
            $t->unsignedBigInteger('shipment_order_id')->nullable()->after('vendor_id');
            $t->unsignedBigInteger('procurement_request_id')->nullable()->after('shipment_order_id');
            $t->string('procurement_request_code', 30)->nullable()->after('procurement_request_id');

            /* ── 2 · TDS, cut on taxable_total, and the ledger ────────── */
            $t->decimal('tds_percentage', 8, 2)->nullable()->after('grand_total');
            $t->decimal('tds_amount', 15, 2)->nullable()->after('tds_percentage');
            $t->unsignedBigInteger('tds_updated_by')->nullable()->after('tds_amount');
            $t->timestamp('tds_updated_at')->nullable()->after('tds_updated_by');
            $t->decimal('paid_amount', 15, 2)->nullable()->after('tds_updated_at');
            $t->decimal('balance_amount', 15, 2)->nullable()->after('paid_amount');

            $t->index('shipment_order_id');
            $t->index('procurement_request_id');
        });

        /* ── 3 · an approval may belong to an invoice ─────────────────── */
        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->unsignedBigInteger('supplier_invoice_id')->nullable()->after('purchase_order_id');
            $t->index('supplier_invoice_id');
        });

        /* Separate statement: the column being altered is the one the table
           was keyed on, and some drivers dislike an add and a change sharing
           a blueprint. Exactly one of the two ids is set on any row; there is
           deliberately no CHECK constraint saying so — this project does not
           use them, and one controller is the only writer. */
        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable()->change();
        });

    }

    public function down(): void
    {
        /* purchase_order_id goes back to NOT NULL, which it cannot do while
           invoice-raised rows hold a null there — so those are dropped with
           the column that identified them. A Direct SPI's approvals do not
           survive this rollback, which is the honest outcome: the table has
           nowhere to put them again. */
        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->dropIndex(['supplier_invoice_id']);
            $t->dropColumn('supplier_invoice_id');
        });

        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable(false)->change();
        });

        Schema::table('p2p_supplier_invoices', function (Blueprint $t) {
            $t->dropIndex(['shipment_order_id']);
            $t->dropIndex(['procurement_request_id']);
            $t->dropColumn([
                'shipment_order_id',
                'procurement_request_id',
                'procurement_request_code',
                'tds_percentage',
                'tds_amount',
                'tds_updated_by',
                'tds_updated_at',
                'paid_amount',
                'balance_amount',
            ]);
        });
    }
};
