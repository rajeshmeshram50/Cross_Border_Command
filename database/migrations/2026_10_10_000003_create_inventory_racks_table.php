<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_racks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('warehouse_id')->nullable();
            $t->unsignedBigInteger('zone_id')->nullable();

            $t->string('rack_name', 180)->nullable();

            $t->unsignedTinyInteger('cold_chain')->default(0);
            $t->unsignedTinyInteger('hazardous')->default(0);

            $t->string('dim_unit', 4)->nullable();
            $t->decimal('length', 12, 2)->nullable();
            $t->decimal('width', 12, 2)->nullable();
            $t->decimal('height', 12, 2)->nullable();
            $t->decimal('area_sqft', 14, 2)->nullable();

            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->unique(['zone_id', 'rack_name'], 'inv_rack_zone_name_uq');
            $t->index(['warehouse_id', 'status'], 'inv_rack_wh_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_racks');
    }
};
