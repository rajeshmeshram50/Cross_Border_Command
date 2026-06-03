<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Widen the Sales-Matrix money columns from decimal(14,2) — which caps at
 * 12 integer digits (~999 billion) — to decimal(20,2) (18 integer digits).
 *
 * Entering a larger quoted/target price on Stage 4 (Price Shared) or in the
 * sourcing flow was overflowing with:
 *   SQLSTATE[22003]: Numeric value out of range … precision 14, scale 2.
 * Widening lets the salesperson enter the value they typed without a 500.
 */
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
        // Revert to the original precision (only succeeds if stored values fit).
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
