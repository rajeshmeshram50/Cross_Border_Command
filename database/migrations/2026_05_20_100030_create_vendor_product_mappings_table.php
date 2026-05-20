<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vendor Stage 4 — product mappings.
 *
 * One row links a vendor to a product with the purchase price + GST.
 * The amount fields are denormalised copies of the modal's auto-
 * computed totals so the list page can render the line items without
 * recomputing on every render. The `(vendor_id, product_id)` pair is
 * indexed for "products this vendor sells" lookups; uniqueness is
 * enforced at the application layer so the same product can't be
 * mapped twice per vendor (matches the modal's duplicate-mapping guard).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_product_mappings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();

            $table->string('batch_serial_lot', 128)->nullable();

            // Money values — decimal(14,2) covers up to ₹999,999,999,999.99
            // which is more than enough for line-item pricing.
            $table->decimal('purchase_price', 14, 2)->default(0);
            $table->decimal('gst_percentage', 6, 2)->default(0);
            $table->decimal('gst_amount',     14, 2)->default(0);
            $table->decimal('total_amount',   14, 2)->default(0);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['vendor_id', 'product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_product_mappings');
    }
};
