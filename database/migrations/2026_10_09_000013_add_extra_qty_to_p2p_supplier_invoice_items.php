<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · SPI line — record over-supply.
 *
 * Billed BEYOND the order: the supplier shipped 40 against an order for 36 and
 * we took it. Written by the server on every save from qty_po and qty_spi,
 * never sent by the client, and 0 on a standalone invoice (no order to exceed).
 *
 * The shortfall is deliberately NOT stored — it is qty_po - qty_spi on the same
 * row, exposed as the `missing_qty` accessor, and openQtyByPoItem() already
 * answers it for the whole PO. Over-supply is the only half nothing else
 * records: the fulfilment ledger would show it as negative pending, which reads
 * as a bug rather than a fact.
 *
 * Its own migration because the create table had already run.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_supplier_invoice_items', function (Blueprint $t) {
            $t->decimal('extra_qty', 14, 3)->default(0)->after('po_line_total');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_supplier_invoice_items', function (Blueprint $t) {
            $t->dropColumn('extra_qty');
        });
    }
};
