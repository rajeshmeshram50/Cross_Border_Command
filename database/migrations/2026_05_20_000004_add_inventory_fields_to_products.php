<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory tracking fields for a product. These four columns surface on
 * the Product Detail view under "Inventory Details" and are captured on
 * the Add Product wizard's Quality tab.
 *
 * All nullable — older rows + draft products in progress shouldn't be
 * forced to populate them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('batch_no',  100)->nullable()->after('height_cm');
            $table->string('serial_no', 100)->nullable()->after('batch_no');
            $table->string('cat_no',    100)->nullable()->after('serial_no');
            $table->string('lot_no',    100)->nullable()->after('cat_no');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['batch_no', 'serial_no', 'cat_no', 'lot_no']);
        });
    }
};
