<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_zones', function (Blueprint $t) {
            $t->decimal('used_volume', 16, 3)->default(0)->after('usable_volume');
            $t->decimal('used_area_sqft', 14, 3)->default(0)->after('used_volume');
            $t->decimal('used_weight_kg', 14, 3)->default(0)->after('used_area_sqft');
            $t->unsignedInteger('boxes_count')->default(0)->after('used_weight_kg');
        });
    }

    public function down(): void
    {
        Schema::table('inventory_zones', function (Blueprint $t) {
            $t->dropColumn(['used_volume', 'used_area_sqft', 'used_weight_kg', 'boxes_count']);
        });
    }
};
