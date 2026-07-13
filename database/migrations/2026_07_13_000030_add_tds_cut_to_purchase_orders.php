<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * TDS is deducted ("cut") exactly ONCE per Purchase Order, before any payment
 * is recorded (from the PO or SPI screen). This flag marks that the PO-level
 * TDS deduction has been confirmed via the "Save" action in Payment Details.
 * Once true, payments are allowed and the TDS % is locked. A TDS of 0% still
 * has to be explicitly cut once, so a boolean (not "tds_amount > 0") is needed.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->boolean('tds_cut')->default(false)->after('tds_amount');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn('tds_cut');
        });
    }
};
