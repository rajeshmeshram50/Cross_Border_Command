<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A product's supplier mapping can hold an INTERNATIONAL price.
 *
 * The mapping stored purchase_price + GST and nothing else, so the Map Supplier
 * popup in Product Master could only ever be domestic — there was nowhere to
 * put a currency or an exchange rate. The service mapping
 * (p2p_service_suppliers) has carried these four since it was built; this
 * brings the product side to the same shape so both can share one flow.
 *
 * Nullable throughout. Every existing row is a domestic mapping, and the
 * backfill says so explicitly rather than leaving origin null for the
 * frontend to guess at.
 */
return new class extends Migration
{
    /**
     * BOTH sides of the mapping. A product's suppliers live in two tables:
     * product_vendor_maps (the product's own list, with the vendor's contact
     * denormalised onto it) and vendor_product_mappings (the shared pair).
     * storeVendors writes both on every save, so a column on one alone would
     * leave the two disagreeing about what the price even is.
     */
    private const TABLES = ['vendor_product_mappings', 'product_vendor_maps'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) use ($name) {
                if (!Schema::hasColumn($name, 'origin')) {
                    // 'domestic' | 'international' — App\Support\SupplierPricing::ORIGINS.
                    $table->string('origin', 16)->nullable()->after('product_id');
                }
                if (!Schema::hasColumn($name, 'currency_code')) {
                    $table->string('currency_code', 3)->nullable()->after('origin');
                }
                if (!Schema::hasColumn($name, 'exchange_rate')) {
                    // ₹ per unit of currency_code, as entered on the mapping.
                    $table->decimal('exchange_rate', 15, 4)->nullable()->after('purchase_price');
                }
                if (!Schema::hasColumn($name, 'inr_amount')) {
                    /* purchase_price × exchange_rate, stored rather than derived:
                       the rate moves, and a mapping priced last month must keep
                       reading as what it cost then. */
                    $table->decimal('inr_amount', 18, 2)->nullable()->after('exchange_rate');
                }
            });

            // Every row that exists predates international support.
            DB::table($name)->whereNull('origin')->update(['origin' => 'domestic']);
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) use ($name) {
                foreach (['origin', 'currency_code', 'exchange_rate', 'inr_amount'] as $c) {
                    if (Schema::hasColumn($name, $c)) {
                        $table->dropColumn($c);
                    }
                }
            });
        }
    }
};
