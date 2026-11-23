<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotation_items', function (Blueprint $table) {
            $table->id();

            $table->foreignId('quotation_id')
                  ->constrained('quotations')->cascadeOnDelete();

            $table->unsignedBigInteger('product_id')->nullable()->index();
            $table->string('product_name', 255);
            $table->string('hsn_code', 16)->nullable();

            $table->decimal('quantity', 14, 4)->default(0);
            $table->string('unit', 16)->nullable();
            $table->decimal('rate',     14, 4)->default(0);
            $table->decimal('tax_pct',  6,  2)->default(0);

            $table->decimal('amount', 14, 2)->default(0);

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
