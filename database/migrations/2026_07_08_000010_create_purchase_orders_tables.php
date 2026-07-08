<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Purchase Order (P2P → Procurement) — header + product line items.
 *
 * A PO is issued to a supplier (vendors). It may be linked to a shipment
 * (With Shipment ID) whose PI (proforma_invoices) supplies the expected
 * products, or stand alone (Without Shipment ID). Dropdown values sourced
 * from masters are stored as their master row id (warehouse_id, currency_id)
 * with a cached display label alongside, matching the quotation convention.
 *
 * Tenant scope: client_id (constrained) + branch_id (nullable, unconstrained)
 * — identical to quotations / procurements / shipment_orders.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();

            // Tenant scope
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 32);                       // PO/2026-27/001

            // Basic PO details
            $table->string('po_type', 64)->nullable();        // Material / Goods, Services, FFD / Transporter
            $table->string('document_type', 32)->default('Domestics'); // Domestics / International
            $table->string('mode_of_transport', 64)->nullable();
            $table->date('po_date')->nullable();
            $table->date('expected_delivery_date')->nullable();
            $table->unsignedBigInteger('warehouse_id')->nullable()->index(); // master_warehouse_master.id
            $table->string('delivery_location', 255)->nullable();            // cached warehouse name
            $table->string('payment_type', 64)->nullable();
            $table->boolean('physical_inspection')->default(false);

            // International-only fields
            $table->unsignedBigInteger('currency_id')->nullable()->index();  // master_currencies.id
            $table->string('currency_code', 16)->nullable();                 // cached currency code
            $table->decimal('exchange_rate', 14, 4)->nullable();
            $table->string('inco_term', 32)->nullable();
            $table->string('port_of_loading', 128)->nullable();
            $table->string('port_of_discharge', 128)->nullable();
            $table->string('final_destination', 128)->nullable();
            $table->string('country_of_origin', 128)->nullable();

            // Supplier (vendors)
            $table->foreignId('vendor_id')->nullable()->constrained('vendors')->nullOnDelete();
            $table->string('supplier_code', 64)->nullable();  // cached vendor_code
            $table->string('supplier_name', 255)->nullable(); // cached company name

            // Shipment / procurement linkage
            $table->foreignId('shipment_order_id')->nullable()->constrained('shipment_orders')->nullOnDelete();
            $table->string('shipment_code', 64)->nullable();  // cached SHP-###
            $table->unsignedBigInteger('proforma_invoice_id')->nullable()->index();
            $table->string('pi_number', 64)->nullable();      // cached PI code
            $table->unsignedBigInteger('opportunity_id')->nullable()->index(); // leads.id
            $table->string('opportunity_code', 64)->nullable();
            $table->string('customer_name', 255)->nullable();
            $table->string('consignee_name', 255)->nullable();

            // Terms & totals
            $table->text('terms')->nullable();
            $table->decimal('shipping_charges', 14, 2)->default(0);
            $table->decimal('packaging_charges', 14, 2)->default(0);
            $table->decimal('other_charges', 14, 2)->default(0);
            $table->decimal('total_product_cost', 14, 2)->default(0);
            $table->decimal('total_cgst', 14, 2)->default(0);
            $table->decimal('total_sgst', 14, 2)->default(0);
            $table->decimal('additional_charges', 14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);

            $table->string('zoho_status', 16)->default('Not Sync'); // Sync / Not Sync
            $table->string('status', 24)->default('Draft');         // Draft / Sent for Sign / Signed

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

            $table->unsignedBigInteger('product_id')->nullable(); // soft FK to products (snapshot)
            $table->string('product_code', 64)->nullable();

            // PI (expected) snapshot — only present for With-Shipment POs
            $table->string('pi_product_name', 255)->nullable();
            $table->decimal('pi_quantity', 14, 4)->nullable();

            // PO line
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
