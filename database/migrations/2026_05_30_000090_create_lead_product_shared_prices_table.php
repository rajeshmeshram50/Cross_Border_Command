<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_product_shared_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();
            $table->foreignId('lead_product_id')->constrained('lead_products')->cascadeOnDelete();
            $table->decimal('quoted_price', 14, 2);
            $table->timestamp('shared_at')->useCurrent();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['client_id', 'lead_id']);
            $table->index('lead_product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_product_shared_prices');
    }
};
