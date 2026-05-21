<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the FK back to vendors on product_vendor_maps. Earlier the
 * column was deferred because the vendor master didn't exist; now
 * it does, and the product-vendor link needs to be symmetric so
 * mapping a vendor → product on either form reflects on the other.
 */
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
