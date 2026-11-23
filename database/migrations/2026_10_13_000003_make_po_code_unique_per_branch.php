<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->dropUnique('p2p_purchase_orders_client_id_code_unique');
            $t->unique(['client_id', 'branch_id', 'code'], 'p2p_purchase_orders_code_unique_per_branch');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->dropUnique('p2p_purchase_orders_code_unique_per_branch');
            $t->unique(['client_id', 'code'], 'p2p_purchase_orders_client_id_code_unique');
        });
    }
};
