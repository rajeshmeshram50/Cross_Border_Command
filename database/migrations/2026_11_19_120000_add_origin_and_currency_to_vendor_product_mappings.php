<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLES = ['vendor_product_mappings', 'product_vendor_maps'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) use ($name) {
                if (!Schema::hasColumn($name, 'origin')) {
                    $table->string('origin', 16)->nullable()->after('product_id');
                }
                if (!Schema::hasColumn($name, 'currency_code')) {
                    $table->string('currency_code', 3)->nullable()->after('origin');
                }
                if (!Schema::hasColumn($name, 'exchange_rate')) {
                    $table->decimal('exchange_rate', 15, 4)->nullable()->after('purchase_price');
                }
                if (!Schema::hasColumn($name, 'inr_amount')) {
                    $table->decimal('inr_amount', 18, 2)->nullable()->after('exchange_rate');
                }
            });

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
