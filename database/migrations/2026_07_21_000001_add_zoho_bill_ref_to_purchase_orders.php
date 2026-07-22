<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A With-PO purchase order, once fully utilised, is synced to Zoho Books as a
 * Purchase Order AND a Bill (the bill carries all of the PO's payments). These
 * columns remember the Bill so re-syncs top up payments instead of duplicating.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->string('zoho_bill_id', 64)->nullable()->after('zoho_purchaseorder_id');
            $table->string('zoho_bill_number', 64)->nullable()->after('zoho_bill_id');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn(['zoho_bill_id', 'zoho_bill_number']);
        });
    }
};
