<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipment_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('shipment_orders', 'shipment_code')) {
                $table->string('shipment_code', 32)->nullable()->after('client_id');
                $table->index(['client_id', 'shipment_code']);
            }
        });
    }

    public function down(): void
    {
        Schema::table('shipment_orders', function (Blueprint $table) {
            if (Schema::hasColumn('shipment_orders', 'shipment_code')) {
                $table->dropIndex(['client_id', 'shipment_code']);
                $table->dropColumn('shipment_code');
            }
        });
    }
};
