<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Quotation line items.
 *
 * Step 2 of the Create Quotation modal — each row the user adds
 * (product, qty, rate, tax %) lands here. Totals on the parent
 * `quotations.sub_total` / `grand_total` are recomputed from the
 * items by the controller on every insert/update so the header is
 * always consistent with the lines.
 *
 * product_id is nullable so the user can quote a free-text item that
 * isn't in the Products master yet (the line still saves with just a
 * snapshot of the name + hsn). When product_id is set we still cache
 * the name/HSN on the line so historical quotations don't change if
 * the product master is renamed later.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotation_items', function (Blueprint $table) {
            $table->id();

            $table->foreignId('quotation_id')
                  ->constrained('quotations')->cascadeOnDelete();

            // Optional FK — keeps history intact if a product is renamed.
            $table->unsignedBigInteger('product_id')->nullable()->index();
            $table->string('product_name', 255);  // snapshot
            $table->string('hsn_code', 16)->nullable();

            $table->decimal('quantity', 14, 4)->default(0);
            $table->string('unit', 16)->nullable();         // KG, PCS, ...
            $table->decimal('rate',     14, 4)->default(0); // per-unit price in quotation currency
            $table->decimal('tax_pct',  6,  2)->default(0); // 0–100

            // Server-computed: qty * rate * (1 + tax_pct/100). Cached on
            // the row so list queries don't need to re-derive it.
            $table->decimal('amount', 14, 2)->default(0);

            // Display order — preserves the row sequence the user
            // entered, since auto-incrementing id isn't a contract for
            // display sort once we allow line drag-reorder later.
            $table->unsignedSmallInteger('line_no')->default(0);

            $table->timestamps();

            $table->index(['quotation_id', 'line_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quotation_items');
    }
};
