<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('shipment_orders', 'inco_term')) {
            Schema::table('shipment_orders', function (Blueprint $t) {
                $t->string('inco_term', 100)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('shipment_orders', 'inco_term')) {
            Schema::table('shipment_orders', function (Blueprint $t) {
                $t->string('inco_term', 32)->nullable()->change();
            });
        }
    }
};
