<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_vendor_maps', function (Blueprint $table) {
            if (!Schema::hasColumn('product_vendor_maps', 'vendor_id')) {
                $table->foreignId('vendor_id')
                    ->nullable()
                    ->after('product_id')
                    ->constrained('vendors')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('product_vendor_maps', function (Blueprint $table) {
            if (Schema::hasColumn('product_vendor_maps', 'vendor_id')) {
                $table->dropConstrainedForeignId('vendor_id');
            }
        });
    }
};
