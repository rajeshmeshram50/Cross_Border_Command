<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_zones', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('warehouse_id')->nullable();

            $t->string('zone_name', 180)->nullable();
            $t->enum('rack_mode', ['rack', 'norack'])->nullable();
            $t->decimal('area_sqft', 14, 2)->nullable();
            $t->string('purpose', 120)->nullable();

            $t->unsignedTinyInteger('cold_chain')->default(0);
            $t->decimal('temp_min_c', 6, 2)->nullable();
            $t->decimal('temp_max_c', 6, 2)->nullable();
            $t->unsignedTinyInteger('hazardous')->default(0);

            $t->enum('storage_mode', ['regular', 'fridge'])->nullable();
            $t->decimal('capacity_litres', 14, 2)->nullable();

            $t->string('dim_unit', 4)->nullable();
            $t->decimal('length', 12, 2)->nullable();
            $t->decimal('width', 12, 2)->nullable();
            $t->decimal('height', 12, 2)->nullable();
            $t->decimal('usable_pct', 5, 2)->nullable();
            $t->decimal('floor_area', 14, 2)->nullable();
            $t->decimal('volume', 16, 3)->nullable();
            $t->decimal('usable_volume', 16, 3)->nullable();

            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->index(['warehouse_id', 'rack_mode'], 'inv_zone_wh_mode_idx');
            $t->index(['client_id', 'status'], 'inv_zone_client_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_zones');
    }
};
