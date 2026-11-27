<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->dropForeign(['customer_id']);
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->foreignId('customer_id')->nullable()->change();
            $table->foreign('customer_id')->references('id')->on('customers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->dropForeign(['customer_id']);
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->foreign('customer_id')->references('id')->on('customers')->cascadeOnDelete();
        });
    }
};
