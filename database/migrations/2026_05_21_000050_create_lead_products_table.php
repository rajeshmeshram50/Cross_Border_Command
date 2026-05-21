<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Product Directory (lead ⇄ product mapping).
 *
 * Joins the lead to one or more products with the salesperson's target
 * price and intended quantity. Powers the "Product Directory" pill on
 * the matrix toolbar and gets read again by later stages (Price Shared,
 * Quotation vs PI). One row per (lead, product) — the unique gate
 * prevents the same product being mapped twice to a lead, but the same
 * product can map to many leads (it's a directory entry, not ownership).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_products', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();

            $table->string('currency', 8)->default('USD');
            $table->decimal('quantity', 14, 3)->nullable();
            $table->decimal('target_price', 14, 2)->nullable();
            $table->text('notes')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // One row per (lead, product); fast lookup by lead.
            $table->unique(['lead_id', 'product_id'], 'lead_products_pair_unique');
            $table->index(['client_id', 'lead_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_products');
    }
};
