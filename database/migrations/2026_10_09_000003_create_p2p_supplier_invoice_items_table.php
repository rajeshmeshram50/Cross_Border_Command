<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_supplier_invoice_items', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('supplier_invoice_id')->index();
            $t->unsignedSmallInteger('line_no');

            $t->unsignedBigInteger('pi_item_id')->nullable()->index();
            $t->unsignedBigInteger('po_item_id')->nullable()->index();
            $t->unsignedBigInteger('product_id')->index();

            $t->text('description')->nullable();
            $t->string('hsn_code', 20)->nullable();
            $t->string('uom', 20)->nullable();

            $t->decimal('qty_pi', 14, 3)->nullable();
            $t->decimal('qty_po', 14, 3)->nullable();
            $t->decimal('qty_spi', 14, 3);
            $t->decimal('po_line_total', 15, 2)->nullable();

            $t->decimal('rate', 15, 4)->default(0);
            $t->decimal('taxable_amount', 15, 2)->default(0);

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
