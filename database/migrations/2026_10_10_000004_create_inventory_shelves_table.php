<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_shelves', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('rack_id')->nullable();

            $t->string('shelf_name', 180)->nullable();
            $t->unsignedSmallInteger('level_no')->nullable();
            $t->string('shelf_type', 60)->nullable();
            $t->decimal('max_weight_kg', 14, 2)->nullable();
            $t->string('purpose', 120)->nullable();

            $t->unsignedTinyInteger('cold_chain')->default(0);
            $t->unsignedTinyInteger('hazardous')->default(0);

            $t->string('dim_unit', 4)->nullable();
            $t->decimal('length', 12, 2)->nullable();
            $t->decimal('width', 12, 2)->nullable();
            $t->decimal('height', 12, 2)->nullable();
            $t->decimal('area', 14, 2)->nullable();
            $t->decimal('volume', 16, 3)->nullable();
            $t->decimal('height_cm', 12, 2)->nullable();

            $t->decimal('used_weight_kg', 14, 2)->default(0);
            $t->unsignedInteger('boxes_count')->default(0);

            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->unique(['rack_id', 'level_no'], 'inv_shelf_rack_level_uq');
            $t->unique(['rack_id', 'shelf_name'], 'inv_shelf_rack_name_uq');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_shelves');
    }
};
