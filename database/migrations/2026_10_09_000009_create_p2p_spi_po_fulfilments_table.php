<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_po_fulfilments', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable();

            $t->unsignedBigInteger('purchase_order_id')->index();
            $t->unsignedBigInteger('purchase_order_item_id')->index();
            $t->unsignedBigInteger('product_id')->nullable();

            $t->unsignedBigInteger('supplier_invoice_id')->index();
            $t->unsignedBigInteger('supplier_invoice_item_id')->nullable();

            $t->enum('event', ['invoiced', 'revised', 'cancelled']);

            $t->decimal('po_qty', 14, 3);
            $t->decimal('previous_qty', 14, 3)->nullable();
            $t->decimal('current_qty', 14, 3);
            $t->decimal('change_qty', 14, 3);
            $t->decimal('pending_after', 14, 3);

            $t->unsignedBigInteger('changed_by')->nullable();
            $t->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_po_fulfilments');
    }
};
