<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 32);

            $table->string('po_type', 64)->nullable();
            $table->string('document_type', 32)->default('Domestics');
            $table->string('mode_of_transport', 64)->nullable();
            $table->date('po_date')->nullable();
            $table->date('expected_delivery_date')->nullable();
            $table->unsignedBigInteger('warehouse_id')->nullable()->index();
            $table->string('delivery_location', 255)->nullable();
            $table->string('payment_type', 64)->nullable();
            $table->boolean('physical_inspection')->default(false);

            $table->unsignedBigInteger('currency_id')->nullable()->index();
            $table->string('currency_code', 16)->nullable();
            $table->decimal('exchange_rate', 14, 4)->nullable();
            $table->string('inco_term', 32)->nullable();
            $table->string('port_of_loading', 128)->nullable();
            $table->string('port_of_discharge', 128)->nullable();
            $table->string('final_destination', 128)->nullable();
            $table->string('country_of_origin', 128)->nullable();

            $table->foreignId('vendor_id')->nullable()->constrained('vendors')->nullOnDelete();
            $table->string('supplier_code', 64)->nullable();
            $table->string('supplier_name', 255)->nullable();

            $table->foreignId('shipment_order_id')->nullable()->constrained('shipment_orders')->nullOnDelete();
            $table->string('shipment_code', 64)->nullable();
            $table->unsignedBigInteger('proforma_invoice_id')->nullable()->index();
            $table->string('pi_number', 64)->nullable();
            $table->unsignedBigInteger('opportunity_id')->nullable()->index();
            $table->string('opportunity_code', 64)->nullable();
            $table->string('customer_name', 255)->nullable();
            $table->string('consignee_name', 255)->nullable();

            $table->text('terms')->nullable();
            $table->decimal('shipping_charges', 14, 2)->default(0);
            $table->decimal('packaging_charges', 14, 2)->default(0);
            $table->decimal('other_charges', 14, 2)->default(0);
            $table->decimal('total_product_cost', 14, 2)->default(0);
            $table->decimal('total_cgst', 14, 2)->default(0);
            $table->decimal('total_sgst', 14, 2)->default(0);
            $table->decimal('additional_charges', 14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);

            $table->string('zoho_status', 16)->default('Not Sync');
            $table->string('status', 24)->default('Draft');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'status']);
            $table->index(['client_id', 'shipment_order_id']);
        });

        Schema::create('purchase_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();

            $table->unsignedBigInteger('product_id')->nullable();
            $table->string('product_code', 64)->nullable();

            $table->string('pi_product_name', 255)->nullable();
            $table->decimal('pi_quantity', 14, 4)->nullable();

            $table->string('product_name', 255)->nullable();
            $table->decimal('quantity', 14, 4)->default(0);
            $table->decimal('rate', 14, 4)->default(0);
            $table->decimal('gst_pct', 6, 2)->default(0);
            $table->decimal('cgst_pct', 6, 2)->default(0);
            $table->decimal('sgst_pct', 6, 2)->default(0);
            $table->decimal('cgst_amount', 14, 2)->default(0);
            $table->decimal('sgst_amount', 14, 2)->default(0);
            $table->decimal('cost', 14, 2)->default(0);
            $table->integer('line_no')->default(0);

            $table->timestamps();
            $table->index('purchase_order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_order_items');
        Schema::dropIfExists('purchase_orders');
    }
};
