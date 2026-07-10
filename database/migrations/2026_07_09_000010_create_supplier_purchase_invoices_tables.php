<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Supplier Purchase Invoice (SPI) — header + product line items.
 *
 * An SPI records an invoice received from a supplier. It may be linked to an
 * existing Purchase Order (With PO → 3-way match: PI vs PO vs SPI) or stand
 * alone (Direct / Without PO → supplier invoice with tax & cost only).
 *
 * Schema mirrors purchase_orders exactly (tenant scope, cached labels, code
 * convention) plus invoice-specific fields: invoice_no/date, the linked PO,
 * and the payment reconciliation columns (total_po / net_payable / paid /
 * balance) that drive the SPI list.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('supplier_purchase_invoices', function (Blueprint $table) {
            $table->id();

            // Tenant scope
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 32);                       // SPI/2026-27/001

            // Invoice basics
            $table->string('invoice_no', 128)->nullable();    // supplier's own invoice number
            $table->date('invoice_date')->nullable();
            $table->string('document_type', 32)->default('Domestics'); // Domestics / International
            $table->string('po_type', 64)->nullable();        // carried from the linked PO

            // Linked Purchase Order (null → Direct / Without-PO SPI)
            $table->foreignId('purchase_order_id')->nullable()->constrained('purchase_orders')->nullOnDelete();
            $table->string('po_code', 64)->nullable();        // cached PO/2026-27/###

            // Supplier (vendors)
            $table->foreignId('vendor_id')->nullable()->constrained('vendors')->nullOnDelete();
            $table->string('supplier_code', 64)->nullable();
            $table->string('supplier_name', 255)->nullable();

            // Shipment / PI / procurement linkage (cached from the PO)
            $table->foreignId('shipment_order_id')->nullable()->constrained('shipment_orders')->nullOnDelete();
            $table->string('shipment_code', 64)->nullable();
            $table->unsignedBigInteger('proforma_invoice_id')->nullable()->index();
            $table->string('pi_number', 64)->nullable();
            $table->unsignedBigInteger('opportunity_id')->nullable()->index(); // leads.id
            $table->string('opportunity_code', 64)->nullable();
            $table->unsignedBigInteger('procurement_id')->nullable()->index();
            $table->string('procurement_code', 64)->nullable();
            $table->string('customer_name', 255)->nullable();
            $table->string('consignee_name', 255)->nullable();

            // Amounts / payment reconciliation
            $table->decimal('total_po_amount', 14, 2)->default(0);   // grand total of the linked PO
            $table->decimal('total_product_cost', 14, 2)->default(0);
            $table->decimal('total_cgst', 14, 2)->default(0);
            $table->decimal('total_sgst', 14, 2)->default(0);
            $table->decimal('additional_charges', 14, 2)->default(0);
            $table->decimal('net_payable', 14, 2)->default(0);       // this invoice's grand total
            $table->decimal('total_paid', 14, 2)->default(0);
            $table->decimal('balance', 14, 2)->default(0);           // net_payable - total_paid

            $table->string('attachment_path', 255)->nullable();      // uploaded SPI PDF

            $table->string('zoho_status', 16)->default('Not Sync');  // Sync / Not Sync
            $table->string('status', 24)->default('Draft');          // Draft / Approved / Paid

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'status']);
            $table->index(['client_id', 'purchase_order_id']);
        });

        Schema::create('supplier_purchase_invoice_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('supplier_purchase_invoice_id')->constrained('supplier_purchase_invoices', 'id', 'spi_items_spi_id_fk')->cascadeOnDelete();

            $table->unsignedBigInteger('product_id')->nullable(); // soft FK to products (snapshot)
            $table->string('product_code', 64)->nullable();

            // PI (expected) snapshot — from the PO's proforma invoice
            $table->string('pi_product_name', 255)->nullable();
            $table->decimal('pi_quantity', 14, 4)->nullable();

            // PO snapshot — from the linked purchase order
            $table->string('po_product_name', 255)->nullable();
            $table->decimal('po_quantity', 14, 4)->nullable();
            $table->decimal('rate_po', 14, 4)->default(0);

            // SPI line (what the supplier actually invoiced)
            $table->string('product_name', 255)->nullable();
            $table->decimal('quantity', 14, 4)->default(0);
            $table->decimal('missing_qty', 14, 4)->default(0);      // po_quantity - quantity
            $table->string('hsn_code', 32)->nullable();
            $table->decimal('rate', 14, 4)->default(0);             // SPI rate

            $table->decimal('gst_pct', 6, 2)->default(0);
            $table->decimal('cgst_pct', 6, 2)->default(0);
            $table->decimal('sgst_pct', 6, 2)->default(0);
            $table->decimal('cgst_amount', 14, 2)->default(0);
            $table->decimal('sgst_amount', 14, 2)->default(0);
            $table->decimal('cost', 14, 2)->default(0);
            $table->integer('line_no')->default(0);

            $table->timestamps();
            $table->index('supplier_purchase_invoice_id', 'spi_items_spi_id_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_purchase_invoice_items');
        Schema::dropIfExists('supplier_purchase_invoices');
    }
};
