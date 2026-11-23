<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_product_mappings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();

            $table->string('batch_serial_lot', 128)->nullable();

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
