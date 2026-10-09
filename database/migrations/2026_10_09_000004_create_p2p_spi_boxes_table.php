<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · SPI box packaging — Stage 03. One row per physical carton.
 *
 * Only what belongs to the CARTON lives here: dimensions, weights, the box's
 * own condition and its sticker. Anything that varies per product inside it —
 * remark, batch, expiry, flags, stackability — belongs on p2p_spi_box_items,
 * because one box can hold two products from two batches.
 *
 * Carries client_id and branch_id (unlike the line tables) because a box is
 * scanned by code on the warehouse floor, independently of its invoice — the
 * same reason p2p_po_payments carries both.
 *
 * box_code is sequential WITHIN THE INVOICE (BOX-01 … BOX-n), not client-wide,
 * so three SPIs created at once never interleave their numbering.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_boxes', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('supplier_invoice_id')->index();

            // s1 one product -> one box · s2 one product -> many boxes
            // s3 many products -> one box
            $t->enum('scenario', ['s1', 's2', 's3'])->default('s1');
            $t->string('box_code', 40);

            $t->decimal('length_cm', 10, 2)->nullable();
            $t->decimal('width_cm', 10, 2)->nullable();
            $t->decimal('height_cm', 10, 2)->nullable();
            $t->decimal('weight_kg', 10, 3)->nullable();
            $t->decimal('net_weight_kg', 10, 3)->nullable();
            $t->decimal('gross_weight_kg', 10, 3)->nullable();
            // Volumetric weight is NOT stored — it is L x W x H / divisor.

            // The CARTON's condition, separate from the per-product remark.
            $t->enum('condition', ['perfect', 'minor', 'major', 'severe'])->default('perfect');

            // Once set, box_code freezes: the label is physically on a carton
            // being scanned at put-away and cannot be renumbered.
            $t->timestamp('sticker_printed_at')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->unique(['supplier_invoice_id', 'box_code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_boxes');
    }
};
