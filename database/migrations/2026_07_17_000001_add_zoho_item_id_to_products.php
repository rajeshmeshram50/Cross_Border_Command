<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Remember each product's Zoho Books Item id so a PO / bill / vendor-credit sync
 * reuses the same item instead of re-searching by name every time (a name-search
 * miss would otherwise create a DUPLICATE item in Zoho). Mirrors the
 * vendors.zoho_contact_id mechanism that already dedupes vendor contacts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('zoho_item_id', 64)->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('zoho_item_id');
        });
    }
};
