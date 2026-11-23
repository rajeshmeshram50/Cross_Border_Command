<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_supplier_invoices', function (Blueprint $t) {
            $t->unsignedBigInteger('shipment_order_id')->nullable()->after('vendor_id');
            $t->unsignedBigInteger('procurement_request_id')->nullable()->after('shipment_order_id');
            $t->string('procurement_request_code', 30)->nullable()->after('procurement_request_id');

            $t->decimal('tds_percentage', 8, 2)->nullable()->after('grand_total');
            $t->decimal('tds_amount', 15, 2)->nullable()->after('tds_percentage');
            $t->unsignedBigInteger('tds_updated_by')->nullable()->after('tds_amount');
            $t->timestamp('tds_updated_at')->nullable()->after('tds_updated_by');
            $t->decimal('paid_amount', 15, 2)->nullable()->after('tds_updated_at');
            $t->decimal('balance_amount', 15, 2)->nullable()->after('paid_amount');

            $t->index('shipment_order_id');
            $t->index('procurement_request_id');
        });

        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->unsignedBigInteger('supplier_invoice_id')->nullable()->after('purchase_order_id');
            $t->index('supplier_invoice_id');
        });

        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->dropIndex(['supplier_invoice_id']);
            $t->dropColumn('supplier_invoice_id');
        });

        Schema::table('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->unsignedBigInteger('purchase_order_id')->nullable(false)->change();
        });

        Schema::table('p2p_supplier_invoices', function (Blueprint $t) {
            $t->dropIndex(['shipment_order_id']);
            $t->dropIndex(['procurement_request_id']);
            $t->dropColumn([
                'shipment_order_id',
                'procurement_request_id',
                'procurement_request_code',
                'tds_percentage',
                'tds_amount',
                'tds_updated_by',
                'tds_updated_at',
                'paid_amount',
                'balance_amount',
            ]);
        });
    }
};
