<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-row applied-amount ledger for Zoho vendor payments.
 *
 * A single recorded payment can be applied to a Zoho bill across more than one
 * call — a straddling payment on a multi-SPI purchase order splits across two
 * bills, and a payment that failed to post on the first sync must be topped up
 * on a re-sync. `zoho_payment_id` (a single flag) can't express "partly
 * applied", so we track the cumulative amount posted to Zoho here. A payment is
 * fully posted once zoho_applied_amount == amount.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['po_payments', 'spi_payments'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->decimal('zoho_applied_amount', 14, 2)->default(0)->after('zoho_payment_id');
            });
        }
    }

    public function down(): void
    {
        foreach (['po_payments', 'spi_payments'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn('zoho_applied_amount');
            });
        }
    }
};
