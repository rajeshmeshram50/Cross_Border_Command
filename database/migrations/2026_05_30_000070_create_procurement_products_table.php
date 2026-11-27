<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
