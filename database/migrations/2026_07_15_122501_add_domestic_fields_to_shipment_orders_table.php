<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipment_orders', function (Blueprint $table) {
            $table->decimal('shipping_cost', 15, 2)->nullable()->after('freight_cost');
            $table->string('pin_code', 12)->nullable()->after('zip_code');
            $table->string('place_of_dispatch', 128)->nullable()->after('origin_country');
            $table->string('place_of_delivery', 128)->nullable()->after('place_of_dispatch');
        });
    }

    public function down(): void
    {
        Schema::table('shipment_orders', function (Blueprint $table) {
            $table->dropColumn([
                'shipping_cost',
                'pin_code',
                'place_of_dispatch',
                'place_of_delivery',
            ]);
        });
    }
};
