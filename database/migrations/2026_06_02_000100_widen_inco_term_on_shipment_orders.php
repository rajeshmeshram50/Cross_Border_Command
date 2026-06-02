<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * The Shipment ID form now picks INCO Term from the master dropdown,
     * which stores the full label (e.g. "CIP – Carriage and Insurance
     * Paid") — wider than the original varchar(32). Widen to match the
     * Quotation / PI inco_term columns (varchar(100)).
     */
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
