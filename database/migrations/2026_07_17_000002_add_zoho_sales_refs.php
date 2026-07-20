<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales-side Zoho Books sync: Quotation → Zoho Estimate, Proforma Invoice →
 * Zoho Invoice, Customer → Zoho contact (customer). Mirrors the P2P columns
 * (vendors.zoho_contact_id, spi.zoho_bill_id, etc.). The cached customer
 * contact id dedupes customers exactly like vendors; the doc-level ids make
 * each sync idempotent and remember Zoho's number + cached PDF + last error.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('zoho_contact_id', 64)->nullable()->after('status');
        });

        Schema::table('quotations', function (Blueprint $table) {
            $table->string('zoho_status', 16)->default('Not Sync')->after('status');
            $table->string('zoho_estimate_id', 64)->nullable()->after('zoho_status');
            $table->string('zoho_estimate_number', 64)->nullable()->after('zoho_estimate_id');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_estimate_number');
            $table->text('zoho_error')->nullable()->after('zoho_synced_at');
            $table->string('zoho_pdf_path', 255)->nullable()->after('zoho_error');
        });

        Schema::table('proforma_invoices', function (Blueprint $table) {
            $table->string('zoho_status', 16)->default('Not Sync')->after('status');
            $table->string('zoho_invoice_id', 64)->nullable()->after('zoho_status');
            $table->string('zoho_invoice_number', 64)->nullable()->after('zoho_invoice_id');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_invoice_number');
            $table->text('zoho_error')->nullable()->after('zoho_synced_at');
            $table->string('zoho_pdf_path', 255)->nullable()->after('zoho_error');
        });
    }

    public function down(): void
    {
        Schema::table('customers', fn (Blueprint $t) => $t->dropColumn('zoho_contact_id'));
        Schema::table('quotations', fn (Blueprint $t) => $t->dropColumn(['zoho_status', 'zoho_estimate_id', 'zoho_estimate_number', 'zoho_synced_at', 'zoho_error', 'zoho_pdf_path']));
        Schema::table('proforma_invoices', fn (Blueprint $t) => $t->dropColumn(['zoho_status', 'zoho_invoice_id', 'zoho_invoice_number', 'zoho_synced_at', 'zoho_error', 'zoho_pdf_path']));
    }
};
