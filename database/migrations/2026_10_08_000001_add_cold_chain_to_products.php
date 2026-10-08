<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;


return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->boolean('cold_chain')->default(false)->after('packaging_material_id');
            $table->decimal('cold_chain_temp_min', 6, 2)->nullable()->after('cold_chain');
            $table->decimal('cold_chain_temp_max', 6, 2)->nullable()->after('cold_chain_temp_min');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['cold_chain', 'cold_chain_temp_min', 'cold_chain_temp_max']);
        });
    }
};
