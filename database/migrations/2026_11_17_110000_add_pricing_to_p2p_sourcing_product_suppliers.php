<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sourcing Management Tracker → Map Supplier Directory: each mapped supplier
 * now carries its quoted price.
 *   Domestic      ₹ unit price (excl. GST) + GST rate, GST type
 *                 (intra = CGST + SGST, inter = IGST), price valid till
 *   International unit price in the supplier's currency, exchange rate
 *                 (₹ per unit), no GST, ₹ equivalent
 * Rows mapped before this change keep NULL prices ("Price & GST not mapped").
 */
return new class extends Migration
{
    private const T = 'p2p_sourcing_product_suppliers';

    public function up(): void
    {
        Schema::table(self::T, function (Blueprint $table) {
            $add = fn (string $c) => !Schema::hasColumn(self::T, $c);
            if ($add('origin'))           $table->string('origin', 16)->nullable()->after('source');
            if ($add('currency_code'))    $table->string('currency_code', 8)->nullable()->after('origin');
            if ($add('price'))            $table->decimal('price', 14, 2)->nullable();
            if ($add('gst_percentage'))   $table->decimal('gst_percentage', 5, 2)->nullable();
            if ($add('gst_type'))         $table->string('gst_type', 8)->nullable();     // intra | inter | none
            if ($add('cgst_amount'))      $table->decimal('cgst_amount', 14, 2)->nullable();
            if ($add('sgst_amount'))      $table->decimal('sgst_amount', 14, 2)->nullable();
            if ($add('igst_amount'))      $table->decimal('igst_amount', 14, 2)->nullable();
            if ($add('gst_amount'))       $table->decimal('gst_amount', 14, 2)->nullable();
            if ($add('total_amount'))     $table->decimal('total_amount', 14, 2)->nullable();
            if ($add('exchange_rate'))    $table->decimal('exchange_rate', 14, 4)->nullable();
            if ($add('inr_amount'))       $table->decimal('inr_amount', 14, 2)->nullable();
            if ($add('price_valid_till')) $table->date('price_valid_till')->nullable();
            if ($add('mapped_by'))        $table->unsignedBigInteger('mapped_by')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table(self::T, function (Blueprint $table) {
            foreach (['origin', 'currency_code', 'price', 'gst_percentage', 'gst_type', 'cgst_amount', 'sgst_amount',
                      'igst_amount', 'gst_amount', 'total_amount', 'exchange_rate', 'inr_amount', 'price_valid_till', 'mapped_by'] as $c) {
                if (Schema::hasColumn(self::T, $c)) $table->dropColumn($c);
            }
        });
    }
};
