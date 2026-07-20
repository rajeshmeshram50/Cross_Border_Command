<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Real Zoho Books sync for Debit Notes: a purchase debit note is pushed to Zoho
 * as a **Vendor Credit** (Zoho's name for a buyer-side debit note — it REDUCES
 * the payable to the supplier, the opposite of a Bill). When the debit note's
 * linked SPI is already synced as a Zoho bill, the credit is applied against
 * that bill to realise the reduction.
 *
 * These columns remember what Zoho created so a second sync can't push a
 * duplicate credit, and mirror the SPI/PO zoho_* columns. `zoho_applied_amount`
 * records how much of the credit was applied to the linked bill (0 = it sits as
 * an open vendor credit in Zoho). Mirrors add_zoho_bill_ref_to_spi_and_payments.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('debit_notes', function (Blueprint $table) {
            $table->string('zoho_vendorcredit_id', 64)->nullable()->after('zoho_status');
            $table->string('zoho_vendorcredit_number', 64)->nullable()->after('zoho_vendorcredit_id');
            $table->decimal('zoho_applied_amount', 14, 2)->default(0)->after('zoho_vendorcredit_number');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_applied_amount');
            $table->text('zoho_error')->nullable()->after('zoho_synced_at');
            $table->string('zoho_pdf_path', 255)->nullable()->after('zoho_error');
        });
    }

    public function down(): void
    {
        Schema::table('debit_notes', function (Blueprint $table) {
            $table->dropColumn([
                'zoho_vendorcredit_id', 'zoho_vendorcredit_number', 'zoho_applied_amount',
                'zoho_synced_at', 'zoho_error', 'zoho_pdf_path',
            ]);
        });
    }
};
