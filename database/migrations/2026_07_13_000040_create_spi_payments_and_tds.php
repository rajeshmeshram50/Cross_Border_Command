<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SPI-scoped payments + TDS.
 *
 * A "Direct SPI" (Supplier Purchase Invoice with no linked purchase order) is
 * payable against its OWN net-payable amount. Its payments live here (not in
 * po_payments, which is strictly PO-scoped). TDS is cut once on the SPI, on the
 * base (net_payable − GST), mirroring the PO flow. Tenant scope mirrors
 * supplier_purchase_invoices (client_id + nullable branch_id).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            // One-time TDS deduction for a Direct SPI (net_payable already GST-inclusive).
            $table->decimal('tds_percentage', 6, 2)->default(0)->after('net_payable');
            $table->decimal('tds_amount', 14, 2)->default(0)->after('tds_percentage');
            $table->boolean('tds_cut')->default(false)->after('tds_amount');
        });

        Schema::create('spi_payments', function (Blueprint $table) {
            $table->id();

            // Tenant scope (stamped from the SPI / acting user).
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // The payment ALWAYS belongs to a Direct SPI (amount subtracts from
            // the SPI's net-payable balance).
            $table->foreignId('supplier_purchase_invoice_id')->constrained('supplier_purchase_invoices')->cascadeOnDelete();

            $table->decimal('amount', 14, 2)->default(0);        // "Amount To Be Pay" for this transaction
            $table->string('bank_name', 128)->nullable();
            $table->string('utr_cheque_number', 64)->nullable(); // UTR / Cheque Number
            $table->date('utr_cheque_date')->nullable();
            $table->string('attachment_path', 500)->nullable();  // proof of payment
            $table->decimal('balance_after', 14, 2)->default(0); // running SPI balance snapshot after this payment
            $table->string('status', 24)->default('Cleared');    // Cleared / Pending

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['supplier_purchase_invoice_id', 'id']);
            $table->index(['client_id', 'supplier_purchase_invoice_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('spi_payments');
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->dropColumn(['tds_percentage', 'tds_amount', 'tds_cut']);
        });
    }
};
