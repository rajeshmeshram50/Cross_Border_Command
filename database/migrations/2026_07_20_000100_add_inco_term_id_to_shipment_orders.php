<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('shipment_orders', 'inco_term_id')) return;

        Schema::table('shipment_orders', function (Blueprint $t) {
            $t->unsignedBigInteger('inco_term_id')->nullable()->after('inco_term')->index();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('shipment_orders', 'inco_term_id')) return;

        Schema::table('shipment_orders', function (Blueprint $t) {
            $t->dropColumn('inco_term_id');
        });
    }
};
