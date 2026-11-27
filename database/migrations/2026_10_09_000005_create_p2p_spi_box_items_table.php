<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_box_items', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('box_id')->index();
            $t->unsignedBigInteger('supplier_invoice_item_id')->index();
            $t->decimal('quantity', 14, 3);

            $t->boolean('is_stackable')->default(true);

            $t->enum('remark', ['correct', 'damaged', 'mismatched', 'extra'])->default('correct');
            $t->text('remark_note')->nullable();

            $t->json('flags')->nullable();

            $t->string('serial_no', 60)->nullable();
            $t->string('lot_no', 60)->nullable();
            $t->string('batch_no', 60)->nullable();
            $t->string('cat_no', 60)->nullable();
            $t->date('expiry_date')->nullable();
            $t->date('mfg_date')->nullable();

            $t->timestamps();
            $t->softDeletes();
        });

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
