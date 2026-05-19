<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_vendor_maps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();

            // Vendor master doesn't exist yet, so we store vendor identity inline.
            // Once a vendors master ships, swap this for a `vendor_id` FK.
            $table->string('vendor_code', 50)->nullable();
            $table->string('vendor_name', 255);
            $table->string('vendor_website', 255)->nullable();
            $table->string('contact_person', 255)->nullable();
            $table->string('contact_no', 50)->nullable();
            $table->string('email', 255)->nullable();
            $table->string('designation', 100)->nullable();
            $table->string('attachment_path', 500)->nullable();

            $table->decimal('purchase_price', 15, 2)->nullable();
            $table->decimal('gst_percentage', 6, 2)->nullable();
            $table->decimal('gst_amount', 15, 2)->nullable();
            $table->decimal('total_amount', 15, 2)->nullable();

            $table->date('map_date')->nullable();
            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_vendor_maps');
    }
};
