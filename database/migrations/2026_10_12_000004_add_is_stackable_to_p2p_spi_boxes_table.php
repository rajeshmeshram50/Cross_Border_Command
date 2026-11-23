<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->smallInteger('is_stackable')->default(0)->after('condition');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->dropColumn('is_stackable');
        });
    }
};
