<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_boxes', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('supplier_invoice_id')->index();

            $t->enum('scenario', ['s1', 's2', 's3'])->default('s1');
            $t->string('box_code', 40);

            $t->decimal('length_cm', 10, 2)->nullable();
            $t->decimal('width_cm', 10, 2)->nullable();
            $t->decimal('height_cm', 10, 2)->nullable();
            $t->decimal('weight_kg', 10, 3)->nullable();
            $t->decimal('net_weight_kg', 10, 3)->nullable();
            $t->decimal('gross_weight_kg', 10, 3)->nullable();

            $t->enum('condition', ['perfect', 'minor', 'major', 'severe'])->default('perfect');

            $t->timestamp('sticker_printed_at')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->unique(['supplier_invoice_id', 'box_code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_boxes');
    }
};
