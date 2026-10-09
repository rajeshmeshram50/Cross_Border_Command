<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · SPI line items — Stage 02, the 3-way match.
 *
 *   qty_pi   what the proforma invoice promised
 *   qty_po   what the purchase order ordered
 *   qty_spi  what the supplier actually billed
 *
 * The three differ, and that difference IS the match. On a standalone invoice
 * there is no PO, so pi_item_id / po_item_id / qty_pi / qty_po are all NULL and
 * the match degrades to "what was billed".
 *
 * No client_id or branch_id: a pure line table reached only through its parent,
 * exactly like p2p_purchase_order_items, quotation_items and
 * proforma_invoice_items.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_supplier_invoice_items', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('supplier_invoice_id')->index();
            $t->unsignedSmallInteger('line_no');

            // NULL on a standalone invoice, or on a line the supplier billed
            // that the PO never ordered.
            $t->unsignedBigInteger('pi_item_id')->nullable()->index();
            $t->unsignedBigInteger('po_item_id')->nullable()->index();
            $t->unsignedBigInteger('product_id')->index();

            $t->text('description')->nullable();
            $t->string('hsn_code', 20)->nullable();
            $t->string('uom', 20)->nullable();

            $t->decimal('qty_pi', 14, 3)->nullable();
            $t->decimal('qty_po', 14, 3)->nullable();
            $t->decimal('qty_spi', 14, 3);          // always present — this is the invoice
            $t->decimal('po_line_total', 15, 2)->nullable();

            /* extra_qty is added by 2026_10_09_000013, not here: this table had
               already been migrated by the time it was agreed, and a column
               added to a create that has run is a column that never appears. */

            $t->decimal('rate', 15, 4)->default(0);
            $t->decimal('taxable_amount', 15, 2)->default(0);

            /* NULL, not 0, on an international invoice: a foreign supplier
               charges no Indian GST. NULL means "does not apply"; 0 would mean
               "charged at zero rate" — a different fact. Matches
               p2p_purchase_order_items, where all four are nullable. */
            $t->decimal('gst_pct', 5, 2)->nullable();
            $t->decimal('cgst_amount', 15, 2)->nullable();
            $t->decimal('sgst_amount', 15, 2)->nullable();
            $t->decimal('igst_amount', 15, 2)->nullable();

            $t->decimal('line_total', 15, 2)->default(0);

            $t->timestamps();
            $t->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_supplier_invoice_items');
    }
};
