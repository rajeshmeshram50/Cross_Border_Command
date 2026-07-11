<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Real Zoho Books sync needs to remember what it created so a second click
 * doesn't push a duplicate PO into Zoho. These columns hold the Zoho-side
 * purchase-order id, when it synced, the last error (for a truthful UI), and
 * a cached copy of Zoho's own rendered PDF. The vendor gets a cached Zoho
 * contact id so we resolve/create the Zoho vendor once, not every sync.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->string('zoho_purchaseorder_id', 64)->nullable()->after('zoho_status');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_purchaseorder_id');
            $table->text('zoho_error')->nullable()->after('zoho_synced_at');
            $table->string('zoho_pdf_path', 255)->nullable()->after('zoho_error');
        });

        Schema::table('vendors', function (Blueprint $table) {
            $table->string('zoho_contact_id', 64)->nullable()->after('primary_email');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn(['zoho_purchaseorder_id', 'zoho_synced_at', 'zoho_error', 'zoho_pdf_path']);
        });

        Schema::table('vendors', function (Blueprint $table) {
            $table->dropColumn('zoho_contact_id');
        });
    }
};
