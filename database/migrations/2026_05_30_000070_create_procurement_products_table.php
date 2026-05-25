<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Procurement ⇄ Lead-Product line items.
 *
 *  procurement_id   FK to procurements (cascade on delete).
 *  lead_product_id  FK to lead_products. Optional because a master-level
 *                   procurement may not be tied to a lead⇄product row, but
 *                   in the Stage 3 flow this is always set.
 *  product_id       Denormalised pointer to the product master so we can
 *                   query "procurements for this product" without joining
 *                   through lead_products.
 *  qty / target_price  Per-line numbers the salesperson entered in the
 *                      Create Procurement modal (not necessarily equal to
 *                      the directory row's values).
 *  attachments      JSON list of stored file paths.
 *
 * No UNIQUE on (procurement_id, lead_product_id) — IDIMS allows the same
 * lead_product to appear in multiple procurements over time (re-quotes).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('procurement_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('procurement_id')->constrained('procurements')->cascadeOnDelete();
            $table->foreignId('lead_product_id')->nullable()->constrained('lead_products')->nullOnDelete();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->decimal('qty', 14, 3)->nullable();
            $table->decimal('target_price', 14, 2)->nullable();
            $table->json('attachments')->nullable();
            $table->timestamps();

            $table->index('lead_product_id');
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('procurement_products');
    }
};
