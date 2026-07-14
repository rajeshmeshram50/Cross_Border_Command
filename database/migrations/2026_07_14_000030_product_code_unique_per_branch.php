<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Make `product_code` unique per BRANCH instead of per client (QA-33).
 *
 * Product codes are branch-scoped sequences — each branch restarts at P-01 —
 * so Branch 2 doesn't inherit Branch 1's running count. The prior index
 * (client_id, product_code) forced codes to be unique across a whole client,
 * which blocked two branches from both holding P-01. Widen it to
 * (client_id, branch_id, product_code) so each branch keeps its own P-01,
 * P-02, … series. Mirrors ProductController::nextProductCode's branch scope.
 *
 * NULL branch_id rows (client-level products) are treated as their own bucket;
 * Postgres considers NULLs distinct in a unique index, which is fine here — the
 * counter's whereNull('branch_id') branch keeps that bucket sequential.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_client_id_product_code_unique');
            $table->unique(['client_id', 'branch_id', 'product_code'], 'products_client_branch_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_client_branch_code_unique');
            $table->unique(['client_id', 'product_code'], 'products_client_id_product_code_unique');
        });
    }
};
