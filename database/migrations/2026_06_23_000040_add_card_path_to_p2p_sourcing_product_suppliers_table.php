<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->string('card_path', 512)->nullable()->after('city');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->dropColumn('card_path');
        });
    }
};
