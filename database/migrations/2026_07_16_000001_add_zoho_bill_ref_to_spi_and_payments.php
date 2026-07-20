<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Real Zoho Books sync for Supplier Purchase Invoices: an SPI is pushed to Zoho
 * as a **Bill** (the vendor invoice), and the payments recorded against it (PO
 * payments for a With-PO SPI, SPI payments for a Direct SPI) are posted as Zoho
 * vendor payments applied to that bill.
 *
 * These columns remember what Zoho created so a second sync can't push a
 * duplicate bill, mirror the PO-side zoho_* columns (id / synced-at / error /
 * cached PDF), and stamp each payment row with its Zoho vendor-payment id so a
 * payment is never posted to Zoho twice. Mirrors
 * add_zoho_ref_to_purchase_orders for the PO side.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->string('zoho_bill_id', 64)->nullable()->after('zoho_status');
            $table->string('zoho_bill_number', 64)->nullable()->after('zoho_bill_id');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_bill_number');
            $table->text('zoho_error')->nullable()->after('zoho_synced_at');
            $table->string('zoho_pdf_path', 255)->nullable()->after('zoho_error');
        });

        // Each recorded payment carries the Zoho vendor-payment id once posted,
        // so a re-sync (or a second SPI on the same PO) never double-posts it.
        Schema::table('po_payments', function (Blueprint $table) {
            $table->string('zoho_payment_id', 64)->nullable()->after('status');
        });
        Schema::table('spi_payments', function (Blueprint $table) {
            $table->string('zoho_payment_id', 64)->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->dropColumn(['zoho_bill_id', 'zoho_bill_number', 'zoho_synced_at', 'zoho_error', 'zoho_pdf_path']);
        });
        Schema::table('po_payments', function (Blueprint $table) {
            $table->dropColumn('zoho_payment_id');
        });
        Schema::table('spi_payments', function (Blueprint $table) {
            $table->dropColumn('zoho_payment_id');
        });
    }
};
