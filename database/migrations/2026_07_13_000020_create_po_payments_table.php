<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Purchase-Order payments (P2P → Procurement → "Payment Summary Against PO").
 *
 * Each row is ONE recorded payment made to the supplier against a PO — the
 * "Payment History Against PO" grid (amount, bank, UTR/cheque no + date,
 * proof attachment, balance-after snapshot, cleared/pending status).
 *
 * IMPORTANT — payments are always scoped to the PURCHASE ORDER, never the SPI.
 * The same payment can be recorded from EITHER entry point:
 *   • the Purchase Order screen, or
 *   • the Supplier Purchase Invoice screen (which resolves the SPI's linked PO)
 * In both cases the amount is subtracted from the PO's balance (amount_paid =
 * SUM(po_payments.amount); balance = net_payable − amount_paid). It never
 * decrements a separate SPI amount. `supplier_purchase_invoice_id` only records
 * which SPI the payment was entered through, for traceability.
 *
 * TDS is a PO-level deduction (a single % applied to the PO's grand total to
 * compute Net Payable), so it lives on the purchase_orders header, not per
 * payment. Tenant scope mirrors purchase_orders (client_id + nullable branch_id).
 */
return new class extends Migration {
    public function up(): void
    {
        // PO-level TDS deduction (Payment Details row → editable %, Save).
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->decimal('tds_percentage', 6, 2)->default(0)->after('grand_total');
            $table->decimal('tds_amount', 14, 2)->default(0)->after('tds_percentage');
        });

        Schema::create('po_payments', function (Blueprint $table) {
            $table->id();

            // Tenant scope (stamped from purchase_orders / acting user).
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // The payment ALWAYS belongs to a PO (amount subtracts from PO balance).
            $table->foreignId('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();
            // Entry-point trace only: the SPI this payment was recorded through
            // (when paid from the SPI screen). Nullable — most payments come
            // straight from the PO screen. Soft-linked so deleting an SPI keeps
            // the PO payment history intact.
            $table->unsignedBigInteger('supplier_purchase_invoice_id')->nullable()->index();

            $table->decimal('amount', 14, 2)->default(0);        // "Amount To Be Pay" for this transaction
            $table->string('bank_name', 128)->nullable();
            $table->string('utr_cheque_number', 64)->nullable(); // UTR / Cheque Number
            $table->date('utr_cheque_date')->nullable();
            $table->string('attachment_path', 500)->nullable();  // proof of payment
            $table->decimal('balance_after', 14, 2)->default(0); // running PO balance snapshot after this payment
            $table->string('status', 24)->default('Cleared');    // Cleared / Pending

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['purchase_order_id', 'id']);
            $table->index(['client_id', 'purchase_order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('po_payments');
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn(['tds_percentage', 'tds_amount']);
        });
    }
};
