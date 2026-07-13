<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Product-level supporting attachment (a single supporting document /
 * certificate / specification shown in the "PRODUCT ATTACHMENT" card on the
 * Core step).
 *
 * The frontend has been sending `product_attachment` / `product_attachment_file`
 * on the Core save all along, but there was no column to store it — so the file
 * was silently dropped and never reappeared when editing the product. This adds
 * the string column (stores the relative storage path, like `primary_image`).
 * Any file type is allowed (PDF / Word / image / etc.), so it is NOT restricted
 * to images.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'product_attachment')) {
                $table->string('product_attachment', 500)->nullable()->after('secondary_images');
            }
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'product_attachment')) {
                $table->dropColumn('product_attachment');
            }
        });
    }
};
