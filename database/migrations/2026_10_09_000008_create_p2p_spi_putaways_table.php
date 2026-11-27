<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_putaways', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('supplier_invoice_id')->index();
            $t->unsignedBigInteger('box_id');

            $t->unsignedBigInteger('warehouse_id')->index();
            $t->unsignedBigInteger('zone_id')->nullable();
            $t->unsignedBigInteger('rack_id')->nullable();
            $t->unsignedBigInteger('shelf_id')->nullable();
            $t->string('destination', 120)->nullable();

            $t->timestamp('box_scanned_at')->nullable();
            $t->timestamp('location_scanned_at')->nullable();
            $t->timestamp('rack_scanned_at')->nullable();
            $t->timestamp('shelf_scanned_at')->nullable();

            $t->unsignedBigInteger('device_id')->nullable()->index();
            $t->string('device_serial', 64)->nullable();
            $t->unsignedBigInteger('scanned_by')->nullable();

            $t->timestamp('confirmed_at')->nullable();
            $t->unsignedBigInteger('confirmed_by')->nullable();
            $t->enum('condition_at_putaway', ['perfect', 'minor', 'major', 'severe'])->nullable();

            $t->timestamps();
            $t->softDeletes();

            $t->unique('box_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_putaways');
    }
};
