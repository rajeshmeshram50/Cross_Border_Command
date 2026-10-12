<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · PO fulfilment ledger — how much of each PO line each SPI has invoiced.
 *
 * One PO line can be invoiced by many SPIs over time. Editing an old SPI
 * APPENDS a correction (change_qty -5) rather than rewriting the rows after it,
 * so no replay is ever needed and every row keeps what was true when it was
 * written.
 *
 * AUDIT ONLY. Nothing in the live flow reads this table. Open quantity is
 * computed from the live items —
 *
 *     poi.quantity - SUM(sii.qty_spi)  WHERE sii.deleted_at IS NULL
 *
 * — exactly as PurchaseOrderController::piHolders() already computes what a PI
 * line has committed, with p2p_po_item_qty_histories sitting beside it purely
 * for history. Two sources for one number is how they drift; this one is never
 * the source.
 *
 * A row exists only for a MAPPED line. A standalone invoice, or a line the
 * supplier billed that the PO never ordered, writes nothing here and therefore
 * consumes no PO quantity.
 *
 * Append-only: created_at only, no updated_at and no deleted_at. A history row
 * describes a moment; if it can be edited it is not history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_po_fulfilments', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable();

            $t->unsignedBigInteger('purchase_order_id')->index();
            $t->unsignedBigInteger('purchase_order_item_id')->index();
            $t->unsignedBigInteger('product_id')->nullable();   // snapshot, parity with p2p_po_item_qty_histories

            $t->unsignedBigInteger('supplier_invoice_id')->index();
            // NULL when a whole SPI is cancelled rather than one line.
            $t->unsignedBigInteger('supplier_invoice_item_id')->nullable();

            $t->enum('event', ['invoiced', 'revised', 'cancelled']);

            $t->decimal('po_qty', 14, 3);                       // the PO line quantity at that moment
            $t->decimal('previous_qty', 14, 3)->nullable();     // NULL on the first invoiced row
            $t->decimal('current_qty', 14, 3);
            $t->decimal('change_qty', 14, 3);                   // current - previous, SIGNED
            // Pending AS IT STOOD THEN. Named "after" so nobody reads the
            // latest row as the live figure.
            $t->decimal('pending_after', 14, 3);

            $t->unsignedBigInteger('changed_by')->nullable();
            $t->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_po_fulfilments');
    }
};
