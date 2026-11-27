<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
