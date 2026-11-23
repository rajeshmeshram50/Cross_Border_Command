<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
