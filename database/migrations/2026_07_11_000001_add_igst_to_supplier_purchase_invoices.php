<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inter-state supply (supplier state code ≠ our home 27) is taxed as a single
 * IGST = the full product GST, instead of split CGST + SGST. Add the columns to
 * store it (header total + per-item %/amount) so the SPI matches the PO wizard.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->decimal('total_igst', 14, 2)->default(0)->after('total_sgst');
        });
        Schema::table('supplier_purchase_invoice_items', function (Blueprint $table) {
            $table->decimal('igst_pct', 6, 2)->default(0)->after('sgst_pct');
            $table->decimal('igst_amount', 14, 2)->default(0)->after('sgst_amount');
        });
    }

    public function down(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->dropColumn('total_igst');
        });
        Schema::table('supplier_purchase_invoice_items', function (Blueprint $table) {
            $table->dropColumn(['igst_pct', 'igst_amount']);
        });
    }
};
