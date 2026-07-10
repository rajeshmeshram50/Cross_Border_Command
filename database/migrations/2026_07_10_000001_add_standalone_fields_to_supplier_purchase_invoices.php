<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the Basic-Purchase-Order-Details fields the standalone (Without-PO) SPI
 * flow captures directly (a Direct invoice has no PO to inherit them from):
 * transport / payment / delivery / inspection, the supplier type, and the
 * International-document extras (currency, exchange rate, INCO, ports, origin).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->string('mode_of_transport', 64)->nullable()->after('po_type');
            $table->string('payment_type', 64)->nullable()->after('mode_of_transport');
            $table->string('delivery_location', 255)->nullable()->after('payment_type');
            $table->date('expected_delivery_date')->nullable()->after('delivery_location');
            $table->boolean('physical_inspection')->default(false)->after('expected_delivery_date');
            $table->string('supplier_type', 128)->nullable()->after('supplier_name');
            // International (document_type = International)
            $table->string('currency', 8)->nullable()->after('supplier_type');
            $table->decimal('exchange_rate', 14, 4)->nullable()->after('currency');
            $table->string('inco_term', 16)->nullable()->after('exchange_rate');
            $table->string('port_of_loading', 128)->nullable()->after('inco_term');
            $table->string('port_of_discharge', 128)->nullable()->after('port_of_loading');
            $table->string('final_destination', 128)->nullable()->after('port_of_discharge');
            $table->string('country_of_origin', 128)->nullable()->after('final_destination');
        });
    }

    public function down(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->dropColumn([
                'mode_of_transport', 'payment_type', 'delivery_location', 'expected_delivery_date',
                'physical_inspection', 'supplier_type', 'currency', 'exchange_rate', 'inco_term',
                'port_of_loading', 'port_of_discharge', 'final_destination', 'country_of_origin',
            ]);
        });
    }
};
