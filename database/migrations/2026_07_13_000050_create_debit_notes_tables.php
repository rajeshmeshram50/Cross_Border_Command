<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Debit Note — header + product line items + additions/deductions charges.
 *
 * A debit note is raised against a Supplier Purchase Invoice (SPI) for returns,
 * rate/quantity differences, quality rejections, GST/freight adjustments, etc.
 * Selecting an SPI denormalises its supplier, invoice, PO and product context
 * onto the debit note (snapshot), mirroring how the SPI itself denormalises the
 * PO. Tenant scope, code convention and payment columns follow the SPI table.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('debit_notes', function (Blueprint $table) {
            $table->id();

            // Tenant scope
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 32);                        // DN/2026-27/001
            $table->date('debit_note_date')->nullable();
            $table->date('expected_debit_date')->nullable();

            // Debit note type (master lookup) — id + cached label snapshot.
            $table->unsignedBigInteger('debit_note_type_id')->nullable()->index();
            $table->string('debit_note_type', 128)->nullable();

            // Linked Supplier Purchase Invoice (source of all the context below)
            $table->foreignId('supplier_purchase_invoice_id')->nullable()
                ->constrained('supplier_purchase_invoices', 'id', 'dn_spi_id_fk')->nullOnDelete();
            $table->string('spi_code', 64)->nullable();
            $table->date('spi_date')->nullable();

            // Purchase order (cached from the SPI)
            $table->unsignedBigInteger('purchase_order_id')->nullable()->index();
            $table->string('po_code', 64)->nullable();
            $table->date('po_date')->nullable();

            // Shipment / procurement linkage (cached from the SPI)
            $table->unsignedBigInteger('shipment_order_id')->nullable()->index();
            $table->string('shipment_code', 64)->nullable();
            $table->unsignedBigInteger('procurement_id')->nullable()->index();
            $table->string('procurement_code', 64)->nullable();

            // Supplier snapshot
            $table->unsignedBigInteger('vendor_id')->nullable()->index();
            $table->string('supplier_code', 64)->nullable();
            $table->string('supplier_name', 255)->nullable();
            $table->string('supplier_type', 128)->nullable();

            // Address & contact snapshot
            $table->string('address', 500)->nullable();
            $table->string('country', 128)->nullable();
            $table->string('state', 128)->nullable();
            $table->string('state_code', 8)->nullable();
            $table->string('city', 128)->nullable();
            $table->string('contact_name', 128)->nullable();
            $table->string('designation', 128)->nullable();
            $table->string('contact_no', 64)->nullable();
            $table->string('email', 128)->nullable();

            // GST scrutiny snapshot
            $table->string('gst_number', 32)->nullable();
            $table->string('gst_status', 32)->nullable();
            $table->date('scrutiny_date')->nullable();
            $table->date('last_filing_date')->nullable();
            $table->text('gst_remarks')->nullable();

            // Reason & terms
            $table->text('reason')->nullable();
            $table->text('terms')->nullable();

            // Amounts
            $table->decimal('total_product_cost', 14, 2)->default(0);
            $table->decimal('total_cgst', 14, 2)->default(0);
            $table->decimal('total_sgst', 14, 2)->default(0);
            $table->decimal('total_igst', 14, 2)->default(0);
            $table->decimal('additions_total', 14, 2)->default(0);
            $table->decimal('deductions_total', 14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);       // this debit note's total
            $table->decimal('total_paid', 14, 2)->default(0);
            $table->decimal('balance', 14, 2)->default(0);

            $table->string('attachment_path', 255)->nullable();

            $table->string('zoho_status', 16)->default('Not Sync');  // Sync / Not Sync
            $table->string('status', 24)->default('Unpaid');         // Unpaid / Partially Paid / Fully Paid / Payment Overdue

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'status']);
        });

        Schema::create('debit_note_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('debit_note_id')->constrained('debit_notes', 'id', 'dn_items_dn_id_fk')->cascadeOnDelete();

            $table->unsignedBigInteger('product_id')->nullable();
            $table->string('product_code', 64)->nullable();
            $table->string('product_name', 255)->nullable();
            $table->string('hsn_code', 32)->nullable();

            $table->decimal('qty_po', 14, 4)->default(0);
            $table->decimal('qty_spi', 14, 4)->default(0);
            $table->decimal('debit_qty', 14, 4)->default(0);
            $table->decimal('rate', 14, 4)->default(0);

            $table->decimal('gst_pct', 6, 2)->default(0);
            $table->decimal('cgst_pct', 6, 2)->default(0);
            $table->decimal('sgst_pct', 6, 2)->default(0);
            $table->decimal('igst_pct', 6, 2)->default(0);
            $table->decimal('cgst_amount', 14, 2)->default(0);
            $table->decimal('sgst_amount', 14, 2)->default(0);
            $table->decimal('igst_amount', 14, 2)->default(0);
            $table->decimal('cost', 14, 2)->default(0);
            $table->integer('line_no')->default(0);

            $table->timestamps();
            $table->index('debit_note_id', 'dn_items_dn_id_idx');
        });

        Schema::create('debit_note_charges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('debit_note_id')->constrained('debit_notes', 'id', 'dn_charges_dn_id_fk')->cascadeOnDelete();

            $table->string('type', 16);   // addition / deduction
            $table->decimal('amount', 14, 2)->default(0);
            $table->string('note', 255)->nullable();
            $table->integer('line_no')->default(0);

            $table->timestamps();
            $table->index('debit_note_id', 'dn_charges_dn_id_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('debit_note_charges');
        Schema::dropIfExists('debit_note_items');
        Schema::dropIfExists('debit_notes');
    }
};
