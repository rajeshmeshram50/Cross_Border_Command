<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
