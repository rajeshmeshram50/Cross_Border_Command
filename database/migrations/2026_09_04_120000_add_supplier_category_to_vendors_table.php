<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->string('supplier_category', 20)
                  ->default('general')
                  ->after('risk_level_id');
        });

        \DB::table('vendors')->whereNull('supplier_category')->update(['supplier_category' => 'general']);
    }

    public function down(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->dropColumn('supplier_category');
        });
    }
};
