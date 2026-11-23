<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('lead_product_shared_prices', 'quoted_price')) {
            Schema::table('lead_product_shared_prices', function (Blueprint $t) {
                $t->decimal('quoted_price', 20, 2)->change();
            });
        }
        if (Schema::hasColumn('lead_products', 'target_price')) {
            Schema::table('lead_products', function (Blueprint $t) {
                $t->decimal('target_price', 20, 2)->nullable()->change();
            });
        }
        if (Schema::hasColumn('procurement_products', 'target_price')) {
            Schema::table('procurement_products', function (Blueprint $t) {
                $t->decimal('target_price', 20, 2)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('lead_product_shared_prices', 'quoted_price')) {
            Schema::table('lead_product_shared_prices', function (Blueprint $t) {
                $t->decimal('quoted_price', 14, 2)->change();
            });
        }
        if (Schema::hasColumn('lead_products', 'target_price')) {
            Schema::table('lead_products', function (Blueprint $t) {
                $t->decimal('target_price', 14, 2)->nullable()->change();
            });
        }
        if (Schema::hasColumn('procurement_products', 'target_price')) {
            Schema::table('procurement_products', function (Blueprint $t) {
                $t->decimal('target_price', 14, 2)->nullable()->change();
            });
        }
    }
};
