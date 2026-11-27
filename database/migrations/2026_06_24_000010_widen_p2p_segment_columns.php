<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_suppliers', function (Blueprint $table) {
            $table->string('segment', 512)->nullable()->change();
        });
        Schema::table('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->string('segment', 512)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('p2p_suppliers', function (Blueprint $table) {
            $table->string('segment', 128)->nullable()->change();
        });
        Schema::table('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->string('segment', 128)->nullable()->change();
        });
    }
};
