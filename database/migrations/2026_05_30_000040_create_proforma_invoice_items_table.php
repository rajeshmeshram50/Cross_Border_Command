<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Proforma Invoice line items.
 *
 * Same shape as quotation_items — server computes `amount` from
 * `quantity * rate * (1 + tax_pct/100)` and rolls it up to the
 * header's sub_total / grand_total. `product_id` is a soft FK so
 * later product master renames don't rewrite history; product_name
 * + hsn are snapshotted at insert.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('proforma_invoice_items', function (Blueprint $table) {
            $table->id();

            $table->foreignId('proforma_invoice_id')
                  ->constrained('proforma_invoices')->cascadeOnDelete();

            $table->unsignedBigInteger('product_id')->nullable()->index();
            $table->string('product_name', 255);
            $table->string('hsn_code', 16)->nullable();

            $table->decimal('quantity', 14, 4)->default(0);
            $table->string('unit', 16)->nullable();
            $table->decimal('rate',     14, 4)->default(0);
            $table->decimal('tax_pct',  6,  2)->default(0);
            $table->decimal('amount',  14, 2)->default(0);

            $table->unsignedSmallInteger('line_no')->default(0);

            $table->timestamps();

            $table->index(['proforma_invoice_id', 'line_no'], 'pi_items_pi_line_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('proforma_invoice_items');
    }
};
