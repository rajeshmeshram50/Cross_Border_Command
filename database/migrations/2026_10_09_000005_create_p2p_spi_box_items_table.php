<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Box contents — which SPI item, and how much of it, sits in each box.
 *
 * This table IS the packing tracker. Packed quantity is never stored on the
 * item; it is SUM(quantity) here, and pending is qty_spi minus that sum. Every
 * such sum MUST exclude soft-deleted rows, or a removed box still counts as
 * packed and the item reads fully packed when it is not.
 *
 * Advanced Details (serial / lot / batch / cat / expiry / mfg) and the product
 * remark live HERE, not on the box: one carton can hold two products from two
 * batches with two expiry dates, which a single set of fields on the box could
 * not represent.
 *
 * The index that makes the packed-quantity sum an index-only scan cannot be
 * expressed by Laravel's schema builder, so it is raw SQL below.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_box_items', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('box_id')->index();
            $t->unsignedBigInteger('supplier_invoice_item_id')->index();
            $t->decimal('quantity', 14, 3);

            // Per product row, as the prototype keys the toggle on the row not
            // the box. Binary and not user-definable, so it stays a column.
            $t->boolean('is_stackable')->default(true);

            // What was received, per product — a box can hold one correct item
            // and one damaged one.
            $t->enum('remark', ['correct', 'damaged', 'mismatched', 'extra'])->default('correct');
            $t->text('remark_note')->nullable();

            /* Product flags (Hazardous, Cold Chain, Regulated, Fragile, and
               whatever a tenant adds) as an array of master ids. A column, not
               a junction table, because the flag master is not being built yet
               and the ids are already managed this way elsewhere. The trade-off
               is that "every box item flagged Cold Chain" cannot be indexed —
               it means scanning the column. */
            $t->json('flags')->nullable();

            // Advanced Details — optional, and per batch.
            $t->string('serial_no', 60)->nullable();
            $t->string('lot_no', 60)->nullable();
            $t->string('batch_no', 60)->nullable();
            $t->string('cat_no', 60)->nullable();
            $t->date('expiry_date')->nullable();
            $t->date('mfg_date')->nullable();

            $t->timestamps();
            $t->softDeletes();
        });

        /* Packed quantity is summed on supplier_invoice_item_id, so that column
           carries a partial covering index: the summed value lives in the index
           (INCLUDE), and soft-deleted rows are left out of it entirely. Laravel's
           builder cannot express WHERE or INCLUDE. */
        DB::statement(
            'CREATE INDEX idx_spi_box_items_packed ON p2p_spi_box_items '
            . '(supplier_invoice_item_id) INCLUDE (quantity) WHERE deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_box_items');
    }
};
